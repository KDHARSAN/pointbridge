import express from 'express';
import { LoyaltyError } from '../../loyalty-client/index.js';

const isPhone = (v) => typeof v === 'string' && /^\d{10}$/.test(v);
const MAX_SEATS = 10;

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

  const plain = (row) => ({ ...row });

  // Seats are taken and the booking row created together, so two buyers can't oversell a show.
  function reserve({ phone, show, seats, total }) {
    db.exec('BEGIN');
    try {
      const { changes } = db.prepare('UPDATE shows SET seatsLeft = seatsLeft - ? WHERE id = ? AND seatsLeft >= ?')
        .run(seats, show.id, seats);
      if (changes === 0) {
        db.exec('ROLLBACK');
        return null;
      }
      const { lastInsertRowid } = db.prepare(`INSERT INTO bookings (phone, showId, seats, total, paid, loyaltyStatus, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(phone || null, show.id, seats, total, total, phone ? 'pending' : 'none', new Date().toISOString());
      db.exec('COMMIT');
      return Number(lastInsertRowid);
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  function release(id, show, seats) {
    db.exec('BEGIN');
    db.prepare('DELETE FROM bookings WHERE id = ?').run(id);
    db.prepare('UPDATE shows SET seatsLeft = seatsLeft + ? WHERE id = ?').run(seats, show.id);
    db.exec('COMMIT');
  }

  const load = (id) => plain(db.prepare('SELECT * FROM bookings WHERE id = ?').get(id));

  app.get('/api/movies', (req, res) => {
    const shows = db.prepare('SELECT * FROM shows ORDER BY id').all().map(plain);
    res.json(db.prepare('SELECT * FROM movies ORDER BY id').all().map((m) => ({
      ...m, shows: shows.filter((s) => s.movieId === m.id),
    })));
  });

  app.get('/api/bookings', (req, res) => {
    res.json(db.prepare(`SELECT b.*, m.title, m.poster, s.startsAt FROM bookings b
      JOIN shows s ON s.id = b.showId JOIN movies m ON m.id = s.movieId ORDER BY b.id DESC LIMIT 20`).all().map(plain));
  });

  app.get('/api/member/:phone', wrap(async (req, res) => {
    try {
      res.json(await loyalty.getMember(req.params.phone));
    } catch (err) {
      sendLoyaltyError(res, err);
    }
  }));

  if (live) app.get('/api/live', live);

  app.post('/api/bookings', wrap(async (req, res) => {
    const { phone, name, showId, seats, usePoints = false } = req.body;

    // 1. Validate everything local before touching the shared service.
    if (phone !== undefined && phone !== '' && !isPhone(phone)) return res.status(400).json({ error: 'phone must be 10 digits' });
    const show = db.prepare('SELECT * FROM shows WHERE id = ?').get(showId);
    if (!show) return res.status(400).json({ error: 'unknown show' });
    if (!Number.isInteger(seats) || seats < 1 || seats > MAX_SEATS) return res.status(400).json({ error: `seats must be 1–${MAX_SEATS}` });
    if (show.seatsLeft < seats) return res.status(409).json({ error: `Not enough seats (${show.seatsLeft} left)` });
    const total = show.price * seats;

    // 2. Recognise (or enroll) the customer through the shared service.
    let member = null;
    if (phone) {
      try {
        member = await loyalty.findOrEnroll(phone, name);
      } catch (err) {
        if (!(err instanceof LoyaltyError) || err.status !== 0) return sendLoyaltyError(res, err);
        if (usePoints) return res.status(503).json({ error: 'Loyalty service unavailable, so points cannot be used right now' });
      }
    }

    // 3. Take the seats; the booking id becomes the idempotency reference for the service.
    const id = reserve({ phone, show, seats, total });
    if (!id) return res.status(409).json({ error: 'Not enough seats' });
    if (!phone) return res.status(201).json({ booking: load(id), member: null });
    const reference = `cinema-booking-${id}`;

    let pointsUsed = 0;
    const wanted = usePoints && member ? Math.min(member.balance, total) : 0;
    if (wanted > 0) {
      try {
        ({ member } = await loyalty.redeem(phone, wanted, reference));
        pointsUsed = wanted;
      } catch (err) {
        release(id, show, seats); // nothing was spent, so give the seats back
        return sendLoyaltyError(res, err);
      }
    }

    // 4. Earn on what was actually paid. If this fails the booking stands and is flagged.
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

    db.prepare('UPDATE bookings SET pointsUsed = ?, paid = ?, pointsEarned = ?, loyaltyStatus = ? WHERE id = ?')
      .run(pointsUsed, paid, pointsEarned, loyaltyStatus, id);
    res.status(201).json({ booking: load(id), member });
  }));

  return app;
}
