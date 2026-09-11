#!/usr/bin/env node
// Host-run fallback relay for hostile NATs. Expose this only through an
// outbound tunnel (for example cloudflared), never by opening your laptop to
// the internet directly.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const port = Number(process.env.PORT || 8787);
const root = join(process.cwd(), 'dist');
const rooms = new Map();
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const server = createServer((request, response) => {
  if (request.url === '/health') return response.end('ok');
  const pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
  const file = join(root, normalize(pathname).replace(/^[/\\]+/, '') || 'index.html');
  const target = existsSync(file) && !file.endsWith('/') ? file : join(root, 'index.html');
  response.setHeader('content-type', types[extname(target)] || 'application/octet-stream');
  createReadStream(target).on('error', () => { response.statusCode = 404; response.end('build missing: run npm run build'); }).pipe(response);
});

server.on('upgrade', (request, socket) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const room = String(url.searchParams.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  const role = url.searchParams.get('role');
  const key = request.headers['sec-websocket-key'];
  if (url.pathname !== '/relay' || room.length !== 6 || !['host', 'guest'].includes(role) || !key) return socket.destroy();
  const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  attach(room, role, socket);
});

function attach(roomCode, role, socket) {
  let room = rooms.get(roomCode);
  if (!room) rooms.set(roomCode, room = { host: null, guest: null });
  if (room[role]) room[role].destroy();
  room[role] = socket;
  if (role === 'guest' && room.host) sendText(room.host, { type: 'peer_joined' });
  socket.on('data', (chunk) => relayFrames(chunk, socket, room, role));
  socket.on('close', () => {
    if (room[role] !== socket) return;
    room[role] = null;
    const peer = role === 'host' ? room.guest : room.host;
    if (peer) sendText(peer, { type: 'peer_left' });
    if (!room.host && !room.guest) rooms.delete(roomCode);
  });
  socket.on('error', () => socket.destroy());
}

function relayFrames(chunk, source, room, role) {
  source._relayBuffer = Buffer.concat([source._relayBuffer || Buffer.alloc(0), chunk]);
  let buffer = source._relayBuffer;
  while (buffer.length >= 2) {
    const opcode = buffer[0] & 0x0f;
    const masked = Boolean(buffer[1] & 0x80);
    let length = buffer[1] & 0x7f;
    let header = 2;
    if (length === 126) { if (buffer.length < 4) break; length = buffer.readUInt16BE(2); header = 4; }
    if (length === 127) { if (buffer.length < 10) break; length = Number(buffer.readBigUInt64BE(2)); header = 10; }
    if (!masked || !Number.isSafeInteger(length) || buffer.length < header + 4 + length) break;
    const mask = buffer.subarray(header, header + 4);
    const payload = Buffer.allocUnsafe(length);
    for (let i = 0; i < length; i += 1) payload[i] = buffer[header + 4 + i] ^ mask[i % 4];
    buffer = buffer.subarray(header + 4 + length);
    if (opcode === 8) return source.end();
    if (opcode === 9) { source.write(wsFrame(10, payload)); continue; }
    if (opcode !== 1 && opcode !== 2) continue;
    const peer = role === 'host' ? room.guest : room.host;
    if (peer?.writable) peer.write(wsFrame(opcode, payload));
  }
  source._relayBuffer = buffer;
}

function sendText(socket, value) {
  const payload = Buffer.from(JSON.stringify(value));
  if (socket.writable) socket.write(wsFrame(1, payload));
}

function wsFrame(opcode, payload) {
  const length = payload.length;
  if (length < 126) return Buffer.concat([Buffer.from([0x80 | opcode, length]), payload]);
  if (length <= 0xffff) { const header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(length, 2); return Buffer.concat([header, payload]); }
  const header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(length), 2); return Buffer.concat([header, payload]);
}

server.listen(port, '127.0.0.1', () => console.log(`framebound relay listening on http://127.0.0.1:${port}`));
