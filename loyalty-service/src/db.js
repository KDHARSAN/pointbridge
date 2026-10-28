import { DatabaseSync } from 'node:sqlite';

export function openDb(file = ':memory:') {
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS members (
      phone TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
      lifetimeEarned INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL REFERENCES members(phone),
      type TEXT NOT NULL CHECK (type IN ('earn', 'redeem')),
      points INTEGER NOT NULL,
      source TEXT NOT NULL,
      reference TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      UNIQUE (source, type, reference)
    );
  `);
  return db;
}
