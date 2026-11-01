#!/usr/bin/env node
// FPV Sim multiplayer server. One file, no npm packages: Node.js 18 or newer is all it needs.
//
//   node flysim-server.mjs            asks for the port (Enter keeps the saved one), then runs
//   node flysim-server.mjs 25580      runs on that port
//   node flysim-server.mjs gui        also opens the admin page in your browser
//
// Players connect with the game (Multiplayer tab) to  your-ip:port  or a tunnel address
// (playit.gg etc., see Tunnel.md). It speaks WebSocket over plain TCP, so any TCP tunnel works.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const VERSION = '1.0.0';
const PROTOCOL = 1;
const DIR = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS_FILE = path.join(DIR, 'server.settings');
const EULA_FILE = path.join(DIR, 'eula.txt');
const BANS_FILE = path.join(DIR, 'banned.json');
const MAPS_FILE = path.join(DIR, 'maps.json');
const LOG_FILE = path.join(DIR, 'server.log');
const args = process.argv.slice(2);
const WANT_GUI = args.some((a) => a.toLowerCase() === 'gui');
const ARG_PORT = args.map(Number).find((n) => Number.isInteger(n) && n > 0 && n < 65536);

// ---------------------------------------------------------------- logging

const logListeners = new Set();
function log(text, kind = 'info') {
  const line = `[${new Date().toLocaleTimeString()}] ${text}`;
  if (rl) {
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
  }
  console.log(kind === 'warn' ? `\x1b[33m${line}\x1b[0m` : kind === 'error' ? `\x1b[31m${line}\x1b[0m` : line);
  if (rl) rl.prompt(true);
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch {
    // read-only folder: log to the console only
  }
  for (const fn of logListeners) fn(line, kind);
}

// ---------------------------------------------------------------- settings

/** Every setting with its default and what it does (written as comments into server.settings). */
const SETTINGS = [
  ['server-name', 'My FPV Sim server', 'Name shown in the server list and the lobby.'],
  ['motd', 'Welcome! Have fun and fly safe.', 'Message of the day, shown in the lobby.'],
  ['port', 25580, 'TCP port to listen on (also asked when the server starts).'],
  ['Owner-user-name', '', 'Your user name in the game. The owner gets the Start button and can manage the server from the game.'],
  ['max-drones', 16, 'Most players at once.'],
  ['drone-collision', true, 'true: drones bump into each other. false: they fly through each other.'],
  ['drone-show', true, 'true: players see each other. false: everyone flies alone on the same map.'],
  ['show-names', true, 'true: player names float above the drones.'],
  ['voting-time', 30, 'Seconds the map vote lasts (it ends early when everyone has voted).'],
  ['min-players', 1, 'Players needed before the owner can start.'],
  ['allow-teleport', true, 'true: players may use the map (M) to teleport.'],
  ['allow-recording', true, 'true: players may record the flight (V).'],
  ['maps', 'all', 'Maps in the vote: all, or ids separated by commas (bando,racetrack,house,town,mountains,mall,f1,oval,lake,hollywood,paris,stadium).'],
  ['password', '', 'Leave empty for an open server; otherwise players must type it to join.'],
  ['whitelist', false, 'true: only names listed in whitelist.txt (one per line) may join.'],
  ['state-rate', 20, 'Position updates per second sent to players (10-30).'],
];

let settings = {};

function parseValue(raw, def) {
  const v = raw.trim();
  if (typeof def === 'boolean') return /^(true|yes|on|1)$/i.test(v);
  if (typeof def === 'number') {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  }
  return v;
}

function writeSettings() {
  const lines = ['# FPV Sim server settings. Change a value, save, and type "reload" in the server window (or restart).', '# true / false switch things on and off; numbers are numbers.', ''];
  for (const [key, def, help] of SETTINGS) {
    lines.push(`# ${help}`);
    lines.push(`${key}=${settings[key] ?? def}`);
    lines.push('');
  }
  fs.writeFileSync(SETTINGS_FILE, lines.join('\n'));
}

