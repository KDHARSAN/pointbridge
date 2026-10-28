import express from 'express';
import { LoyaltyError } from '../../loyalty-client/index.js';

const isPhone = (v) => typeof v === 'string' && /^\d{10}$/.test(v);
const toOrder = (row) => ({ ...row, items: JSON.parse(row.items) });

// Express 4 doesn't catch rejected promises from async handlers.
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

function sendLoyaltyError(res, err) {
  if (!(err instanceof LoyaltyError)) throw err;
  if (err.status === 0) return res.status(503).json({ error: err.message });
  res.status(err.status).json({ error: err.message });
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
    for (const { menuId, qty } of items) {
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

    // 3. Save the order to get its id; the id becomes the idempotency reference for the service.
    const id = save({ phone, loyaltyStatus: 'pending' });
    const reference = `cafe-order-${id}`;

    let pointsUsed = 0;
    const wanted = usePoints && member ? Math.min(member.balance, total) : 0;
    if (wanted > 0) {
      try {
        ({ member } = await loyalty.redeem(phone, wanted, reference));
        pointsUsed = wanted;
      } catch (err) {
        db.prepare('DELETE FROM orders WHERE id = ?').run(id); // nothing was spent, so drop the order
        return sendLoyaltyError(res, err);
      }
    }

    // 4. Earn on what was actually paid. If this fails the sale stands and is flagged.
    const paid = total - pointsUsed;
    let pointsEarned = 0;
    let loyaltyStatus = member ? 'ok' : 'failed';
    if (member && paid > 0) {
      try {
        const earned = await loyalty.earn(phone, paid, reference);
        ({ member } = earned);
        pointsEarned = earned.points;
      } catch (err) {
        if (!(err instanceof LoyaltyError)) throw err;
        loyaltyStatus = 'failed';
      }
    }

    db.prepare('UPDATE orders SET pointsUsed = ?, paid = ?, pointsEarned = ?, loyaltyStatus = ? WHERE id = ?')
      .run(pointsUsed, paid, pointsEarned, loyaltyStatus, id);
    res.status(201).json({ order: load(id), member });
  }));

  return app;
}
