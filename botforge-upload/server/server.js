// BotForge website server: public site, order intake, customer order pages and the admin dashboard.
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, STATUSES, STATUS_IDS, statusLabel } from './db.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
loadEnv();

const PORT = Number(process.env.PORT) || 3000;
const SITE_URL = (process.env.SITE_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const db = openDb(process.env.DATA_DIR || path.join(ROOT, 'data'));
// The main page lives at the repo root (served by GitHub Pages); the server serves the same file.
const INDEX = [path.join(ROOT, 'public', 'index.html'), path.join(ROOT, '..', 'index.html')].find(f => fs.existsSync(f));
// Sites allowed to send orders to this server from another address (e.g. the GitHub Pages site).
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://www.botforgeservices.dev,https://botforgeservices.dev,https://nebutherium.github.io')
  .split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean);

const PLATFORMS = ['Discord', 'Minecraft', 'Telegram', 'Twitch', 'Slack', 'Website', 'Reddit', 'Something else'];
const PACKAGES = ['Not sure yet', 'Starter ($10)', 'Standard ($25)', 'Advanced ($50)', 'Enterprise ($100+)'];
const HOSTING = ['Not sure yet', 'BotForge hosting ($7/mo)', "I'll host it myself"];

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false);
app.use(express.json({ limit: '32kb' }));
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  next();
});
// CORS for the public order form only.
app.use('/api/orders', (req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

/* ---------- Helpers ---------- */
const now = () => new Date().toISOString();
const clean = (v, max) => String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
const safeEqual = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};

// Tiny in-memory rate limiter: `max` hits per `windowMs` per IP and bucket.
const hits = new Map();
function limit(bucket, max, windowMs) {
  return (req, res, next) => {
    const key = bucket + ':' + req.ip, t = Date.now();
    const list = (hits.get(key) || []).filter(x => t - x < windowMs);
    if (list.length >= max) return res.status(429).json({ error: 'Too many requests. Wait a few minutes and try again.' });
    list.push(t); hits.set(key, list); next();
  };
}
setInterval(() => { const t = Date.now(); for (const [k, v] of hits) if (v.every(x => t - x > 3600e3)) hits.delete(k); }, 600e3).unref();

const addEvent = db.prepare('INSERT INTO events (order_id, at, kind, text, public) VALUES (?, ?, ?, ?, ?)');
const getById = db.prepare('SELECT * FROM orders WHERE id = ?');
const getByCode = db.prepare('SELECT * FROM orders WHERE code = ?');

function publicOrder(o) {
  const events = db.prepare('SELECT at, kind, text FROM events WHERE order_id = ? AND public = 1 ORDER BY id').all(o.id);
  return {
    code: o.code, status: o.status, statusLabel: statusLabel(o.status),
    botName: o.bot_name, platforms: o.platforms, features: o.features, purpose: o.purpose,
    commands: o.commands, server: o.server, budget: o.budget, package: o.package, hosting: o.hosting,
    quotePrice: o.quote_price, quoteDue: o.quote_due,
    createdAt: o.created_at, updatedAt: o.updated_at, timeline: events,
    statuses: STATUSES
  };
}

/* ---------- Public: place an order ---------- */
app.post('/api/orders', limit('order', 5, 10 * 60e3), (req, res) => {
  const b = req.body || {};
  if (b.website) return res.json({ ok: true }); // honeypot field, filled only by bots

  const order = {
    bot_name: clean(b.botName, 80),
    purpose: clean(b.purpose, 4000),
    platforms: (Array.isArray(b.platforms) ? b.platforms : []).filter(p => PLATFORMS.includes(p)).join(', '),
    features: (Array.isArray(b.features) ? b.features : []).map(f => clean(f, 60)).filter(Boolean).slice(0, 40).join(', '),
    commands: clean(b.commands, 500),
    server: clean(b.server, 200),
    budget: clean(b.budget, 60),
    package: PACKAGES.includes(b.package) ? b.package : 'Not sure yet',
    hosting: HOSTING.includes(b.hosting) ? b.hosting : 'Not sure yet',
    email: clean(b.email, 200)
  };
  const errors = {};
  if (!order.bot_name) errors.botName = 'Give your bot a name.';
  if (!order.purpose) errors.purpose = 'Tell us what the bot should do.';
  if (!order.email) errors.email = 'Add your email so we can reach you about your order.';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(order.email)) errors.email = 'That email address doesn’t look right.';
  if (Object.keys(errors).length) return res.status(400).json({ error: 'Some fields need fixing.', fields: errors });

  const t = now(), token = crypto.randomBytes(18).toString('base64url');
  const info = db.prepare(`INSERT INTO orders (token, bot_name, platforms, features, purpose, commands, server, budget, package, hosting, discord, email, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(token, order.bot_name, order.platforms, order.features, order.purpose, order.commands,
    order.server, order.budget, order.package, order.hosting, '', order.email, t, t);
  const id = Number(info.lastInsertRowid), code = 'BF-' + (1000 + id);
  db.prepare('UPDATE orders SET code = ? WHERE id = ?').run(code, id);
  addEvent.run(id, t, 'status', 'Order received', 1);

  res.status(201).json({ code, trackUrl: `/track/${code}?t=${token}` });
});

/* ---------- Public: order page ---------- */
function findForCustomer(req, res) {
  const o = getByCode.get(String(req.params.code || ''));
  const t = String(req.query.t || req.body?.t || '');
  if (!o || !t || !safeEqual(t, o.token)) { res.status(404).json({ error: 'We couldn’t find that order. Check the link you were given.' }); return null; }
  return o;
}
app.get('/api/track/:code', limit('track', 120, 10 * 60e3), (req, res) => {
  const o = findForCustomer(req, res); if (!o) return;
  res.json(publicOrder(o));
});
app.post('/api/track/:code/approve', limit('track', 120, 10 * 60e3), (req, res) => {
  const o = findForCustomer(req, res); if (!o) return;
  if (o.status !== 'quoted') return res.status(409).json({ error: 'There’s no quote waiting for approval on this order.' });
  const t = now();
  db.prepare("UPDATE orders SET status = 'approved', updated_at = ? WHERE id = ?").run(t, o.id);
  addEvent.run(o.id, t, 'status', `Quote approved${o.quote_price ? ` (${o.quote_price})` : ''}`, 1);
  db.prepare('UPDATE orders SET waiting = 1 WHERE id = ?').run(o.id);
  res.json(publicOrder(getById.get(o.id)));
});
app.post('/api/track/:code/messages', limit('msg', 20, 10 * 60e3), (req, res) => {
  const o = findForCustomer(req, res); if (!o) return;
  const text = clean(req.body?.text, 2000);
  if (!text) return res.status(400).json({ error: 'Write a message first.' });
  const t = now();
  addEvent.run(o.id, t, 'customer', text, 1);
  db.prepare('UPDATE orders SET waiting = 1, updated_at = ? WHERE id = ?').run(t, o.id);
  res.json(publicOrder(getById.get(o.id)));
});
app.get('/track/:code', (req, res) => {
  res.set('Referrer-Policy', 'no-referrer');
  res.sendFile(path.join(ROOT, 'public', 'track.html'));
});

/* ---------- Admin: sessions ---------- */
const sessions = new Map(); // token -> expiry time
const SESSION_MS = 12 * 3600e3;
function cookieToken(req) {
  const m = /(?:^|;\s*)bf_admin=([^;]+)/.exec(req.headers.cookie || '');
  return m ? m[1] : '';
}
function isAdmin(req) {
  const tok = cookieToken(req), exp = tok && sessions.get(tok);
  if (!exp) return false;
  if (exp < Date.now()) { sessions.delete(tok); return false; }
  return true;
}
function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Log in again.' });
  // Admin writes must be JSON, which a form on another site can't send without our permission.
  if (req.method !== 'GET' && !req.is('application/json')) return res.status(415).json({ error: 'Send JSON.' });
  next();
}
function setCookie(req, res, value, maxAge) {
  const secure = req.secure ? '; Secure' : '';
  res.set('Set-Cookie', `bf_admin=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`);
}

app.post('/api/admin/login', limit('login', 10, 15 * 60e3), (req, res) => {
  if (!ADMIN_PASSWORD) return res.status(503).json({ error: 'No admin password is set. Add ADMIN_PASSWORD to the .env file and restart.' });
  if (!safeEqual(String(req.body?.password || ''), ADMIN_PASSWORD)) return res.status(401).json({ error: 'Wrong password.' });
  const tok = crypto.randomBytes(32).toString('base64url');
  sessions.set(tok, Date.now() + SESSION_MS);
  setCookie(req, res, tok, SESSION_MS / 1000);
  res.json({ ok: true });
});
app.post('/api/admin/logout', (req, res) => {
  sessions.delete(cookieToken(req));
  setCookie(req, res, '', 0);
  res.json({ ok: true });
});
app.get('/api/admin/me', (req, res) => res.json({ loggedIn: isAdmin(req), statuses: STATUSES }));

/* ---------- Admin: orders ---------- */
app.get('/api/admin/orders', requireAdmin, (req, res) => {
  const status = String(req.query.status || ''), q = clean(req.query.q, 100);
  const where = [], args = [];
  if (STATUS_IDS.includes(status)) { where.push('status = ?'); args.push(status); }
  else if (status === 'open') { where.push("status NOT IN ('delivered','cancelled')"); }
  else if (status === 'waiting') { where.push('waiting = 1'); }
  if (q) {
    where.push("(" + ['code', 'bot_name', 'email', 'purpose'].map(c => `${c} LIKE ? ESCAPE '\\'`).join(' OR ') + ")");
    const like = `%${q.replace(/[%_]/g, m => '\\' + m)}%`;
    args.push(like, like, like, like, like);
  }
  const sql = `SELECT id, code, status, bot_name, platforms, package, email, quote_price, waiting, created_at, updated_at
    FROM orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY id DESC LIMIT 500`;
  const orders = db.prepare(sql).all(...args);
  const counts = Object.fromEntries(db.prepare('SELECT status, COUNT(*) AS n FROM orders GROUP BY status').all().map(r => [r.status, r.n]));
  counts.waiting = db.prepare('SELECT COUNT(*) AS n FROM orders WHERE waiting = 1').get().n;
  res.json({ orders, counts });
});
app.get('/api/admin/orders/:id', requireAdmin, (req, res) => {
  const o = getById.get(Number(req.params.id));
  if (!o) return res.status(404).json({ error: 'Order not found.' });
  const events = db.prepare('SELECT id, at, kind, text, public FROM events WHERE order_id = ? ORDER BY id').all(o.id);
  const { token, ...rest } = o;
  res.json({ order: { ...rest, trackUrl: `${SITE_URL}/track/${o.code}?t=${token}` }, events });
});
app.patch('/api/admin/orders/:id', requireAdmin, (req, res) => {
  const o = getById.get(Number(req.params.id));
  if (!o) return res.status(404).json({ error: 'Order not found.' });
  const b = req.body || {}, t = now(), changes = {};
  if (b.status !== undefined) {
    if (!STATUS_IDS.includes(b.status)) return res.status(400).json({ error: 'Unknown status.' });
    if (b.status !== o.status) changes.status = b.status;
  }
  if (b.quotePrice !== undefined && clean(b.quotePrice, 40) !== o.quote_price) changes.quote_price = clean(b.quotePrice, 40);
  if (b.quoteDue !== undefined && clean(b.quoteDue, 40) !== o.quote_due) changes.quote_due = clean(b.quoteDue, 40);
  if (b.waiting !== undefined && (b.waiting ? 1 : 0) !== o.waiting) changes.waiting = b.waiting ? 1 : 0;
  if (!Object.keys(changes).length) return res.json({ ok: true, unchanged: true });
  // Updating an order counts as dealing with it, unless "needs reply" was set on purpose.
  if (b.waiting === undefined && o.waiting) changes.waiting = 0;

  const cols = Object.keys(changes);
  db.prepare(`UPDATE orders SET ${cols.map(c => c + ' = ?').join(', ')}, updated_at = ? WHERE id = ?`).run(...cols.map(c => changes[c]), t, o.id);
  if (changes.quote_price !== undefined || changes.quote_due !== undefined) {
    const p = changes.quote_price ?? o.quote_price, d = changes.quote_due ?? o.quote_due;
    addEvent.run(o.id, t, 'quote', `Quote: ${p || 'no price yet'}${d ? `, ready by ${d}` : ''}`, 1);
  }
  if (changes.status) addEvent.run(o.id, t, 'status', statusLabel(changes.status), 1);
  res.json({ ok: true });
});
app.post('/api/admin/orders/:id/messages', requireAdmin, (req, res) => {
  const o = getById.get(Number(req.params.id));
  if (!o) return res.status(404).json({ error: 'Order not found.' });
  const text = clean(req.body?.text, 2000);
  if (!text) return res.status(400).json({ error: 'Write a message first.' });
  const t = now();
  addEvent.run(o.id, t, 'message', text, 1);
  db.prepare('UPDATE orders SET waiting = 0, updated_at = ? WHERE id = ?').run(t, o.id);
  res.json({ ok: true });
});
app.post('/api/admin/orders/:id/notes', requireAdmin, (req, res) => {
  const o = getById.get(Number(req.params.id));
  if (!o) return res.status(404).json({ error: 'Order not found.' });
  const text = clean(req.body?.text, 2000);
  if (!text) return res.status(400).json({ error: 'Write a note first.' });
  addEvent.run(o.id, now(), 'note', text, 0);
  res.json({ ok: true });
});
app.delete('/api/admin/orders/:id', requireAdmin, (req, res) => {
  const info = db.prepare('DELETE FROM orders WHERE id = ?').run(Number(req.params.id));
  if (!info.changes) return res.status(404).json({ error: 'Order not found.' });
  res.json({ ok: true });
});
app.get('/admin', (req, res) => {
  res.set('X-Frame-Options', 'DENY');
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(ROOT, 'public', 'admin.html'));
});

/* ---------- Static site ---------- */
app.get(['/', '/index.html'], (req, res) => res.sendFile(INDEX));
app.use(express.static(path.join(ROOT, 'public'), { index: false, extensions: ['html'] }));
app.use((req, res) => res.status(404).sendFile(INDEX));

app.listen(PORT, () => {
  console.log(`BotForge is running at ${SITE_URL}`);
  console.log(`Admin dashboard: ${SITE_URL}/admin`);
  if (!ADMIN_PASSWORD) console.warn('No ADMIN_PASSWORD set, so the admin dashboard is locked. Add one to .env and restart.');
});

/* ---------- .env loading (creates one with a random admin password on first run) ---------- */
function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file) && !process.env.ADMIN_PASSWORD) {
    const pw = crypto.randomBytes(9).toString('base64url');
    fs.writeFileSync(file, `# BotForge settings\nPORT=3000\n# Your public address, used in order links\nSITE_URL=http://localhost:3000\nADMIN_PASSWORD=${pw}\n# Set to 1 when running behind a reverse proxy such as Caddy, nginx or Cloudflare Tunnel\nTRUST_PROXY=0\n`);
    console.log('\nCreated a .env file with a new admin password: ' + pw + '\nYou can change it in .env at any time.\n');
  }
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