function loadSettings() {
  const out = {};
  for (const [key, def] of SETTINGS) out[key] = def;
  if (fs.existsSync(SETTINGS_FILE)) {
    for (const line of fs.readFileSync(SETTINGS_FILE, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([^#=\s][^=]*?)\s*=(.*)$/);
      if (!m) continue;
      const def = SETTINGS.find(([k]) => k.toLowerCase() === m[1].toLowerCase());
      if (def) out[def[0]] = parseValue(m[2], def[1]);
    }
  }
  settings = out;
  writeSettings(); // adds any new keys with their help text
  return out;
}

/** Settings players need to know. */
function publicSettings() {
  return {
    name: settings['server-name'],
    motd: settings.motd,
    collision: settings['drone-collision'],
    show: settings['drone-show'],
    names: settings['show-names'],
    teleport: settings['allow-teleport'],
    recording: settings['allow-recording'],
    maxDrones: settings['max-drones'],
    rate: Math.max(5, Math.min(30, settings['state-rate'])),
  };
}

// ---------------------------------------------------------------- EULA

const EULA_TEXT = `# FPV Sim server end user licence agreement (EULA)
#
# By changing eula=false to eula=true below you agree that:
#  1. You run this server at your own risk. It is provided as is, without any warranty.
#  2. You are responsible for your server, who can join it, and what happens on it.
#  3. You will not use the server to harm, harass or cheat other players, and you will follow
#     the law and the rules of your internet provider and of any tunnel service you use.
#  4. Player names and IP addresses are seen by the server (for the player list, kicks and bans)
#     and kept in banned.json only when you ban someone. Tell your players.
#
# Change false to true, save this file, and start the server again.
eula=false
`;

function eulaAccepted() {
  if (!fs.existsSync(EULA_FILE)) fs.writeFileSync(EULA_FILE, EULA_TEXT);
  return /^\s*eula\s*=\s*true\s*$/im.test(fs.readFileSync(EULA_FILE, 'utf8'));
}

// ---------------------------------------------------------------- maps, bans, whitelist

function loadMaps() {
  try {
    return JSON.parse(fs.readFileSync(MAPS_FILE, 'utf8'));
  } catch {
    return [{ id: 'bando', name: 'The Bando' }];
  }
}
let MAPS = loadMaps();

function votingMaps() {
  const want = String(settings.maps || 'all').trim().toLowerCase();
  if (want === 'all' || !want) return MAPS;
  const ids = want.split(',').map((s) => s.trim());
  const list = MAPS.filter((m) => ids.includes(m.id));
  return list.length ? list : MAPS;
}

let bans = { names: {}, ips: {} };
function loadBans() {
  try {
    bans = JSON.parse(fs.readFileSync(BANS_FILE, 'utf8'));
    bans.names ??= {};
    bans.ips ??= {};
  } catch {
    bans = { names: {}, ips: {} };
  }
}
function saveBans() {
  fs.writeFileSync(BANS_FILE, JSON.stringify(bans, null, 2));
}

function whitelist() {
  try {
    return fs
      .readFileSync(path.join(DIR, 'whitelist.txt'), 'utf8')
      .split(/\r?\n/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- WebSocket (RFC 6455), minimal

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

class Socket {
  constructor(sock) {
    this.sock = sock;
    this.buf = Buffer.alloc(0);
    this.frag = [];
    this.open = true;
    this.onmessage = null;
    this.onclose = null;
    sock.setNoDelay(true);
    sock.on('data', (d) => this.data(d));
    sock.on('close', () => this.closed());
    sock.on('error', () => this.closed());
  }

  data(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        len = Number(this.buf.readBigUInt64BE(2));
        off = 10;
      }
      if (len > 1 << 20) return this.close(1009);
      const masked = b1 & 0x80;
      const need = off + (masked ? 4 : 0) + len;
      if (this.buf.length < need) return;
      let payload = this.buf.subarray(off + (masked ? 4 : 0), need);
      if (masked) {
        const mask = this.buf.subarray(off, off + 4);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      }
      this.buf = this.buf.subarray(need);
      const op = b0 & 0x0f;
      const fin = b0 & 0x80;
      if (op === 0x8) return this.close();
      if (op === 0x9) this.frame(0xa, payload);
      else if (op === 0x1 || op === 0x2 || op === 0x0) {
        this.frag.push(payload);
        if (fin) {
          const msg = Buffer.concat(this.frag).toString('utf8');
          this.frag = [];
          this.onmessage?.(msg);
        }
      }
    }
  }

  frame(op, payload) {
    if (!this.open) return;
    const len = payload.length;
    const head = len < 126 ? Buffer.from([0x80 | op, len]) : len < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
    if (len >= 126 && len < 65536) {
      head[0] = 0x80 | op;
      head[1] = 126;
      head.writeUInt16BE(len, 2);
    } else if (len >= 65536) {
      head[0] = 0x80 | op;
      head[1] = 127;
      head.writeBigUInt64BE(BigInt(len), 2);
    }
    this.sock.write(Buffer.concat([head, payload]));
  }

  send(obj) {
    this.frame(0x1, Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)));
  }

  close(code = 1000) {
    if (!this.open) return;
    const b = Buffer.alloc(2);
    b.writeUInt16BE(code);
    this.frame(0x8, b);
    this.open = false;
    setTimeout(() => this.sock.destroy(), 200);
    this.closed();
  }

  closed() {
    if (this.done) return;
    this.done = true;
    this.open = false;
    this.onclose?.();
  }
}

// ---------------------------------------------------------------- game state

/** @type {Map<number, any>} */
const players = new Map();
let nextId = 1;
let phase = 'lobby'; // lobby -> voting -> playing
let votes = new Map(); // player id -> map id
let voteEnds = 0;
let voteTimer = null;
let currentMap = null;
let stateTimer = null;

const isOwner = (p) => !!settings['Owner-user-name'] && p.name.toLowerCase() === String(settings['Owner-user-name']).toLowerCase();

function playerList() {
  return [...players.values()].map((p) => ({ id: p.id, name: p.name, drone: p.drone, owner: isOwner(p), ping: p.ping }));
}

function broadcast(obj, except = null) {
  const s = JSON.stringify(obj);
  for (const p of players.values()) if (p !== except && p.ws.open) p.ws.send(s);
}

function sendPlayers() {
  broadcast({ t: 'players', list: playerList() });
  emitAdmin();
}

function voteCounts() {
  const c = {};
  for (const m of votes.values()) c[m] = (c[m] ?? 0) + 1;
  return c;
}

function phaseMessage() {
  return {
    t: 'phase',
    phase,
    map: currentMap,
    maps: phase === 'voting' ? votingMaps().map((m) => m.id) : undefined,
    votes: phase === 'voting' ? voteCounts() : undefined,
    left: phase === 'voting' ? Math.max(0, voteEnds - Date.now()) : undefined,
  };
}

function startVote(by = 'console') {
  if (phase !== 'lobby') return 'A vote or a round is already running.';
  if (players.size < settings['min-players']) return `Need at least ${settings['min-players']} players.`;
  phase = 'voting';
  votes = new Map();
  voteEnds = Date.now() + settings['voting-time'] * 1000;
  clearTimeout(voteTimer);
  voteTimer = setTimeout(endVote, settings['voting-time'] * 1000);
  log(`Map vote started by ${by} (${settings['voting-time']} s).`);
  broadcast(phaseMessage());
  emitAdmin();
  return null;
}

function endVote() {
  if (phase !== 'voting') return;
  clearTimeout(voteTimer);
  const counts = voteCounts();
  const pool = votingMaps().map((m) => m.id);
  let best = [];
  let top = 0;
  for (const id of pool) {
    const n = counts[id] ?? 0;
    if (n > top) {
      top = n;
      best = [id];
    } else if (n === top && n > 0) best.push(id);
  }
  // Nobody voted: any map. A tie: one of the tied maps, at random.
  const choice = (best.length ? best : pool)[Math.floor(Math.random() * (best.length || pool.length))];
  startRound(choice, best.length > 1 ? `tie between ${best.join(', ')}` : top ? `${top} vote${top > 1 ? 's' : ''}` : 'no votes');
}

function startRound(mapId, why = 'set by console') {
  clearTimeout(voteTimer);
  phase = 'playing';
  currentMap = mapId;
  for (const p of players.values()) p.state = null;
  const name = MAPS.find((m) => m.id === mapId)?.name ?? mapId;
  log(`Round on ${name} (${why}).`);
  broadcast(phaseMessage());
  broadcast({ t: 'msg', text: `Map: ${name}`, kind: '' });
  emitAdmin();
}

function toLobby(why = 'console') {
  clearTimeout(voteTimer);
  phase = 'lobby';
  currentMap = null;
  votes = new Map();
  log(`Back to the lobby (${why}).`);
  broadcast(phaseMessage());
  emitAdmin();
}

/** Relays everyone's drone state at the configured rate. */
function tickStates() {
  if (phase !== 'playing') return;
  const states = [];
  for (const p of players.values()) if (p.state) states.push({ id: p.id, ...p.state });
  if (!states.length) return;
  broadcast({ t: 'states', s: states });
}

function restartStateTimer() {
  clearInterval(stateTimer);
  stateTimer = setInterval(tickStates, 1000 / publicSettings().rate);
}

function findPlayer(name) {
  if (!name) return null;
  const n = name.toLowerCase();
  const all = [...players.values()];
  return all.find((p) => p.name.toLowerCase() === n) ?? all.find((p) => p.name.toLowerCase().startsWith(n)) ?? null;
}

function kick(p, reason = 'Kicked by the server') {
  p.ws.send({ t: 'kicked', reason });
  p.ws.close(4000);
}

function teleport(p, target) {
  if (!target.state) return 'That player has not spawned yet.';
  const [x, y, z] = target.state.p;
  p.ws.send({ t: 'tp', p: [x + 1.5, y + 0.5, z + 1.5], name: target.name });
  return null;
}

// ---------------------------------------------------------------- connections

function handleMessage(p, raw) {
  let m;
  try {
    m = JSON.parse(raw);
  } catch {
    return;
  }
  switch (m.t) {
    case 'state':
      if (phase !== 'playing' || !Array.isArray(m.p) || !Array.isArray(m.q)) return;
      p.state = { p: m.p.slice(0, 3).map(Number), q: m.q.slice(0, 4).map(Number), w: Number(m.w) || 0, a: !!m.a, c: !!m.c, d: String(m.d || p.drone).slice(0, 24) };
      p.drone = p.state.d;
      break;
    case 'start':
      if (!isOwner(p)) return p.ws.send({ t: 'msg', text: 'Only the owner can start.', kind: 'warn' });
      if (phase === 'playing') return toLobby(`${p.name} ended the round`);
      {
        const err = startVote(p.name);
        if (err) p.ws.send({ t: 'msg', text: err, kind: 'warn' });
      }
      break;
    case 'vote':
      if (phase !== 'voting' || !votingMaps().some((x) => x.id === m.map)) return;
      votes.set(p.id, m.map);
      broadcast({ t: 'votes', votes: voteCounts(), left: Math.max(0, voteEnds - Date.now()) });
      emitAdmin();
      if (votes.size >= players.size) setTimeout(endVote, 1200);
      break;
    case 'drone':
      p.drone = String(m.d || '').slice(0, 24);
      sendPlayers();
      break;
    case 'chat': {
      const text = String(m.text || '').slice(0, 200).trim();
      if (!text) return;
      log(`<${p.name}> ${text}`);
      broadcast({ t: 'chat', from: p.name, text });
      break;
    }
    case 'admin':
      // The owner can run console commands from the game.
      if (!isOwner(p)) return;
      log(`${p.name} (owner): ${m.cmd}`);
      p.ws.send({ t: 'msg', text: runCommand(String(m.cmd || ''), p.name) || 'Done.', kind: '' });
      break;
    case 'ping':
      p.ws.send({ t: 'pong', id: m.id });
      if (typeof m.rtt === 'number') p.ping = Math.round(m.rtt);
      break;
  }
}

function join(ws, ip, m) {
  const name = String(m.name || '').trim().slice(0, 20);
  const refuse = (reason) => {
    ws.send({ t: 'refused', reason });
    ws.close(4001);
    log(`Refused ${name || '?'} (${ip}): ${reason}`, 'warn');
  };
  if (m.protocol !== PROTOCOL) return refuse(`Different game version (server ${VERSION}). Update the game or the server.`);
  if (!/^[\w .\-]{2,20}$/u.test(name)) return refuse('Invalid user name (2-20 letters, numbers, space, . _ -).');
  if (bans.names[name.toLowerCase()]) return refuse(`You are banned: ${bans.names[name.toLowerCase()].reason || 'no reason given'}`);
  if (bans.ips[ip]) return refuse(`You are banned: ${bans.ips[ip].reason || 'no reason given'}`);
  if (settings.password && m.password !== settings.password) return refuse(m.password ? 'Wrong password.' : 'This server needs a password.');
  if (settings.whitelist && !whitelist().includes(name.toLowerCase())) return refuse('You are not on the whitelist.');
  if (players.size >= settings['max-drones']) return refuse(`The server is full (${settings['max-drones']}).`);
  if ([...players.values()].some((p) => p.name.toLowerCase() === name.toLowerCase())) return refuse('Someone with that name is already playing.');

  const p = { id: nextId++, name, ip, ws, drone: String(m.drone || 'freestyle5').slice(0, 24), state: null, ping: 0, joined: Date.now() };
  players.set(p.id, p);
  ws.onmessage = (raw) => handleMessage(p, raw);
  ws.onclose = () => {
    if (!players.delete(p.id)) return;
    log(`${p.name} left.`);
    broadcast({ t: 'left', id: p.id, name: p.name });
    votes.delete(p.id);
    sendPlayers();
    if (!players.size && phase !== 'lobby') toLobby('everyone left');
  };
  ws.send({ t: 'welcome', id: p.id, version: VERSION, settings: publicSettings(), owner: isOwner(p), maps: votingMaps().map((x) => x.id) });
  ws.send(phaseMessage());
  log(`${name} joined from ${ip} (${players.size}/${settings['max-drones']})${isOwner(p) ? ' [owner]' : ''}.`);
  broadcast({ t: 'joined', id: p.id, name }, p);
  sendPlayers();
}

const isLocal = (ip) => /^(127\.|::1$|localhost$)/.test(ip);

function clientIp(req) {
  const remote = (req.socket.remoteAddress || '?').replace(/^::ffff:/, '');
  // Through a tunnel everyone arrives from 127.0.0.1; a proxy may pass the real address on.
  // Only trust that header from a local connection, so nobody can fake it from outside.
  if (!isLocal(remote)) return remote;
  const fwd = String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '').split(',')[0].trim();
  return fwd || remote;
}

const server = http.createServer((req, res) => {
  // A plain page so you can check in a browser that the server (or the tunnel) is reachable.
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.url?.startsWith('/status')) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ game: 'flysim', version: VERSION, protocol: PROTOCOL, ...publicSettings(), players: players.size, phase, map: currentMap, password: !!settings.password }));
    return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><meta charset="utf-8"><title>FPV Sim server</title><body style="font-family:sans-serif;background:#0b0f14;color:#eee;padding:40px">
    <h1>FPV Sim server is running</h1><p>${escapeHtml(settings['server-name'])} &middot; ${players.size}/${settings['max-drones']} players &middot; ${phase}</p>
    <p>Add this address in the game: <b>Multiplayer &rarr; Add server</b>.</p></body>`);
});

server.on('upgrade', (req, sock) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade).toLowerCase() !== 'websocket') return sock.destroy();
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const ws = new Socket(sock);
  const ip = clientIp(req);
  // The first message must be "hello" within 10 s.
  const t = setTimeout(() => ws.close(4002), 10000);
  ws.onmessage = (raw) => {
    clearTimeout(t);
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return ws.close(4003);
    }
    if (m.t !== 'hello') return ws.close(4003);
    join(ws, ip, m);
  };
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// ---------------------------------------------------------------- console commands

const HELP = [
  ['help', 'this list'],
  ['list', 'who is on the server'],
  ['kick <name> [reason]', 'remove a player (they can come back)'],
  ['ban <name> [reason]', 'remove a player and keep them out (name and IP)'],
  ['unban <name|ip>', 'let a banned player back in'],
  ['banlist', 'show banned names and IPs'],
  ['tp <name> <target>', 'teleport a player to another player'],
  ['tpall <target>', 'teleport everyone to a player'],
  ['say <text>', 'message to every player'],
  ['vote', 'start the map vote now'],
  ['map <id>', 'skip the vote and start a round on this map'],
  ['maps', 'list the map ids'],
  ['lobby', 'end the round, everyone back to the lobby'],
  ['owner <name>', 'make this user name the owner (saved in server.settings)'],
  ['set <key> <value>', 'change a setting and save it (e.g. set drone-collision false)'],
  ['settings', 'show the settings'],
  ['reload', 'read server.settings again'],
  ['stop', 'shut the server down'],
];

function runCommand(line, by = 'console') {
  const [cmd, ...rest] = line.trim().split(/\s+/);
  const arg = rest.join(' ');
  switch ((cmd || '').toLowerCase()) {
    case '':
      return '';
    case 'help':
    case '?':
      return HELP.map(([c, d]) => `  ${c.padEnd(22)} ${d}`).join('\n');
    case 'list': {
      if (!players.size) return 'Nobody is on the server.';
      return [...players.values()].map((p) => `  ${p.name}${isOwner(p) ? ' (owner)' : ''}  ${p.ip}  ${p.drone}  ${p.ping} ms`).join('\n');
    }
    case 'kick': {
      const p = findPlayer(rest[0]);
      if (!p) return `No player called "${rest[0] ?? ''}".`;
      const reason = rest.slice(1).join(' ') || 'Kicked by the server';
      kick(p, reason);
      log(`${p.name} was kicked by ${by}: ${reason}`);
      return `Kicked ${p.name}.`;
    }
    case 'ban': {
      const name = rest[0];
      if (!name) return 'Usage: ban <name> [reason]';
      const p = findPlayer(name);
      const reason = rest.slice(1).join(' ') || 'Banned';
      const real = p ? p.name : name;
      bans.names[real.toLowerCase()] = { name: real, reason, by, date: new Date().toISOString() };
      if (p) {
        // Tunnel players all share 127.0.0.1: ban those by name only.
        if (!isLocal(p.ip)) bans.ips[p.ip] = { name: real, reason, by, date: new Date().toISOString() };
        kick(p, `Banned: ${reason}`);
      }
      saveBans();
      log(`${real} was banned by ${by}: ${reason}`);
      return `Banned ${real}${p && !isLocal(p.ip) ? ` (and IP ${p.ip})` : ''}.`;
    }
    case 'unban':
    case 'pardon': {
      const key = (rest[0] ?? '').toLowerCase();
      let found = false;
      if (bans.names[key]) {
        delete bans.names[key];
        found = true;
      }
      for (const [ip, b] of Object.entries(bans.ips)) {
        if (ip === rest[0] || b.name.toLowerCase() === key) {
          delete bans.ips[ip];
          found = true;
        }
      }
      saveBans();
      return found ? `Unbanned ${rest[0]}.` : `"${rest[0] ?? ''}" is not banned.`;
    }
    case 'banlist': {
      const n = Object.values(bans.names).map((b) => `  ${b.name}: ${b.reason}`);
      const i = Object.entries(bans.ips).map(([ip, b]) => `  ${ip} (${b.name}): ${b.reason}`);
      return n.length || i.length ? `Names:\n${n.join('\n') || '  -'}\nIPs:\n${i.join('\n') || '  -'}` : 'Nobody is banned.';
    }
    case 'tp': {
      const p = findPlayer(rest[0]);
      const target = findPlayer(rest[1]);
      if (!p || !target) return 'Usage: tp <name> <target>';
      if (phase !== 'playing') return 'Teleport works during a round.';
      return teleport(p, target) ?? `Teleported ${p.name} to ${target.name}.`;
    }
    case 'tpall': {
      const target = findPlayer(rest[0]);
      if (!target) return 'Usage: tpall <target>';
      if (phase !== 'playing') return 'Teleport works during a round.';
      for (const p of players.values()) if (p !== target) teleport(p, target);
      return `Teleported everyone to ${target.name}.`;
    }
    case 'say':
      if (!arg) return 'Usage: say <text>';
      broadcast({ t: 'chat', from: '[Server]', text: arg });
      log(`[Server] ${arg}`);
      return '';
    case 'vote':
    case 'start':
      return startVote(by) ?? 'Vote started.';
    case 'map': {
      const m = MAPS.find((x) => x.id === rest[0]?.toLowerCase());
      if (!m) return `Unknown map. Maps: ${MAPS.map((x) => x.id).join(', ')}`;
      startRound(m.id, `set by ${by}`);
      return `Round on ${m.name}.`;
    }
    case 'maps':
      return MAPS.map((m) => `  ${m.id.padEnd(10)} ${m.name}${votingMaps().includes(m) ? '' : ' (not in the vote)'}`).join('\n');
    case 'lobby':
    case 'end':
      toLobby(by);
      return 'Back to the lobby.';
    case 'owner': {
      if (!arg) return `Owner: ${settings['Owner-user-name'] || '(nobody)'}`;
      settings['Owner-user-name'] = arg;
      writeSettings();
      for (const p of players.values()) p.ws.send({ t: 'owner', owner: isOwner(p) });
      sendPlayers();
      return `Owner is now ${arg}.`;
    }
    case 'set': {
      const key = SETTINGS.find(([k]) => k.toLowerCase() === (rest[0] ?? '').toLowerCase());
      if (!key || rest.length < 2) return 'Usage: set <key> <value>   (type "settings" to see the keys)';
      settings[key[0]] = parseValue(rest.slice(1).join(' '), key[1]);
      writeSettings();
      applySettings();
      return `${key[0]} = ${settings[key[0]]}`;
    }
    case 'settings':
      return SETTINGS.map(([k]) => `  ${k} = ${k === 'password' && settings[k] ? '*****' : settings[k]}`).join('\n');
    case 'reload':
      loadSettings();
      loadBans();
      MAPS = loadMaps();
      applySettings();
      return 'Settings reloaded.';
    case 'stop':
    case 'quit':
    case 'exit':
      shutdown();
      return 'Stopping…';
    default:
      return `Unknown command "${cmd}". Type help.`;
  }
}

/** Tells everyone about changed settings and owner status. */
function applySettings() {
  restartStateTimer();
  const ps = publicSettings();
  for (const p of players.values()) p.ws.send({ t: 'settings', settings: ps, owner: isOwner(p) });
  sendPlayers();
}

function shutdown() {
  log('Server stopping.');
  for (const p of players.values()) {
    p.ws.send({ t: 'kicked', reason: 'The server is shutting down.' });
    p.ws.close(1001);
  }
  setTimeout(() => process.exit(0), 400);
}

// ---------------------------------------------------------------- admin page (only with "gui")

const adminClients = new Set();
let adminToken = '';

function adminState() {
  return {
    name: settings['server-name'],
    phase,
    map: currentMap,
    votes: voteCounts(),
    left: phase === 'voting' ? Math.max(0, voteEnds - Date.now()) : 0,
    players: [...players.values()].map((p) => ({ name: p.name, ip: p.ip, drone: p.drone, ping: p.ping, owner: isOwner(p), since: p.joined })),
    settings: SETTINGS.map(([k, def, help]) => ({ key: k, value: settings[k], type: typeof def, help })),
    bans: Object.values(bans.names),
    maps: MAPS,
    port: settings.port,
  };
}

function emitAdmin() {
  if (!adminClients.size) return;
  const data = `event: state\ndata: ${JSON.stringify(adminState())}\n\n`;
  for (const res of adminClients) res.write(data);
}

function startAdmin(port) {
  adminToken = crypto.randomBytes(12).toString('hex');
  const page = fs.existsSync(path.join(DIR, 'admin.html')) ? fs.readFileSync(path.join(DIR, 'admin.html'), 'utf8') : '<p>admin.html is missing: run the installer again.</p>';
  const admin = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.searchParams.get('k') !== adminToken) {
      res.statusCode = 403;
      return res.end('Forbidden');
    }
    if (url.pathname === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`event: state\ndata: ${JSON.stringify(adminState())}\n\n`);
      adminClients.add(res);
      const onLog = (line, kind) => res.write(`event: log\ndata: ${JSON.stringify({ line, kind })}\n\n`);
      logListeners.add(onLog);
      req.on('close', () => {
        adminClients.delete(res);
        logListeners.delete(onLog);
      });
      return;
    }
    if (url.pathname === '/cmd' && req.method === 'POST') {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        const out = runCommand(body.slice(0, 500), 'admin page');
        if (out) log(out);
        res.end(JSON.stringify({ out }));
        emitAdmin();
      });
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(page);
  });
  // Only this computer: never reachable through the tunnel.
  admin.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}/?k=${adminToken}`;
    log(`Admin page: ${url}`);
    const open = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
    exec(open, (err) => err && log('Could not open a browser here; open the address above yourself.', 'warn'));
  });
  admin.on('error', (e) => log(`Admin page failed: ${e.message}`, 'error'));
  setInterval(emitAdmin, 1000);
}

