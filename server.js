#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = __dirname;
const STEPS = 16;
const MAX_PLAYERS = 5;
const ROLES = ['drums', 'bass', 'chords', 'melody', 'texture'];
const DEFAULT_VOLUME = 0.78;
const ROOM_TTL_MS = 10 * 60 * 1000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const rooms = new Map();
const clients = new Set();

function safeId(value, fallback = 'jam') {
  const clean = String(value || '').toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return clean || fallback;
}

function safeText(value, max = 160) {
  return String(value || '').replace(/[<>]/g, '').trim().slice(0, max);
}

function uid(prefix = 'm') {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(5).toString('hex')}`;
}

function emptyLoop() {
  return Array.from({ length: STEPS }, () => []);
}

function getRoom(roomId) {
  const id = safeId(roomId);
  if (!rooms.has(id)) {
    rooms.set(id, {
      roomId: id,
      createdAt: Date.now(),
      startedAt: Date.now(),
      bpm: 96,
      hostId: null,
      participants: new Map(),
      tracks: new Map(),
      messages: [],
      clients: new Set(),
      lastEmptyAt: null
    });
  }
  return rooms.get(id);
}

function activePlayers(room) {
  return Array.from(room.participants.values()).filter(p => p.online && p.mode === 'player');
}

function onlineParticipants(room) {
  return Array.from(room.participants.values()).filter(p => p.online);
}

function chooseRole(room, clientId, requestedRole) {
  const existing = room.participants.get(clientId);
  const used = new Set(activePlayers(room).filter(p => p.clientId !== clientId).map(p => p.role));

  if (existing?.mode === 'player' && existing.role && !used.has(existing.role)) {
    return { mode: 'player', role: existing.role };
  }

  if (requestedRole && requestedRole !== 'auto' && ROLES.includes(requestedRole) && !used.has(requestedRole)) {
    return { mode: 'player', role: requestedRole };
  }

  const unused = ROLES.find(role => !used.has(role));
  if (unused) return { mode: 'player', role: unused };
  return { mode: 'audience', role: 'audience' };
}

function ensureHost(room) {
  const online = onlineParticipants(room);
  if (!online.length) {
    room.hostId = null;
    return;
  }
  if (!room.hostId || !room.participants.get(room.hostId)?.online) {
    room.hostId = online[0].clientId;
  }
}

function pushMessage(room, message) {
  room.messages.push({
    id: message.id || uid('msg'),
    name: safeText(message.name || 'room', 28),
    text: safeText(message.text || '', 260),
    role: message.role || 'system',
    mode: message.mode || undefined,
    at: message.at || Date.now()
  });
  room.messages = room.messages.slice(-80);
}

function roomSnapshot(room, client) {
  ensureHost(room);
  const your = room.participants.get(client.clientId) || null;
  return {
    type: 'snapshot',
    serverNow: Date.now(),
    roomId: room.roomId,
    roomStartedAt: room.startedAt,
    bpm: room.bpm,
    maxPlayers: MAX_PLAYERS,
    hostId: room.hostId,
    your: your ? { ...your, isHost: your.clientId === room.hostId } : null,
    participants: Array.from(room.participants.values()).map(p => ({ ...p, isHost: p.clientId === room.hostId })),
    tracks: Array.from(room.tracks.values()),
    messages: room.messages
  };
}

function broadcastSnapshot(room) {
  for (const client of room.clients) {
    sendJson(client, roomSnapshot(room, client));
  }
}

function joinRoom(client, payload) {
  const roomId = safeId(payload.roomId, 'jam');
  const room = getRoom(roomId);

  // One browser identity should only occupy one live socket at a time.
  for (const other of Array.from(room.clients)) {
    if (other !== client && other.clientId === payload.clientId) {
      other.replaced = true;
      other.socket.end();
      room.clients.delete(other);
    }
  }

  client.roomId = roomId;
  client.clientId = safeText(payload.clientId, 80) || uid('client');
  client.name = safeText(payload.name, 28) || 'someone';
  room.clients.add(client);
  room.lastEmptyAt = null;

  const assignment = chooseRole(room, client.clientId, payload.requestedRole);
  const now = Date.now();
  const existing = room.participants.get(client.clientId);
  const participant = {
    clientId: client.clientId,
    name: client.name,
    role: assignment.role,
    mode: assignment.mode,
    online: true,
    joinedAt: existing?.joinedAt || now,
    lastSeen: now
  };

  room.participants.set(client.clientId, participant);

  if (!room.hostId) room.hostId = client.clientId;
  ensureHost(room);

  if (assignment.mode === 'player') {
    const existingTrack = room.tracks.get(client.clientId);
    room.tracks.set(client.clientId, {
      clientId: client.clientId,
      name: client.name,
      role: assignment.role,
      loop: existingTrack?.loop || emptyLoop(),
      at: existingTrack?.at || now,
      updatedAt: existingTrack?.updatedAt || now,
      text: existingTrack?.text || '',
      volume: Number.isFinite(existingTrack?.volume) ? existingTrack.volume : DEFAULT_VOLUME,
      rawCount: existingTrack?.rawCount || 0,
      isAway: false
    });
  }

  const joinText = assignment.mode === 'player'
    ? `${client.name} joined as ${assignment.role}.`
    : `${client.name} joined as audience. The band is full.`;
  pushMessage(room, { name: 'room', role: 'system', text: joinText, at: now });
  broadcastSnapshot(room);
}

function handlePhrase(client, payload) {
  const room = rooms.get(client.roomId);
  if (!room) return;
  const participant = room.participants.get(client.clientId);
  if (!participant) return;

  const now = Date.now();
  const text = safeText(payload.text || '(silent typing)', 260);

  if (participant.mode !== 'player') {
    pushMessage(room, { name: participant.name, role: 'audience', mode: 'audience', text, at: now });
    broadcastSnapshot(room);
    return;
  }

  const loop = sanitizeLoop(payload.loop);
  const existingTrack = room.tracks.get(client.clientId);
  room.tracks.set(client.clientId, {
    clientId: client.clientId,
    name: participant.name,
    role: participant.role,
    loop,
    at: existingTrack?.at || now,
    updatedAt: now,
    text,
    volume: Number.isFinite(payload.volume) ? Math.max(0, Math.min(1.2, payload.volume)) : existingTrack?.volume ?? DEFAULT_VOLUME,
    rawCount: Number(payload.rawCount || 0),
    phraseId: payload.id || uid('phrase'),
    isAway: false
  });
  pushMessage(room, { id: payload.id, name: participant.name, role: participant.role, text, at: now });
  broadcastSnapshot(room);
}

function sanitizeLoop(loop) {
  if (!Array.isArray(loop)) return emptyLoop();
  const out = emptyLoop();
  for (let i = 0; i < Math.min(STEPS, loop.length); i++) {
    const step = Array.isArray(loop[i]) ? loop[i] : [];
    out[i] = step.slice(0, 5).map(note => ({
      key: safeText(note?.key || '', 18),
      velocity: Number.isFinite(note?.velocity) ? Math.max(0.1, Math.min(1, note.velocity)) : 0.6,
      accent: Boolean(note?.accent),
      density: Number.isFinite(note?.density) ? Math.max(1, Math.min(12, note.density)) : 1,
      drum: safeText(note?.drum || '', 20),
      degree: Number.isFinite(note?.degree) ? Math.max(0, Math.min(12, note.degree)) : 0,
      octave: Number.isFinite(note?.octave) ? Math.max(1, Math.min(6, note.octave)) : undefined,
      quality: Number.isFinite(note?.quality) ? Math.max(0, Math.min(4, note.quality)) : undefined,
      texture: safeText(note?.texture || '', 20)
    }));
  }
  return out;
}

function clearMine(client) {
  const room = rooms.get(client.roomId);
  if (!room) return;
  const participant = room.participants.get(client.clientId);
  const track = room.tracks.get(client.clientId);
  if (participant && track) {
    track.loop = emptyLoop();
    track.text = '';
    track.updatedAt = Date.now();
    pushMessage(room, { name: 'room', role: 'system', text: `${participant.name} cleared their loop.` });
    broadcastSnapshot(room);
  }
}

function updateVolume(client, payload) {
  const room = rooms.get(client.roomId);
  if (!room) return;
  const track = room.tracks.get(client.clientId);
  if (track && Number.isFinite(payload.volume)) {
    track.volume = Math.max(0, Math.min(1.2, payload.volume));
    broadcastSnapshot(room);
  }
}

function updateTempo(client, payload) {
  const room = rooms.get(client.roomId);
  if (!room || room.hostId !== client.clientId) return;
  const bpm = Number(payload.bpm);
  if (Number.isFinite(bpm)) {
    room.bpm = Math.max(60, Math.min(150, Math.round(bpm)));
    pushMessage(room, { name: 'room', role: 'system', text: `Tempo changed to ${room.bpm} BPM.` });
    broadcastSnapshot(room);
  }
}

function resetRoom(client) {
  const room = rooms.get(client.roomId);
  if (!room || room.hostId !== client.clientId) return;
  room.startedAt = Date.now();
  room.messages = [];
  for (const track of room.tracks.values()) {
    track.loop = emptyLoop();
    track.text = '';
    track.updatedAt = Date.now();
    track.isAway = false;
  }
  pushMessage(room, { name: 'room', role: 'system', text: `${client.name || 'Host'} reset the room.` });
  broadcastSnapshot(room);
}

function makeDemoLoop(role) {
  const text = ['tap tap melt', 'low notes walking home', 'everything loops eventually', 'typing but make it sing', 'small room big noise'][Math.floor(Math.random() * 5)];
  const loop = emptyLoop();
  text.split('').forEach((key, i) => {
    const step = (i * 2 + (i % 3 === 0 ? 1 : 0)) % STEPS;
    const c = key === ' ' ? 32 : key.codePointAt(0) || 1;
    const note = { key: key === ' ' ? 'Space' : key, velocity: Math.min(1, 0.5 + (c % 6) * 0.07), density: 1 };
    if (role === 'drums') note.drum = i % 4 === 0 ? 'kick' : i % 3 === 0 ? 'snare' : 'hat';
    if (role === 'bass') note.degree = c % 5;
    if (role === 'chords') { note.degree = c % 6; note.quality = c % 3; }
    if (role === 'melody') { note.degree = c % 8; note.octave = 4 + (c % 2); }
    if (role === 'texture') note.texture = i % 3 === 0 ? 'click' : 'grain';
    loop[step].push(note);
  });
  return { text, loop };
}

function addDemo(client) {
  const room = rooms.get(client.roomId);
  if (!room || room.hostId !== client.clientId) return;
  const used = new Set(Array.from(room.tracks.values()).filter(t => !t.clientId.startsWith('demo-')).map(t => t.role));
  const role = ROLES.find(r => !used.has(r)) || ROLES[room.tracks.size % ROLES.length];
  const id = uid('demo');
  const demo = makeDemoLoop(role);
  room.tracks.set(id, {
    clientId: id,
    name: `demo ${role}`,
    role,
    loop: demo.loop,
    at: Date.now(),
    updatedAt: Date.now(),
    text: demo.text,
    volume: 0.66,
    rawCount: demo.text.length,
    isDemo: true
  });
  pushMessage(room, { name: 'room', role: 'system', text: `A demo ${role} layer joined.` });
  broadcastSnapshot(room);
}

function handleMessage(client, raw) {
  let payload;
  try { payload = JSON.parse(raw); }
  catch { return; }
  if (!payload || typeof payload !== 'object') return;

  if (payload.type === 'join') return joinRoom(client, payload);
  if (payload.type === 'phrase') return handlePhrase(client, payload);
  if (payload.type === 'chat') return handlePhrase(client, payload);
  if (payload.type === 'clear_mine') return clearMine(client);
  if (payload.type === 'volume') return updateVolume(client, payload);
  if (payload.type === 'tempo') return updateTempo(client, payload);
  if (payload.type === 'reset_room') return resetRoom(client);
  if (payload.type === 'demo') return addDemo(client);
  if (payload.type === 'ping') return sendJson(client, { type: 'pong', serverNow: Date.now() });
}

function removeClient(client) {
  if (client.closed) return;
  client.closed = true;
  clients.delete(client);
  const room = rooms.get(client.roomId);
  if (!room) return;
  room.clients.delete(client);
  if (client.replaced) return;
  const participant = room.participants.get(client.clientId);
  if (participant) {
    participant.online = false;
    participant.lastSeen = Date.now();
    const track = room.tracks.get(client.clientId);
    if (track) track.isAway = true;
    pushMessage(room, { name: 'room', role: 'system', text: `${participant.name} left. Their last loop stays for now.` });
  }
  ensureHost(room);
  if (room.clients.size) broadcastSnapshot(room);
  else room.lastEmptyAt = Date.now();
}

setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of rooms) {
    if (room.clients.size === 0 && room.lastEmptyAt && now - room.lastEmptyAt > ROOM_TTL_MS) {
      rooms.delete(roomId);
    }
  }
}, 60_000).unref?.();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/' || pathname.startsWith('/r/')) pathname = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) return socket.destroy();
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`,
    '',
    ''
  ].join('\r\n'));

  const client = { socket, buffer: Buffer.alloc(0), clientId: uid('socket'), roomId: null, name: 'someone' };
  clients.add(client);
  socket.on('data', chunk => readFrames(client, chunk));
  socket.on('close', () => removeClient(client));
  socket.on('end', () => removeClient(client));
  socket.on('error', () => removeClient(client));
});

