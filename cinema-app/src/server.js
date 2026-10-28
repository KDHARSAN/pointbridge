import express from 'express';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { createLoyaltyClient, createLoyaltyFeed } from '../../loyalty-client/index.js';

const PORT = Number(process.env.PORT ?? 3002);
const here = (p) => fileURLToPath(new URL(p, import.meta.url));

const loyalty = createLoyaltyClient({
  baseUrl: process.env.LOYALTY_URL ?? 'http://localhost:5001',
  clientId: 'cinema',
  apiKey: process.env.CINEMA_API_KEY ?? 'cinema-dev-key',
});
const live = createLoyaltyFeed({ busUrl: process.env.BUS_URL ?? 'http://localhost:5002' });

const app = createApp({ db: openDb(here('../cinema.db')), loyalty, live });
app.use(express.static(here('../public')));
app.use(express.static(here('../../loyalty-client/browser')));
app.listen(PORT, () => console.log(`Cinema monolith on http://localhost:${PORT}`));