// ---------------------------------------------------------------- start

let rl = null;

function ask(q) {
  return new Promise((resolve) => {
    const r = readline.createInterface({ input: process.stdin, output: process.stdout });
    r.question(q, (a) => {
      r.close();
      resolve(a);
    });
  });
}

async function main() {
  console.log(`\nFPV Sim server ${VERSION}\n`);
  loadSettings();
  loadBans();
  if (!eulaAccepted()) {
    console.log('You need to agree to the EULA before the server can start.');
    console.log(`Open ${EULA_FILE}, read it, change  eula=false  to  eula=true , save, and start again.\n`);
    process.exit(1);
  }
  let port = ARG_PORT ?? settings.port;
  if (!ARG_PORT && process.stdin.isTTY) {
    const a = (await ask(`Port to run on [${settings.port}] (Enter keeps it): `)).trim();
    if (a) {
      const n = Number(a);
      if (Number.isInteger(n) && n > 0 && n < 65536) port = n;
      else console.log(`"${a}" is not a port; using ${settings.port}.`);
    }
  }
  if (port !== settings.port) {
    settings.port = port;
    writeSettings();
  }
  if (!settings['Owner-user-name']) log('Tip: put your game user name in server.settings (Owner-user-name=) or type "owner <name>" to get the Start button.', 'warn');

  server.on('error', (e) => {
    log(e.code === 'EADDRINUSE' ? `Port ${port} is already in use. Pick another port.` : `Server error: ${e.message}`, 'error');
    process.exit(1);
  });
  server.listen(port, '0.0.0.0', () => {
    log(`Listening on port ${port}. Players add  <your address>:${port}  in Multiplayer.`);
    log(`On this computer:  localhost:${port}   ·   test in a browser: http://localhost:${port}`);
    log('Type "help" for commands.');
  });
  restartStateTimer();
  if (WANT_GUI) startAdmin(port + 1);

  if (process.stdin.isTTY) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
    rl.on('line', (line) => {
      const out = runCommand(line);
      if (out) console.log(out);
      rl.prompt();
    });
    rl.on('close', shutdown);
    rl.prompt();
  } else {
    // No terminal (service / docker): still read commands from stdin if there are any.
    process.stdin.on('data', (d) => {
      for (const line of d.toString().split(/\r?\n/)) {
        const out = runCommand(line);
        if (out) console.log(out);
      }
    });
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  // Ping everyone so dead connections drop out.
  setInterval(() => {
    for (const p of players.values()) if (p.ws.open) p.ws.frame(0x9, Buffer.alloc(0));
  }, 15000);
}

main();
