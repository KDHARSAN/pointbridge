import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { createPublisher } from './publisher.js';
import { CLIENTS } from './clients.js';

const PORT = Number(process.env.PORT ?? 5001);
const db = openDb(fileURLToPath(new URL('../loyalty.db', import.meta.url)));
const publish = createPublisher(process.env.BUS_URL ?? 'http://localhost:5002');

createApp({ db, clients: CLIENTS, publish }).listen(PORT, () => console.log(`Loyalty Points Service on http://localhost:${PORT}`));