function readFrames(client, chunk) {
  client.buffer = Buffer.concat([client.buffer, chunk]);
  while (client.buffer.length >= 2) {
    const b0 = client.buffer[0];
    const b1 = client.buffer[1];
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) === 0x80;
    let length = b1 & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (client.buffer.length < 4) return;
      length = client.buffer.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (client.buffer.length < 10) return;
      const high = client.buffer.readUInt32BE(2);
      const low = client.buffer.readUInt32BE(6);
      length = high * 2 ** 32 + low;
      offset = 10;
    }
    const maskOffset = offset;
    if (masked) offset += 4;
    if (client.buffer.length < offset + length) return;
    let payload = client.buffer.slice(offset, offset + length);
    if (masked) {
      const mask = client.buffer.slice(maskOffset, maskOffset + 4);
      payload = payload.map((byte, i) => byte ^ mask[i % 4]);
    }
    client.buffer = client.buffer.slice(offset + length);

    if (opcode === 0x8) {
      client.socket.end();
      return;
    }
    if (opcode === 0x9) {
      sendFrame(client.socket, Buffer.from(payload), 0xA);
      continue;
    }
    if (opcode === 0x1) handleMessage(client, payload.toString('utf8'));
  }
}

function sendJson(client, obj) {
  if (!client.socket.destroyed) sendFrame(client.socket, Buffer.from(JSON.stringify(obj)), 0x1);
}

function sendFrame(socket, payload, opcode = 0x1) {
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(length, 6);
  }
  socket.write(Buffer.concat([header, payload]));
}

server.listen(PORT, () => {
  console.log(`Looproom running on http://localhost:${PORT}`);
});
