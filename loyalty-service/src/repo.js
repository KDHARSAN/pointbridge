export const GOLD_AT = 500;

const toMember = (row) => row && ({ ...row, tier: row.lifetimeEarned >= GOLD_AT ? 'Gold' : 'Silver' });
const plain = (row) => (row ? { ...row } : null);

export function getMember(db, phone) {
  return toMember(plain(db.prepare('SELECT * FROM members WHERE phone = ?').get(phone)));
}

// Returns { member, created } — enrolling an existing phone is not an error, it just returns the member.
export function enroll(db, { phone, name }) {
  const now = new Date().toISOString();
  const { changes } = db.prepare('INSERT OR IGNORE INTO members (phone, name, createdAt, updatedAt) VALUES (?, ?, ?, ?)')
    .run(phone, name.trim(), now, now);
  return { member: getMember(db, phone), created: changes === 1 };
}

// One transaction: idempotency check, balance change (never below zero), ledger row.
// Returns { member, points, replayed } or { insufficient: true }.
export function applyPoints(db, { phone, type, points, source, reference }) {
  db.exec('BEGIN');
  try {
    const prior = db.prepare('SELECT points FROM ledger WHERE source = ? AND type = ? AND reference = ?')
      .get(source, type, reference);
    if (prior) {
      db.exec('COMMIT');
      return { member: getMember(db, phone), points: prior.points, replayed: true };
    }
    const now = new Date().toISOString();
    const { changes } = type === 'redeem'
      ? db.prepare('UPDATE members SET balance = balance - ?, updatedAt = ? WHERE phone = ? AND balance >= ?')
        .run(points, now, phone, points)
      : db.prepare('UPDATE members SET balance = balance + ?, lifetimeEarned = lifetimeEarned + ?, updatedAt = ? WHERE phone = ?')
        .run(points, points, now, phone);
    if (changes === 0) {
      db.exec('ROLLBACK');
      return { insufficient: true };
    }
    db.prepare('INSERT INTO ledger (phone, type, points, source, reference, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run(phone, type, points, source, reference, now);
    db.exec('COMMIT');
    return { member: getMember(db, phone), points, replayed: false };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function listTransactions(db, phone, limit = 50) {
  return db.prepare('SELECT * FROM ledger WHERE phone = ? ORDER BY id DESC LIMIT ?').all(phone, limit).map(plain);
}
