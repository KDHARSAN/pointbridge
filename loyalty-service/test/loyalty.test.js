import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';

const CLIENTS = { cafe: 'cafe-key', cinema: 'cinema-key' };
const PHONE = '9876543210';

function setup() {
  const app = createApp({ db: openDb(), clients: CLIENTS });
  const as = (client) => ({
    post: (path, body) => request(app).post(path).set('X-Client-Id', client).set('X-Api-Key', CLIENTS[client]).send(body),
    get: (path) => request(app).get(path).set('X-Client-Id', client).set('X-Api-Key', CLIENTS[client]),
  });
  return { app, cafe: as('cafe'), cinema: as('cinema') };
}

async function enrolled(withPoints = 0) {
  const s = setup();
  await s.cafe.post('/members', { phone: PHONE, name: 'Priya' });
  if (withPoints) await s.cafe.post(`/members/${PHONE}/earn`, { amount: withPoints * 10, reference: 'seed' });
  return s;
}

test('enroll -> 201 new member; same phone again -> 200 existing', async () => {
  const { cafe, cinema } = setup();
  const first = await cafe.post('/members', { phone: PHONE, name: 'Priya' });
  assert.equal(first.status, 201);
  assert.equal(first.body.balance, 0);
  assert.equal(first.body.tier, 'Silver');
  const again = await cinema.post('/members', { phone: PHONE, name: 'Someone Else' });
  assert.equal(again.status, 200);
  assert.equal(again.body.name, 'Priya');
});

test('GET member -> 200, unknown -> 404', async () => {
  const { cafe, cinema } = await enrolled();
  assert.equal((await cinema.get(`/members/${PHONE}`)).body.name, 'Priya');
  assert.equal((await cafe.get('/members/1111111111')).status, 404);
});

test('earn ₹250 -> +25 points, ledger row tagged with calling client', async () => {
  const { cafe } = await enrolled();
  const res = await cafe.post(`/members/${PHONE}/earn`, { amount: 250, reference: 'order-1' });
  assert.equal(res.status, 200);
  assert.equal(res.body.points, 25);
  assert.equal(res.body.member.balance, 25);
  const tx = (await cafe.get(`/members/${PHONE}/transactions`)).body;
  assert.deepEqual(tx.map((t) => [t.type, t.points, t.source, t.reference]), [['earn', 25, 'cafe', 'order-1']]);
});

test('earn below ₹10 -> 0 points, no ledger row', async () => {
  const { cafe } = await enrolled();
  const res = await cafe.post(`/members/${PHONE}/earn`, { amount: 9, reference: 'order-2' });
  assert.equal(res.body.points, 0);
  assert.equal((await cafe.get(`/members/${PHONE}/transactions`)).body.length, 0);
});

test('redeem within balance -> balance drops', async () => {
  const { cinema } = await enrolled(50);
  const res = await cinema.post(`/members/${PHONE}/redeem`, { points: 30, reference: 'booking-1' });
  assert.equal(res.status, 200);
  assert.equal(res.body.points, 30);
  assert.equal(res.body.member.balance, 20);
});

test('redeem more than balance -> 409, balance unchanged', async () => {
  const { cinema } = await enrolled(50);
  const res = await cinema.post(`/members/${PHONE}/redeem`, { points: 51, reference: 'booking-1' });
  assert.equal(res.status, 409);
  assert.deepEqual(res.body, { error: 'Not enough points' });
  assert.equal((await cinema.get(`/members/${PHONE}`)).body.balance, 50);
});

test('two apps spending the same last points -> second gets 409', async () => {
  const { cafe, cinema } = await enrolled(40);
  const [a, b] = await Promise.all([
    cafe.post(`/members/${PHONE}/redeem`, { points: 40, reference: 'order-9' }),
    cinema.post(`/members/${PHONE}/redeem`, { points: 40, reference: 'booking-9' }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal((await cafe.get(`/members/${PHONE}`)).body.balance, 0);
});

test('retry with same reference does not double count', async () => {
  const { cafe } = await enrolled();
  await cafe.post(`/members/${PHONE}/earn`, { amount: 250, reference: 'order-1' });
  const retry = await cafe.post(`/members/${PHONE}/earn`, { amount: 250, reference: 'order-1' });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.points, 25);
  assert.equal(retry.body.member.balance, 25);
});

test('same reference from a different client or type is a separate transaction', async () => {
  const { cafe, cinema } = await enrolled(100);
  await cafe.post(`/members/${PHONE}/redeem`, { points: 10, reference: 'x-1' });
  await cinema.post(`/members/${PHONE}/redeem`, { points: 10, reference: 'x-1' });
  const res = await cafe.post(`/members/${PHONE}/earn`, { amount: 100, reference: 'x-1' });
  assert.equal(res.body.member.balance, 100 - 10 - 10 + 10);
});

test('validation -> 400 naming the field', async () => {
  const { cafe } = await enrolled(10);
  const cases = [
    ['/members', { phone: '123', name: 'A' }, /phone/],
    ['/members', { phone: PHONE.replace('0', '1'), name: ' ' }, /name/],
    [`/members/${PHONE}/earn`, { amount: 0, reference: 'r' }, /amount/],
    [`/members/${PHONE}/earn`, { amount: 'abc', reference: 'r' }, /amount/],
    [`/members/${PHONE}/earn`, { amount: 100 }, /reference/],
    [`/members/${PHONE}/redeem`, { points: 1.5, reference: 'r' }, /points/],
    [`/members/${PHONE}/redeem`, { points: -3, reference: 'r' }, /points/],
  ];
  for (const [path, body, field] of cases) {
    const res = await cafe.post(path, body);
    assert.equal(res.status, 400, `${path} ${JSON.stringify(body)}`);
    assert.match(res.body.error, field);
  }
});

test('earn/redeem for unknown member -> 404', async () => {
  const { cafe } = setup();
  assert.equal((await cafe.post('/members/1111111111/earn', { amount: 100, reference: 'r' })).status, 404);
  assert.equal((await cafe.post('/members/1111111111/redeem', { points: 1, reference: 'r' })).status, 404);
});

test('missing or wrong API key -> 401; /health is open', async () => {
  const { app } = setup();
  assert.equal((await request(app).get(`/members/${PHONE}`)).status, 401);
  assert.equal((await request(app).get(`/members/${PHONE}`).set('X-Client-Id', 'cafe').set('X-Api-Key', 'cinema-key')).status, 401);
  assert.equal((await request(app).get('/health')).status, 200);
});

test('tier becomes Gold at 500 lifetime points and stays after redeeming', async () => {
  const { cafe } = await enrolled();
  const res = await cafe.post(`/members/${PHONE}/earn`, { amount: 5000, reference: 'big' });
  assert.equal(res.body.member.tier, 'Gold');
  const after = await cafe.post(`/members/${PHONE}/redeem`, { points: 400, reference: 'spend' });
  assert.equal(after.body.member.tier, 'Gold');
  assert.equal(after.body.member.lifetimeEarned, 500);
});
