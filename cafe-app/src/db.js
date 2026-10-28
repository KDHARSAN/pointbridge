import { DatabaseSync } from 'node:sqlite';

const MENU = [
  ['Cappuccino', '☕', 150],
  ['Cold Brew', '🧊', 180],
  ['Masala Chai', '🫖', 90],
  ['Blueberry Muffin', '🧁', 120],
  ['Paneer Sandwich', '🥪', 200],
  ['Chocolate Brownie', '🍫', 140],
];

// The café's own database: its menu and its orders. Loyalty points live in the Loyalty Service, not here.
export function openDb(file = ':memory:') {
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS menu_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      emoji TEXT NOT NULL,
      price INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT,
      items TEXT NOT NULL,
      total INTEGER NOT NULL,
      pointsUsed INTEGER NOT NULL DEFAULT 0,
      paid INTEGER NOT NULL,
      pointsEarned INTEGER NOT NULL DEFAULT 0,
      loyaltyStatus TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
  `);
  if (db.prepare('SELECT COUNT(*) AS n FROM menu_items').get().n === 0) {
    const insert = db.prepare('INSERT INTO menu_items (name, emoji, price) VALUES (?, ?, ?)');
    for (const item of MENU) insert.run(...item);
  }
  return db;
}
