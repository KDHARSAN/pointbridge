import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { CLIENTS } from './clients.js';

const PORT = Number(process.env.PORT ?? 5001);
const db = openDb(fileURLToPath(new URL('../loyalty.db', import.meta.url)));

createApp({ db, clients: CLIENTS }).listen(PORT, () => console.log(`Loyalty Points Service on http://localhost:${PORT}`));
