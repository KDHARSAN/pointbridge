import { randomUUID } from 'node:crypto';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { enroll, getMember, applyPoints, listTransactions, listMembers, recentLedger } from './repo.js';

export const RUPEES_PER_POINT_EARNED = 10;

const isPhone = (v) => typeof v === 'string' && /^\d{10}$/.test(v);
const isText = (v) => typeof v === 'string' && v.trim() !== '';
const isPositiveInt = (v) => Number.isInteger(v) && v > 0;

// clients: { clientId: apiKey } — the registry of applications allowed to use this service.
export function createApp({ db, clients, publish = () => {} }) {
  const app = express();
  app.use(express.json());

  app.get('/health', (req, res) => res.json({ ok: true }));

  // Read-only operator dashboard, open without a key.
  // shortcut: unauthenticated admin view for the local demo; put it behind staff login before any real deployment.
  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));
  app.get('/admin/overview', (req, res) => {
    res.json({ clients: Object.keys(clients), members: listMembers(db), ledger: recentLedger(db) });
  });

  app.use((req, res, next) => {
    const id = req.get('X-Client-Id');
    if (!id || !Object.hasOwn(clients, id) || clients[id] !== req.get('X-Api-Key')) {
      return res.status(401).json({ error: 'Unknown client or wrong API key' });
    }
    req.client = id;
    next();
  });

  // Called only after the change is committed, so subscribers never see a change that didn't happen.
  const emit = (type, req, member, points = 0) => publish({
    id: randomUUID(), type, phone: member.phone, source: req.client, points, at: new Date().toISOString(), member,
  });

  const findMember = (req, res) => {
    const member = getMember(db, req.params.phone);
    if (!member) res.status(404).json({ error: 'Member not found' });
    return member;
  };

  app.post('/members', (req, res) => {
    const { phone, name } = req.body;
    if (!isPhone(phone)) return res.status(400).json({ error: 'phone must be 10 digits' });
    if (!isText(name)) return res.status(400).json({ error: 'name is required' });
    const { member, created } = enroll(db, { phone, name });
    if (created) emit('MemberEnrolled', req, member);
    res.status(created ? 201 : 200).json(member);
  });

  app.get('/members/:phone', (req, res) => {
    const member = findMember(req, res);
    if (member) res.json(member);
  });

  app.get('/members/:phone/transactions', (req, res) => {
    if (findMember(req, res)) res.json(listTransactions(db, req.params.phone));
  });

  const change = (req, res, type, points) => {
    if (!isText(req.body.reference)) return res.status(400).json({ error: 'reference is required' });
    if (!findMember(req, res)) return;
    if (points === 0) return res.json({ member: getMember(db, req.params.phone), points: 0 });
    const result = applyPoints(db, { phone: req.params.phone, type, points, source: req.client, reference: req.body.reference });
    if (result.insufficient) return res.status(409).json({ error: 'Not enough points' });
    if (result.conflict) return res.status(409).json({ error: 'reference already used for a different member' });
    if (!result.replayed) emit(type === 'earn' ? 'PointsEarned' : 'PointsRedeemed', req, result.member, result.points);
    res.json({ member: result.member, points: result.points });
  };

  app.post('/members/:phone/earn', (req, res) => {
    const { amount } = req.body;
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'amount must be a positive number of rupees' });
    }
    change(req, res, 'earn', Math.floor(amount / RUPEES_PER_POINT_EARNED));
  });

  app.post('/members/:phone/redeem', (req, res) => {
    if (!isPositiveInt(req.body.points)) return res.status(400).json({ error: 'points must be a positive whole number' });
    change(req, res, 'redeem', req.body.points);
  });

  return app;
}
