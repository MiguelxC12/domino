const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 10000;
const ADMIN_PASSWORD = '07020263524';

const rooms = new Map();
const stats = new Map();
const MAX_DISCONNECT_MS = 30 * 60 * 1000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const randId = () => crypto.randomBytes(8).toString('hex');
function newCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do c = Array.from({length: 5}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  while (rooms.has(c));
  return c;
}
function shuffle(a) {
  a = [...a];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function makeDeck(max) {
  const d = [];
  for (let a = 0; a <= max; a++) for (let b = a; b <= max; b++) d.push({ id: `${a}-${b}`, a, b });
  return d;
}
function teamOf(room, p) {
  if (room.mode === 'individual') return p.seat;
  return p.team ?? (p.seat % 2);
}
function teamLabel(room, team) {
  if (room.mode === 'individual') return room.players.find(p => p.seat === team)?.name || `Jugador ${team + 1}`;
  return team === 0 ? 'A' : 'B';
}
function getPlayer(room, id) { return room.players.find(p => p.id === id); }
function addStat(id, name) {
  const s = stats.get(id) || { player_id: id, display_name: name, games: 0, wins: 0, losses: 0, points: 0 };
  s.display_name = name;
  stats.set(id, s);
}
function handPoints(h) { return (h || []).reduce((s, t) => s + t.a + t.b, 0); }
function activeTeams(room) {
  return room.mode === 'individual' ? room.players.map(p => p.seat) : [0, 1];
}
function publicState(room, viewerId, admin = false) {
  const me = getPlayer(room, viewerId);
  const hands = {};
  for (const p of room.players) {
    const h = room.hands.get(p.id) || [];
    hands[p.id] = p.id === viewerId || admin ? h : { count: h.length };
  }
  return {
    code: room.code,
    hostId: room.hostId,
    variant: room.variant,
    mode: room.mode,
    target: 100,
    phase: room.phase,
    players: room.players.map(p => ({ id: p.id, name: p.name, seat: p.seat, team: teamOf(room, p), connected: p.connected, host: p.id === room.hostId })),
    scores: room.scores,
    handNumber: room.handNumber,
    board: room.board,
    turn: room.turn,
    turnName: getPlayer(room, room.turn)?.name || null,
    startingTeam: room.startingTeam,
    startingPlayer: room.startingPlayer,
    starterChoice: room.starterChoice,
    isStarterChoice: room.phase === 'starter-choice' && me && teamOf(room, me) === room.startingTeam,
    hands,
    lastResult: room.lastResult,
    admin
  };
}
function emitRoom(room) {
  for (const p of room.players) {
    if (p.socketId) io.to(p.socketId).emit('state', publicState(room, p.id));
  }
}
function makeRoom(host) {
  const room = {
    code: newCode(), hostId: host.id, variant: 9, mode: 'team',
    players: [], phase: 'lobby', hands: new Map(), board: [], turn: null,
    startingTeam: null, startingPlayer: null, starterChoice: null,
    scores: [], handNumber: 0, lastResult: null, disconnected: new Map(), previousWinner: null
  };
  rooms.set(room.code, room);
  return room;
}
function resetScores(room) {
  const count = room.mode === 'team' ? 2 : room.players.length;
  room.scores = Array(count).fill(0);
}
function startHand(room) {
  if (room.players.length < 2) return;
  if (room.mode === 'team' && room.players.length > 4) return;
  room.handNumber++;
  room.phase = 'starter-choice';
  room.board = [];
  room.turn = null;
  room.starterChoice = null;
  room.lastResult = null;
  if (room.mode === 'team') {
    // Only the first hand is random. From then on, the winning team starts.
    room.startingTeam = room.handNumber === 1 ? (Math.random() < 0.5 ? 0 : 1) : room.previousWinner;
  } else {
    room.startingTeam = room.handNumber === 1 ? Math.floor(Math.random() * room.players.length) : room.previousWinner;
  }
  const deck = shuffle(makeDeck(room.variant));
  const count = room.variant === 6 ? 7 : 10;
  room.hands.clear();
  for (const p of room.players) room.hands.set(p.id, deck.splice(0, count));
  emitRoom(room);
}
function legal(t, value) { return t.a === value || t.b === value; }
function canPlay(h, board) {
  if (!board.length) return true;
  const l = board[0].left, r = board[board.length - 1].right;
  return h.some(t => legal(t, l) || legal(t, r));
}
function orientLeft(t, v) {
  if (t.b === v) return { a: t.a, b: t.b };
  if (t.a === v) return { a: t.b, b: t.a };
  return null;
}
function orientRight(t, v) {
  if (t.a === v) return { a: t.a, b: t.b };
  if (t.b === v) return { a: t.b, b: t.a };
  return null;
}
function winnerForBlocked(room) {
  const entries = room.players.map(p => ({ p, points: handPoints(room.hands.get(p.id)), team: teamOf(room, p) }));
  const min = Math.min(...entries.map(x => x.points));
  const winners = entries.filter(x => x.points === min);
  const teams = [...new Set(winners.map(x => x.team))];
  if (room.mode === 'team') {
    // Cuban rule requested: individual lowest hand determines the winning team.
    if (teams.length !== 1) return { winner: null, detail: winners.map(x => `${x.p.name} (${x.points})`).join(', ') };
    return { winner: teams[0], detail: `${winners[0].p.name} (${winners[0].points} puntos)` };
  }
  if (winners.length !== 1) return { winner: null, detail: winners.map(x => `${x.p.name} (${x.points})`).join(', ') };
  return { winner: winners[0].team, detail: `${winners[0].p.name} (${winners[0].points} puntos)` };
}
function finishHand(room, winner, reason, detail) {
  let awarded = 0;
  if (winner !== null) {
    const loserPlayers = room.players.filter(p => teamOf(room, p) !== winner);
    awarded = loserPlayers.reduce((sum, p) => sum + handPoints(room.hands.get(p.id)), 0);
    room.scores[winner] += awarded;
    room.previousWinner = winner;
  }
  room.lastResult = { reason, detail, winningTeam: winner, awarded, scores: [...room.scores] };
  const matchWinner = room.scores.findIndex(x => x >= 100);
  if (matchWinner >= 0) {
    room.phase = 'finished';
    for (const p of room.players) {
      const s = stats.get(p.id) || { player_id: p.id, display_name: p.name, games: 0, wins: 0, losses: 0, points: 0 };
      const won = teamOf(room, p) === matchWinner;
      s.games++; s.wins += won ? 1 : 0; s.losses += won ? 0 : 1; s.points += room.scores[matchWinner]; s.display_name = p.name;
      stats.set(p.id, s);
    }
  } else room.phase = 'hand-result';
  emitRoom(room);
}
function advanceTurn(room) {
  const cur = getPlayer(room, room.turn);
  const start = cur ? cur.seat : -1;
  for (let n = 1; n <= room.players.length; n++) {
    const p = room.players.find(x => x.seat === (start + n + room.players.length) % room.players.length);
    if (!p) continue;
    room.turn = p.id;
    if (canPlay(room.hands.get(p.id) || [], room.board)) { emitRoom(room); return; }
  }
  const result = winnerForBlocked(room);
  if (result.winner === null) finishHand(room, null, 'empate-tranca', result.detail);
  else finishHand(room, result.winner, 'trancada', result.detail);
}
function placeTile(room, p, tileId, side) {
  const h = room.hands.get(p.id) || [];
  const idx = h.findIndex(t => t.id === tileId);
  if (idx < 0) throw new Error('Esa ficha no está en tu mano.');
  const t = h[idx];
  if (!room.board.length) {
    h.splice(idx, 1);
    room.board.push({ id: t.id, left: t.a, right: t.b, playerId: p.id });
  } else {
    const l = room.board[0].left, r = room.board[room.board.length - 1].right;
    const oriented = side === 'left' ? orientLeft(t, l) : orientRight(t, r);
    if (!oriented) throw new Error('Esa ficha no puede ir en ese extremo.');
    h.splice(idx, 1);
    const piece = { id: t.id, left: oriented.a, right: oriented.b, playerId: p.id };
    side === 'left' ? room.board.unshift(piece) : room.board.push(piece);
  }
  if (h.length === 0) { finishHand(room, teamOf(room, p), 'pegada', p.name); return; }
  advanceTurn(room);
}
function saveName(room, id, name) {
  const p = getPlayer(room, id); if (!p) return false;
  p.name = String(name || '').trim().slice(0, 18) || p.name; addStat(p.id, p.name); return true;
}
function adminRooms() {
  return [...rooms.values()].map(r => ({
    code: r.code, phase: r.phase, variant: r.variant, mode: r.mode, hostId: r.hostId,
    handNumber: r.handNumber, scores: r.scores, players: r.players.map(p => ({ id: p.id, name: p.name, seat: p.seat, team: teamOf(r,p), connected: p.connected }))
  }));
}
function adminBroadcast() { io.emit('admin-rooms', adminRooms()); }

app.get('/api/health', (_, res) => res.json({ ok: true, rooms: rooms.size }));
app.post('/api/admin/login', (req, res) => {
  res.json({ ok: req.body?.password === ADMIN_PASSWORD });
});
app.get('/api/admin/rooms', (req, res) => {
  if (req.headers['x-admin-password'] !== ADMIN_PASSWORD) return res.status(401).json({ error: 'No autorizado' });
  res.json(adminRooms());
});
app.get('/api/stats/:id', (req, res) => res.json(stats.get(req.params.id) || { games: 0, wins: 0, losses: 0, points: 0 }));

io.on('connection', socket => {
  socket.on('create-room', ({ name, playerId }) => {
    name = String(name || '').trim().slice(0, 18);
    if (!name) return socket.emit('game-error', 'Escribe tu nombre.');
    const id = playerId || randId();
    const room = makeRoom({ id });
    room.players.push({ id, name, seat: 0, team: 0, socketId: socket.id, connected: true });
    resetScores(room); addStat(id, name);
    socket.data = { room: room.code, playerId: id };
    socket.join(room.code); socket.emit('joined', { room: room.code, playerId: id }); emitRoom(room); adminBroadcast();
  });

  socket.on('join-room', ({ code, name, playerId }) => {
    code = String(code || '').trim().toUpperCase(); name = String(name || '').trim().slice(0,18);
    const room = rooms.get(code);
    if (!room) return socket.emit('game-error', 'No existe esa sala.');
    if (!name) return socket.emit('game-error', 'Escribe tu nombre.');
    let p = playerId && getPlayer(room, playerId);
    if (p) {
      p.socketId = socket.id; p.connected = true; p.name = name; room.disconnected.delete(p.id);
    } else {
      if (room.players.length >= 4) return socket.emit('game-error', 'La sala está llena.');
      const used = new Set(room.players.map(x => x.seat));
      const seat = [0,1,2,3].find(x => !used.has(x));
      const id = playerId || randId();
      p = { id, name, seat, team: seat % 2, socketId: socket.id, connected: true };
      room.players.push(p); addStat(id, name);
      if (room.scores.length !== (room.mode === 'team' ? 2 : room.players.length)) resetScores(room);
    }
    socket.data = { room: code, playerId: p.id }; socket.join(code); socket.emit('joined', { room: code, playerId: p.id }); emitRoom(room); adminBroadcast();
  });

  socket.on('configure', ({ variant, mode }) => {
    const room = rooms.get(socket.data.room), p = room && getPlayer(room, socket.data.playerId);
    if (!room || !p || room.hostId !== p.id || room.phase !== 'lobby') return;
    if ([6,9].includes(+variant)) room.variant = +variant;
    if (['team','individual'].includes(mode)) room.mode = mode;
    resetScores(room); emitRoom(room); adminBroadcast();
  });

  socket.on('start-game', () => {
    const room = rooms.get(socket.data.room), p = room && getPlayer(room, socket.data.playerId);
    if (!room || !p || room.hostId !== p.id) return socket.emit('game-error', 'Solo el anfitrión puede comenzar.');
    if (room.players.length < 2) return socket.emit('game-error', 'Se necesitan al menos 2 jugadores.');
    resetScores(room); room.handNumber = 0; room.previousWinner = null; startHand(room); adminBroadcast();
  });

  socket.on('choose-starter', ({ tileId }) => {
    const room = rooms.get(socket.data.room), p = room && getPlayer(room, socket.data.playerId);
    if (!room || !p || room.phase !== 'starter-choice') return;
    if (teamOf(room, p) !== room.startingTeam) return socket.emit('game-error', 'Tu jugador no pertenece al grupo que sale.');
    if (room.starterChoice) return;
    const t = (room.hands.get(p.id) || []).find(x => x.id === tileId); if (!t) return socket.emit('game-error','Esa ficha no está en tu mano.');
    room.starterChoice = { playerId: p.id, tileId: t.id };
    room.startingPlayer = p.id; room.phase = 'playing'; room.turn = p.id;
    placeTile(room, p, t.id, 'right');
  });

  socket.on('play-tile', ({ tileId, side }) => {
    const room = rooms.get(socket.data.room), p = room && getPlayer(room, socket.data.playerId);
    if (!room || !p || room.phase !== 'playing') return socket.emit('game-error','No se puede jugar ahora.');
    if (room.turn !== p.id) return socket.emit('game-error','No es tu turno.');
    if (!['left','right'].includes(side)) return socket.emit('game-error','Elige un extremo.');
    try { placeTile(room, p, tileId, side); } catch (e) { socket.emit('game-error', e.message); }
  });

  socket.on('next-hand', () => {
    const room = rooms.get(socket.data.room), p = room && getPlayer(room, socket.data.playerId);
    if (!room || !p || room.hostId !== p.id || room.phase !== 'hand-result') return;
    startHand(room); adminBroadcast();
  });
  socket.on('new-match', () => {
    const room = rooms.get(socket.data.room), p = room && getPlayer(room, socket.data.playerId);
    if (!room || !p || room.hostId !== p.id || room.phase !== 'finished') return;
    resetScores(room); room.handNumber = 0; room.previousWinner = null; room.phase = 'lobby'; room.board = []; room.turn = null; room.lastResult = null; emitRoom(room); adminBroadcast();
  });
  socket.on('admin-auth', ({ password }) => { socket.data.admin = password === ADMIN_PASSWORD; socket.emit('admin-auth-result', { ok: socket.data.admin }); if(socket.data.admin) socket.emit('admin-rooms', adminRooms()); });
  socket.on('admin-refresh', () => { if (socket.data.admin) socket.emit('admin-rooms', adminRooms()); });
  socket.on('admin-change', ({ code, action, value }) => {
    if (!socket.data.admin) return;
    const room = rooms.get(code); if (!room) return;
    if (action === 'mode' && ['team','individual'].includes(value) && room.phase === 'lobby') { room.mode = value; resetScores(room); }
    if (action === 'variant' && [6,9].includes(+value) && room.phase === 'lobby') { room.variant = +value; resetScores(room); }
    if (action === 'rename') saveName(room, value.id, value.name);
    if (action === 'host') { if (getPlayer(room,value.id)) room.hostId=value.id; }
    if (action === 'team' && room.mode === 'team') { const p=getPlayer(room,value.id); if(p && [0,1].includes(+value.team)) p.team=+value.team; }
    if (action === 'start') {
      if (room.players.length >= 2 && (room.mode === 'individual' || room.players.length === 4)) { resetScores(room); room.handNumber=0; room.previousWinner=null; startHand(room); }
    }
    emitRoom(room); adminBroadcast();
  });
  socket.on('leave-room', () => disconnect(socket, true));
  socket.on('disconnect', () => disconnect(socket, false));
});
function disconnect(socket, immediate) {
  const room = rooms.get(socket.data?.room), id = socket.data?.playerId; if (!room || !id) return;
  const p = getPlayer(room,id); if (!p || p.socketId !== socket.id) return;
  p.connected = false;
  if (immediate) room.disconnected.set(id, Date.now() - MAX_DISCONNECT_MS); else room.disconnected.set(id, Date.now());
  emitRoom(room); adminBroadcast();
  if (!immediate) {
    setTimeout(() => {
      const t = room.disconnected.get(id);
      if (t && Date.now() - t >= MAX_DISCONNECT_MS) { room.disconnected.delete(id); if (room.phase === 'lobby') room.players = room.players.filter(x=>x.id!==id); emitRoom(room); adminBroadcast(); }
    }, MAX_DISCONNECT_MS + 1000);
  }
}

server.listen(PORT, '0.0.0.0', () => console.log(`Dominó Cubano v2 listening on ${PORT}`));
