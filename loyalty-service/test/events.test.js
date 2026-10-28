import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { createPublisher } from '../src/publisher.js';

const CLIENTS = { cafe: 'cafe-key', cinema: 'cinema-key' };
const PHONE = '9876543210';

function setup(publish) {
  const published = [];
  const app = createApp({ db: openDb(), clients: CLIENTS, publish: publish ?? ((e) => published.push(e)) });
  const post = (client, path, body) => request(app).post(path)
    .set('X-Client-Id', client).set('X-Api-Key', CLIENTS[client]).send(body);
  return { published, post };
}

test('enroll publishes MemberEnrolled once; re-enroll publishes nothing', async () => {
  const { published, post } = setup();
  await post('cafe', '/members', { phone: PHONE, name: 'Priya' });
  await post('cinema', '/members', { phone: PHONE, name: 'Priya' });
  assert.deepEqual(published.map((e) => [e.type, e.source, e.phone]), [['MemberEnrolled', 'cafe', PHONE]]);
  assert.equal(published[0].member.name, 'Priya');
  assert.ok(published[0].id && published[0].at);
});

test('earn and redeem publish events with points and member snapshot after the change', async () => {
  const { published, post } = setup();
  await post('cafe', '/members', { phone: PHONE, name: 'Priya' });
  await post('cafe', `/members/${PHONE}/earn`, { amount: 250, reference: 'order-1' });
  await post('cinema', `/members/${PHONE}/redeem`, { points: 10, reference: 'booking-1' });
  const [, earned, redeemed] = published;
  assert.deepEqual([earned.type, earned.source, earned.points, earned.member.balance], ['PointsEarned', 'cafe', 25, 25]);
  assert.deepEqual([redeemed.type, redeemed.source, redeemed.points, redeemed.member.balance], ['PointsRedeemed', 'cinema', 10, 15]);
});

test('replayed request, refused redeem and 0-point earn publish nothing', async () => {
  const { published, post } = setup();
  await post('cafe', '/members', { phone: PHONE, name: 'Priya' });
  await post('cafe', `/members/${PHONE}/earn`, { amount: 250, reference: 'order-1' });
  const count = published.length;
  await post('cafe', `/members/${PHONE}/earn`, { amount: 250, reference: 'order-1' });
  await post('cinema', `/members/${PHONE}/redeem`, { points: 999, reference: 'booking-1' });
  await post('cafe', `/members/${PHONE}/earn`, { amount: 5, reference: 'order-2' });
  assert.equal(published.length, count);
});

test('dead event bus does not fail the write', async () => {
  const { post } = setup(createPublisher('http://127.0.0.1:1'));
  assert.equal((await post('cafe', '/members', { phone: PHONE, name: 'Priya' })).status, 201);
  const res = await post('cafe', `/members/${PHONE}/earn`, { amount: 100, reference: 'order-1' });
  assert.equal(res.status, 200);
  assert.equal(res.body.member.balance, 10);
  await new Promise((r) => setTimeout(r, 50)); // let the failed fetches settle
});
