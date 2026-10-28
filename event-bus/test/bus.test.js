import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { io as connect } from 'socket.io-client';
import { createBus } from '../src/app.js';

async function startBus() {
  const bus = createBus();
  await new Promise((r) => bus.httpServer.listen(0, r));
  const url = `http://localhost:${bus.httpServer.address().port}`;
  return { bus, url, close: () => { bus.io.close(); } };
}

const connected = (url) => new Promise((resolve) => {
  const socket = connect(url, { transports: ['websocket'] });
  socket.on('connect', () => resolve(socket));
});

test('two connected clients both receive an event POSTed to /publish', async () => {
  const { url, close } = await startBus();
  const [a, b] = await Promise.all([connected(url), connected(url)]);
  const got = Promise.all([a, b].map((s) => new Promise((r) => s.once('event', r))));
  const evt = { id: 42, type: 'TrackRevoked', trackId: 1, actor: 'artist:Nova', at: 'x', track: { id: 1 } };
  const res = await request(url).post('/publish').send(evt);
  assert.equal(res.status, 202);
  assert.equal(res.body.delivered, 2);
  const [ea, eb] = await got;
  assert.equal(ea.id, 42);
  assert.equal(eb.id, 42);
  a.close(); b.close(); close();
});

test('POST /publish {} -> 400', async () => {
  const { url, close } = await startBus();
  const res = await request(url).post('/publish').send({});
  assert.equal(res.status, 400);
  close();
});
