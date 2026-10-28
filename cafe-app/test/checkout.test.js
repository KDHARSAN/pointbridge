import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { LoyaltyError } from '../../loyalty-client/index.js';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';

const PHONE = '9876543210';

// In-memory stand-in for the Loyalty Service client, same interface and errors.
function stubLoyalty({ balance = 0, known = true, down = false, earnDown = false } = {}) {
  const calls = [];
  const member = known ? { phone: PHONE, name: 'Priya', balance, tier: 'Silver' } : null;
  const guard = (op) => {
    if (down || (op === 'earn' && earnDown)) throw new LoyaltyError(0, 'Loyalty service unavailable');
  };
  return {
    calls,
    async findOrEnroll(phone, name) {
      guard('find');
      calls.push(['findOrEnroll', phone]);
      if (member) return { ...member };
      if (!name) throw new LoyaltyError(400, 'name is required to join PointBridge');
      return { phone, name, balance: 0, tier: 'Silver' };
    },
    async getMember(phone) {
      guard('get');
      if (!member || phone !== PHONE) throw new LoyaltyError(404, 'Member not found');
      return { ...member };
    },
    async redeem(phone, points, reference) {
      guard('redeem');
      calls.push(['redeem', points, reference]);
      if (points > member.balance) throw new LoyaltyError(409, 'Not enough points');
      member.balance -= points;
      return { member: { ...member }, points };
    },
    async earn(phone, amount, reference) {
      guard('earn');
      const points = Math.floor(amount / 10);
      calls.push(['earn', amount, reference]);
      if (member) member.balance += points;
      return { member: { ...(member ?? { phone, balance: points }) }, points };
    },
  };
}

function setup(opts) {
  const db = openDb();
  const loyalty = stubLoyalty(opts);
  return { db, loyalty, app: createApp({ db, loyalty }) };
}

// Seeded menu: id 1 Cappuccino ₹150, id 2 Cold Brew ₹180 (see seed in db.js)
const order = (extra) => ({ phone: PHONE, items: [{ menuId: 1, qty: 1 }, { menuId: 2, qty: 1 }], ...extra }); // ₹330

test('GET /api/menu returns the seeded menu', async () => {
  const { app } = setup();
  const res = await request(app).get('/api/menu');
  assert.equal(res.body.length, 6);
  assert.deepEqual([res.body[0].name, res.body[0].price], ['Cappuccino', 150]);
});

test('checkout without points: order saved, earns on full total', async () => {
  const { app, loyalty } = setup();
  const res = await request(app).post('/api/checkout').send(order());
  assert.equal(res.status, 201);
  assert.deepEqual([res.body.order.total, res.body.order.pointsUsed, res.body.order.paid, res.body.order.pointsEarned],
    [330, 0, 330, 33]);
  assert.equal(res.body.order.loyaltyStatus, 'ok');
  const [op, amount, ref] = loyalty.calls.at(-1);
  assert.deepEqual([op, amount], ['earn', 330]);
  assert.match(ref, new RegExp(`^cafe-order-${res.body.order.id}-`));
});

test('checkout with points: spends min(balance,total), earns on what was paid', async () => {
  const { app, loyalty } = setup({ balance: 40 });
  const res = await request(app).post('/api/checkout').send(order({ usePoints: true }));
  assert.deepEqual([res.body.order.pointsUsed, res.body.order.paid, res.body.order.pointsEarned], [40, 290, 29]);
  const redeems = loyalty.calls.filter((c) => c[0] === 'redeem');
  assert.deepEqual(redeems.map((c) => c[1]), [40]);
  assert.match(redeems[0][2], new RegExp(`^cafe-order-${res.body.order.id}-`));
  assert.equal(res.body.member.balance, 29);
});

test('points cover the whole bill -> paid 0, nothing earned', async () => {
  const { app } = setup({ balance: 1000 });
  const res = await request(app).post('/api/checkout').send(order({ usePoints: true }));
  assert.deepEqual([res.body.order.pointsUsed, res.body.order.paid, res.body.order.pointsEarned], [330, 0, 0]);
});

test('redeem refused (409) -> checkout 409 and no order saved', async () => {
  const { app, loyalty } = setup({ balance: 40 });
  loyalty.redeem = async () => { throw new LoyaltyError(409, 'Not enough points'); };
  const res = await request(app).post('/api/checkout').send(order({ usePoints: true }));
  assert.equal(res.status, 409);
  assert.match(res.body.error, /Not enough points/);
  assert.equal((await request(app).get('/api/orders')).body.length, 0);
});

