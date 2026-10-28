import http from 'node:http';
import express from 'express';
import { Server } from 'socket.io';

// The integration layer: services POST events here, every subscribed client receives them.
export function createBus() {
  const app = express();
  app.use(express.json({ limit: '100kb' }));
  const httpServer = http.createServer(app);
  const io = new Server(httpServer, { cors: { origin: '*' } });

  app.get('/health', (req, res) => res.json({ ok: true, clients: io.engine.clientsCount }));

  app.post('/publish', (req, res) => {
    if (typeof req.body?.type !== 'string') return res.status(400).json({ error: 'event type is required' });
    io.emit('event', req.body);
    console.log(`[bus] ${req.body.type} -> ${io.engine.clientsCount} client(s)`);
    res.status(202).json({ delivered: io.engine.clientsCount });
  });

  return { httpServer, io };
}
