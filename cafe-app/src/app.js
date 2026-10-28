import express from 'express';
import { randomUUID } from 'node:crypto';
import { LoyaltyError, settlePurchase } from '../../loyalty-client/index.js';

const isPhone = (v) => typeof v === 'string' && /^\d{10}$/.test(v);
const toOrder = (row) => ({ ...row, items: JSON.parse(row.items) });

// Express 4 doesn't catch rejected promises from async handlers.
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

function sendLoyaltyError(res, err) {
  if (!(err instanceof LoyaltyError)) throw err;
  if (err.status === 0) return res.status(503).json({ error: err.message });
  res.status(err.status).json({ error: err.message });
}

// Keep API errors JSON (malformed bodies included) and never send stack traces to the browser.
function jsonErrors(err, req, res, next) {
  const status = err.status ?? err.statusCode ?? 500;
  if (status >= 500) console.error(err);
  const message = err.type === 'entity.parse.failed' ? 'Request body must be valid JSON' : err.message;
  res.status(status).json({ error: status < 500 ? message : 'Something went wrong' });
}

// loyalty: a client from loyalty-client (the shared Loyalty Points Service), injected so tests can stub it.
export function createApp({ db, loyalty, live }) {
  const app = express();
  app.use(express.json());

  const menuItem = db.prepare('SELECT * FROM menu_items WHERE id = ?');

  app.get('/api/menu', (req, res) => {
    res.json(db.prepare('SELECT * FROM menu_items ORDER BY id').all().map((r) => ({ ...r })));
  });

  app.get('/api/orders', (req, res) => {
    res.json(db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 20').all().map(toOrder));
  });

  app.get('/api/member/:phone', wrap(async (req, res) => {
    try {
      res.json(await loyalty.getMember(req.params.phone));
    } catch (err) {
      sendLoyaltyError(res, err);
    }
  }));

  if (live) app.get('/api/live', live);

  app.post('/api/checkout', wrap(async (req, res) => {
    const { phone, name, items, usePoints = false } = req.body;

    // 1. Validate everything local before touching the shared service.
    if (phone !== undefined && phone !== '' && !isPhone(phone)) return res.status(400).json({ error: 'phone must be 10 digits' });
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'add at least one item' });
    const lines = [];
    for (const line of items) {
      if (!line || typeof line !== 'object') return res.status(400).json({ error: 'each item needs menuId and qty' });
      const { menuId, qty } = line;
      const item = menuItem.get(menuId);
      if (!item) return res.status(400).json({ error: `unknown menu item ${menuId}` });
      if (!Number.isInteger(qty) || qty < 1 || qty > 20) return res.status(400).json({ error: 'qty must be 1–20' });
      lines.push({ menuId, name: item.name, price: item.price, qty });
    }
    const total = lines.reduce((sum, l) => sum + l.price * l.qty, 0);

    const save = (fields) => {
      const { lastInsertRowid } = db.prepare(`INSERT INTO orders (phone, items, total, pointsUsed, paid, pointsEarned, loyaltyStatus, createdAt)
        VALUES (?, ?, ?, 0, ?, 0, ?, ?)`).run(fields.phone, JSON.stringify(lines), total, total, fields.loyaltyStatus, new Date().toISOString());
      return Number(lastInsertRowid);
    };
    const load = (id) => toOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(id));

    if (!phone) return res.status(201).json({ order: load(save({ phone: null, loyaltyStatus: 'none' })), member: null });

    // 2. Recognise (or enroll) the customer through the shared service.
    let member = null;
    try {
      member = await loyalty.findOrEnroll(phone, name);
    } catch (err) {
      if (!(err instanceof LoyaltyError) || err.status !== 0) return sendLoyaltyError(res, err);
      // Service down: the café still sells coffee, it just can't touch points.
      if (usePoints) return res.status(503).json({ error: 'Loyalty service unavailable, so points cannot be used right now' });
    }

    // 3. Save the order, then give it an idempotency reference that stays unique even if cafe.db is reset.
    const id = save({ phone, loyaltyStatus: 'pending' });
    const reference = `cafe-order-${id}-${randomUUID()}`;

    // 4. Spend and earn points through the shared checkout flow.
    let settled;
    try {
      settled = await settlePurchase(loyalty, { phone, member, total, usePoints, reference });
    } catch (err) {
      db.prepare('DELETE FROM orders WHERE id = ?').run(id); // the spend didn't go through, so drop the order
      return sendLoyaltyError(res, err);
    }

    db.prepare('UPDATE orders SET pointsUsed = ?, paid = ?, pointsEarned = ?, loyaltyStatus = ? WHERE id = ?')
      .run(settled.pointsUsed, settled.paid, settled.pointsEarned, settled.loyaltyStatus, id);
    res.status(201).json({ order: load(id), member: settled.member });
  }));

  app.use(jsonErrors);
  return app;
}
