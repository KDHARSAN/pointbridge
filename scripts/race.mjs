// Demo: the Café and the Cinema try to spend the same 100 points at the same instant.
// The Loyalty Service settles it in one transaction: exactly one wins, the other gets 409.
const BASE = process.env.LOYALTY_URL ?? 'http://localhost:5001';
const KEYS = { cafe: 'cafe-dev-key', cinema: 'cinema-dev-key' };
const PHONE = '9000000099';
const run = Date.now();

const call = (client, path, body) => fetch(BASE + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Client-Id': client, 'X-Api-Key': KEYS[client] },
  body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json() }));

await call('cafe', '/members', { phone: PHONE, name: 'Race Tester' });
const { body } = await call('cafe', `/members/${PHONE}/earn`, { amount: 1000, reference: `race-topup-${run}` });
const start = body.member.balance;
console.log(`Balance before: ${start} points. Both apps now try to spend all ${start} at once…`);

const [cafe, cinema] = await Promise.all([
  call('cafe', `/members/${PHONE}/redeem`, { points: start, reference: `race-${run}` }),
  call('cinema', `/members/${PHONE}/redeem`, { points: start, reference: `race-${run}` }),
]);
for (const [name, r] of [['Café', cafe], ['Cinema', cinema]]) {
  console.log(`  ${name.padEnd(7)} -> HTTP ${r.status} ${r.status === 200 ? `spent ${r.body.points}, balance ${r.body.member.balance}` : r.body.error}`);
}
