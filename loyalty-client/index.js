// The one client library every PointBridge partner app uses to reach the Loyalty Points Service:
// the REST contract (createLoyaltyClient) and the event contract (createLoyaltyFeed) in one place.
import { io } from 'socket.io-client';

export class LoyaltyError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status; // HTTP status from the service, or 0 when the service is unreachable
  }
}

// A timeout can hide a change that did commit. Every call carries an idempotency reference,
// so repeating it once is safe and settles whether it happened.
export async function retryOnce(call) {
  try {
    return await call();
  } catch (err) {
    if (err instanceof LoyaltyError && err.status === 0) return call();
    throw err;
  }
}

// The loyalty half of a partner's checkout, shared by every partner app.
// Spends points if asked (never more than the balance or the bill), then earns on what was paid.
// Throws LoyaltyError if the spend is refused or can't be confirmed: the caller must undo its own sale.
// An earn that still fails after a retry doesn't throw; the sale stands with loyaltyStatus 'failed'.
export async function settlePurchase(loyalty, { phone, member, total, usePoints, reference }) {
  let pointsUsed = 0;
  const wanted = usePoints && member ? Math.min(member.balance, total) : 0;
  if (wanted > 0) {
    const spent = await retryOnce(() => loyalty.redeem(phone, wanted, reference));
    ({ member } = spent);
    pointsUsed = spent.points;
  }

  const paid = total - pointsUsed;
  let pointsEarned = 0;
  let loyaltyStatus = member ? 'ok' : 'failed';
  if (member && paid > 0) {
    try {
      const earned = await retryOnce(() => loyalty.earn(phone, paid, reference));
      ({ member } = earned);
      pointsEarned = earned.points;
    } catch (err) {
      if (!(err instanceof LoyaltyError)) throw err;
      loyaltyStatus = 'failed';
    }
  }
  return { member, pointsUsed, paid, pointsEarned, loyaltyStatus };
}

export function createLoyaltyClient({ baseUrl, clientId, apiKey, timeoutMs = 3000 }) {
  async function call(method, path, body) {
    let res;
    try {
      res = await fetch(baseUrl + path, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Client-Id': clientId, 'X-Api-Key': apiKey },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new LoyaltyError(0, 'Loyalty service unavailable');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new LoyaltyError(res.status, data.error ?? `Loyalty service error (${res.status})`);
    return data;
  }

  const member = (phone) => `/members/${encodeURIComponent(phone)}`;

  const client = {
    enroll: (phone, name) => call('POST', '/members', { phone, name }),
    getMember: (phone) => call('GET', member(phone)),
    earn: (phone, amount, reference) => call('POST', `${member(phone)}/earn`, { amount, reference }),
    redeem: (phone, points, reference) => call('POST', `${member(phone)}/redeem`, { points, reference }),
    transactions: (phone) => call('GET', `${member(phone)}/transactions`),

    // Existing members are recognised in every partner app; new ones need a name to join.
    async findOrEnroll(phone, name) {
      try {
        return await client.getMember(phone);
      } catch (err) {
        if (err.status !== 404) throw err;
        if (!name?.trim()) throw new LoyaltyError(400, 'name is required to join PointBridge');
        return client.enroll(phone, name);
      }
    },
  };
  return client;
}

// Subscribes this app's server to the Event Bus and relays every loyalty event to its own
// browser pages as Server-Sent Events. Returns an Express-style handler for GET /api/live.
export function createLoyaltyFeed({ busUrl }) {
  const pages = new Set();
  const socket = io(busUrl);
  const send = (res, data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const broadcast = (data) => pages.forEach((res) => send(res, data));

  socket.on('connect', () => broadcast({ type: 'BusStatus', connected: true }));
  socket.on('disconnect', () => broadcast({ type: 'BusStatus', connected: false }));
  socket.on('event', broadcast);

  return function live(req, res) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    send(res, { type: 'BusStatus', connected: socket.connected });
    pages.add(res);
    req.on('close', () => pages.delete(res));
  };
}
