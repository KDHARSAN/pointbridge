import { DatabaseSync } from 'node:sqlite';

// [title, genre, minutes, poster emoji, [[startsAt, price, seats], ...]]
const MOVIES = [
  ['Neon Monsoon', 'Sci-Fi', 132, '🌧️', [['18:30', 200, 40], ['21:45', 250, 40]]],
  ['The Last Chai Stall', 'Drama', 118, '🫖', [['17:00', 180, 40], ['20:15', 220, 40]]],
  ['Cricket Kings', 'Sports', 145, '🏏', [['16:00', 200, 40], ['19:30', 250, 40]]],
  ['Ghosts of Ooty', 'Horror', 104, '👻', [['22:00', 220, 40], ['23:59', 180, 3]]],
];

// The cinema's own database: movies, shows and bookings. Loyalty points live in the Loyalty Service, not here.
export function openDb(file = ':memory:') {
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS movies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      genre TEXT NOT NULL,
      minutes INTEGER NOT NULL,
      poster TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS shows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      movieId INTEGER NOT NULL REFERENCES movies(id),
      startsAt TEXT NOT NULL,
      price INTEGER NOT NULL,
      seatsLeft INTEGER NOT NULL CHECK (seatsLeft >= 0)
    );
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT,
      showId INTEGER NOT NULL REFERENCES shows(id),
      seats INTEGER NOT NULL,
      total INTEGER NOT NULL,
      pointsUsed INTEGER NOT NULL DEFAULT 0,
      paid INTEGER NOT NULL,
      pointsEarned INTEGER NOT NULL DEFAULT 0,
      loyaltyStatus TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
  `);
  if (db.prepare('SELECT COUNT(*) AS n FROM movies').get().n === 0) {
    for (const [title, genre, minutes, poster, shows] of MOVIES) {
      const { lastInsertRowid } = db.prepare('INSERT INTO movies (title, genre, minutes, poster) VALUES (?, ?, ?, ?)')
        .run(title, genre, minutes, poster);
      for (const [startsAt, price, seats] of shows) {
        db.prepare('INSERT INTO shows (movieId, startsAt, price, seatsLeft) VALUES (?, ?, ?, ?)')
          .run(lastInsertRowid, startsAt, price, seats);
      }
    }
  }
  return db;
}
