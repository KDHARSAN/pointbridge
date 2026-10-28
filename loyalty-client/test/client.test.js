import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../loyalty-service/src/db.js';
import { createApp } from '../../loyalty-service/src/app.js';
import { createLoyaltyClient, LoyaltyError } from '../index.js';

const CLIENTS = { cafe: 'cafe-key' };
const PHONE = '9876543210';
let server;
let baseUrl;

before(async () => {
  server = createApp({ db: openDb(), clients: CLIENTS }).listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://localhost:${server.address().port}`;
});
after(() => server.close());

const cafe = () => createLoyaltyClient({ baseUrl, clientId: 'cafe', apiKey: 'cafe-key' });

const rejectsWith = (promise, status, message) => assert.rejects(promise, (err) => {
  assert.ok(err instanceof LoyaltyError);
  assert.equal(err.status, status);
  if (message) assert.match(err.message, message);
  return true;
});

test('enroll, earn, redeem, transactions round-trip against the real service', async () => {
  const c = cafe();
  assert.equal((await c.enroll(PHONE, 'Priya')).name, 'Priya');
  assert.equal((await c.earn(PHONE, 250, 'order-1')).points, 25);
  assert.equal((await c.redeem(PHONE, 5, 'order-2')).member.balance, 20);
  assert.equal((await c.getMember(PHONE)).balance, 20);
  assert.equal((await c.transactions(PHONE)).length, 2);
});

test('service errors become LoyaltyError with the HTTP status', async () => {
  const c = cafe();
  await rejectsWith(c.getMember('1111111111'), 404, /Member not found/);
  await rejectsWith(c.redeem(PHONE, 9999, 'order-3'), 409, /Not enough points/);
  await rejectsWith(createLoyaltyClient({ baseUrl, clientId: 'cafe', apiKey: 'nope' }).getMember(PHONE), 401);
});

test('findOrEnroll returns existing member, enrolls with a name, refuses unknown without a name', async () => {
  const c = cafe();
  assert.equal((await c.findOrEnroll(PHONE)).name, 'Priya');
  assert.equal((await c.findOrEnroll('9000000001', 'Arun')).name, 'Arun');
  await rejectsWith(c.findOrEnroll('9000000002'), 400, /name/);
});

test('unreachable service -> LoyaltyError status 0 "Loyalty service unavailable"', async () => {
  const c = createLoyaltyClient({ baseUrl: 'http://127.0.0.1:1', clientId: 'cafe', apiKey: 'cafe-key' });
  await rejectsWith(c.getMember(PHONE), 0, /Loyalty service unavailable/);
});