test('invalid items -> 400 before the loyalty service is called', async () => {
  const { app, loyalty } = setup();
  for (const items of [[], [{ menuId: 99, qty: 1 }], [{ menuId: 1, qty: 0 }], [{ menuId: 1, qty: 1.5 }], 'x']) {
    const res = await request(app).post('/api/checkout').send({ phone: PHONE, items });
    assert.equal(res.status, 400, JSON.stringify(items));
  }
  const bad = await request(app).post('/api/checkout').send(order({ phone: '12' }));
  assert.equal(bad.status, 400);
  assert.equal(loyalty.calls.length, 0);
});

test('new customer without a name -> 400; with a name -> enrolled and order saved', async () => {
  const { app } = setup({ known: false });
  assert.equal((await request(app).post('/api/checkout').send(order())).status, 400);
  const res = await request(app).post('/api/checkout').send(order({ name: 'Arun' }));
  assert.equal(res.status, 201);
});

test('guest checkout without phone: no loyalty calls, status none', async () => {
  const { app, loyalty } = setup();
  const res = await request(app).post('/api/checkout').send({ items: [{ menuId: 1, qty: 2 }] });
  assert.equal(res.status, 201);
  assert.deepEqual([res.body.order.total, res.body.order.loyaltyStatus], [300, 'none']);
  assert.equal(loyalty.calls.length, 0);
});

test('loyalty service down: order still saved with loyaltyStatus failed', async () => {
  const { app } = setup({ down: true });
  const res = await request(app).post('/api/checkout').send(order());
  assert.equal(res.status, 201);
  assert.deepEqual([res.body.order.loyaltyStatus, res.body.order.pointsEarned, res.body.order.paid], ['failed', 0, 330]);
  assert.equal((await request(app).get('/api/orders')).body[0].loyaltyStatus, 'failed');
});

test('loyalty service down and customer wants to use points -> 503, no order', async () => {
  const { app } = setup({ down: true });
  const res = await request(app).post('/api/checkout').send(order({ usePoints: true }));
  assert.equal(res.status, 503);
  assert.equal((await request(app).get('/api/orders')).body.length, 0);
});

test('earn fails after redeem succeeded: order kept with points used, status failed', async () => {
  const { app } = setup({ balance: 40, earnDown: true });
  const res = await request(app).post('/api/checkout').send(order({ usePoints: true }));
  assert.equal(res.status, 201);
  assert.deepEqual([res.body.order.pointsUsed, res.body.order.paid, res.body.order.loyaltyStatus], [40, 290, 'failed']);
});

test('GET /api/member/:phone maps loyalty errors to HTTP', async () => {
  const { app } = setup({ balance: 12 });
  assert.equal((await request(app).get(`/api/member/${PHONE}`)).body.balance, 12);
  assert.equal((await request(app).get('/api/member/1111111111')).status, 404);
  const down = setup({ down: true });
  assert.equal((await request(down.app).get(`/api/member/${PHONE}`)).status, 503);
});

test('null item -> 400, not a crash', async () => {
  const { app } = setup();
  assert.equal((await request(app).post('/api/checkout').send({ phone: PHONE, items: [null] })).status, 400);
});

test('references are unique per order, so a cleared cafe.db cannot replay old ones', async () => {
  const { app, loyalty } = setup();
  await request(app).post('/api/checkout').send(order());
  const fresh = setup();
  fresh.loyalty.calls.length = 0;
  await request(fresh.app).post('/api/checkout').send(order());
  const refs = [loyalty.calls.at(-1)[2], fresh.loyalty.calls.at(-1)[2]];
  assert.notEqual(refs[0], refs[1]);
});

test('redeem timeout: retried once with the same reference, order kept with points used', async () => {
  const { app, loyalty } = setup({ balance: 40 });
  const realRedeem = loyalty.redeem;
  const refs = [];
  loyalty.redeem = async (phone, points, ref) => {
    refs.push(ref);
    if (refs.length === 1) throw new LoyaltyError(0, 'Loyalty service unavailable');
    return realRedeem(phone, points, ref);
  };
  const res = await request(app).post('/api/checkout').send(order({ usePoints: true }));
  assert.equal(res.status, 201);
  assert.equal(res.body.order.pointsUsed, 40);
  assert.equal(refs[0], refs[1]);
});

test('pointsUsed records what the service actually spent', async () => {
  const { app, loyalty } = setup({ balance: 40 });
  loyalty.redeem = async () => ({ member: { phone: PHONE, balance: 30 }, points: 10 });
  const res = await request(app).post('/api/checkout').send(order({ usePoints: true }));
  assert.deepEqual([res.body.order.pointsUsed, res.body.order.paid], [10, 320]);
});
