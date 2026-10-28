import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { LoyaltyError } from '../../loyalty-client/index.js';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';

const PHONE = '9876543210';

function stubLoyalty({ balance = 0, down = false, earnDown = false } = {}) {
  const calls = [];
  const member = { phone: PHONE, name: 'Priya', balance, tier: 'Silver' };
  const guard = (op) => {
    if (down || (op === 'earn' && earnDown)) throw new LoyaltyError(0, 'Loyalty service unavailable');
  };
  return {
    calls,
    async findOrEnroll() { guard(); calls.push(['findOrEnroll']); return { ...member }; },
    async getMember() { guard(); return { ...member }; },
    async redeem(phone, points, reference) {
      guard();
      calls.push(['redeem', points, reference]);
      if (points > member.balance) throw new LoyaltyError(409, 'Not enough points');
      member.balance -= points;
      return { member: { ...member }, points };
    },
    async earn(phone, amount, reference) {
      guard('earn');
      calls.push(['earn', amount, reference]);
      member.balance += Math.floor(amount / 10);
      return { member: { ...member }, points: Math.floor(amount / 10) };
    },
  };
}

function setup(opts) {
  const db = openDb();
  const loyalty = stubLoyalty(opts);
  const app = createApp({ db, loyalty });
  const seatsLeft = (showId) => db.prepare('SELECT seatsLeft FROM shows WHERE id = ?').get(showId).seatsLeft;
  return { db, loyalty, app, seatsLeft };
}

// Seed: show 1 = ₹200 with 40 seats; show 2 = ₹250; the last show has only 3 seats left (see db.js).
const book = (extra) => ({ phone: PHONE, showId: 1, seats: 2, ...extra });

test('GET /api/movies lists movies with their shows', async () => {
  const { app } = setup();
  const movies = (await request(app).get('/api/movies')).body;
  assert.equal(movies.length, 4);
  assert.ok(movies.every((m) => m.shows.length >= 2));
  assert.deepEqual([movies[0].shows[0].price, movies[0].shows[0].seatsLeft], [200, 40]);
});

test('booking 2 seats at ₹200 -> total 400, earns 40, seats drop by 2', async () => {
  const { app, loyalty, seatsLeft } = setup();
  const res = await request(app).post('/api/bookings').send(book());
  assert.equal(res.status, 201);
  const b = res.body.booking;
  assert.deepEqual([b.total, b.paid, b.pointsEarned, b.loyaltyStatus], [400, 400, 40, 'ok']);
  assert.equal(seatsLeft(1), 38);
  const [op, amount, ref] = loyalty.calls.at(-1);
  assert.deepEqual([op, amount], ['earn', 400]);
  assert.match(ref, new RegExp(`^cinema-booking-${b.id}-`));
});

test('using points spends min(balance,total) and earns on the rest', async () => {
  const { app } = setup({ balance: 150 });
  const b = (await request(app).post('/api/bookings').send(book({ usePoints: true }))).body.booking;
  assert.deepEqual([b.pointsUsed, b.paid, b.pointsEarned], [150, 250, 25]);
});

test('more seats than left -> 409, loyalty untouched, seats unchanged', async () => {
  const { db, app, loyalty, seatsLeft } = setup({ balance: 100 });
  const small = db.prepare('SELECT id FROM shows WHERE seatsLeft = 3').get().id;
  const res = await request(app).post('/api/bookings').send(book({ showId: small, seats: 4, usePoints: true }));
  assert.equal(res.status, 409);
  assert.match(res.body.error, /Not enough seats/);
  assert.equal(seatsLeft(small), 3);
  assert.equal(loyalty.calls.filter((c) => c[0] === 'redeem').length, 0);
});

test('redeem refused -> 409, no booking kept, seats restored', async () => {
  const { app, loyalty, seatsLeft } = setup({ balance: 50 });
  loyalty.redeem = async () => { throw new LoyaltyError(409, 'Not enough points'); };
  const res = await request(app).post('/api/bookings').send(book({ usePoints: true }));
  assert.equal(res.status, 409);
  assert.equal(seatsLeft(1), 40);
  assert.equal((await request(app).get('/api/bookings')).body.length, 0);
});

test('invalid input -> 400 before loyalty is called', async () => {
  const { app, loyalty } = setup();
  for (const body of [book({ showId: 999 }), book({ seats: 0 }), book({ seats: 11 }), book({ seats: 1.5 }), book({ phone: '12' })]) {
    assert.equal((await request(app).post('/api/bookings').send(body)).status, 400, JSON.stringify(body));
  }
  assert.equal(loyalty.calls.length, 0);
});

test('loyalty down: booking saved with status failed; with usePoints -> 503 and seats untouched', async () => {
  const { app, seatsLeft } = setup({ down: true });
  const ok = await request(app).post('/api/bookings').send(book());
  assert.equal(ok.status, 201);
  assert.equal(ok.body.booking.loyaltyStatus, 'failed');
  const refused = await request(app).post('/api/bookings').send(book({ usePoints: true }));
  assert.equal(refused.status, 503);
  assert.equal(seatsLeft(1), 38);
});

test('GET /api/bookings includes movie title and show time', async () => {
  const { app } = setup();
  await request(app).post('/api/bookings').send(book());
  const [b] = (await request(app).get('/api/bookings')).body;
  assert.ok(b.title && b.startsAt);
});

test('redeem timeout: retried once with the same reference, booking kept', async () => {
  const { app, loyalty, seatsLeft } = setup({ balance: 40 });
  const realRedeem = loyalty.redeem;
  const refs = [];
  loyalty.redeem = async (phone, points, ref) => {
    refs.push(ref);
    if (refs.length === 1) throw new LoyaltyError(0, 'Loyalty service unavailable');
    return realRedeem(phone, points, ref);
  };
  const res = await request(app).post('/api/bookings').send(book({ usePoints: true }));
  assert.equal(res.status, 201);
  assert.deepEqual([res.body.booking.pointsUsed, refs[0] === refs[1], seatsLeft(1)], [40, true, 38]);
});

test('malformed JSON -> 400 JSON error', async () => {
  const { app } = setup();
  const res = await request(app).post('/api/bookings').set('Content-Type', 'application/json').send('{"showId": ');
  assert.equal(res.status, 400);
  assert.match(res.type, /json/);
});
