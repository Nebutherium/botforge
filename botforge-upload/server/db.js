// Database: one SQLite file in ./data, using Node's built-in sqlite (no native build step needed).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const STATUSES = [
  { id: 'new',         label: 'New' },
  { id: 'quoted',      label: 'Quote sent' },
  { id: 'approved',    label: 'Quote approved' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'testing',     label: 'Testing' },
  { id: 'delivered',   label: 'Delivered' },
  { id: 'cancelled',   label: 'Cancelled' }
];
export const STATUS_IDS = STATUSES.map(s => s.id);
export const statusLabel = id => (STATUSES.find(s => s.id === id) || { label: id }).label;

export function openDb(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'botforge.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS orders (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      code             TEXT UNIQUE,
      token            TEXT NOT NULL,
      status           TEXT NOT NULL DEFAULT 'new',
      bot_name         TEXT NOT NULL,
      platforms        TEXT NOT NULL DEFAULT '',
      features         TEXT NOT NULL DEFAULT '',
      purpose          TEXT NOT NULL,
      commands         TEXT NOT NULL DEFAULT '',
      server           TEXT NOT NULL DEFAULT '',
      budget           TEXT NOT NULL DEFAULT '',
      package          TEXT NOT NULL DEFAULT '',
      hosting          TEXT NOT NULL DEFAULT '',
      discord          TEXT NOT NULL DEFAULT '',
      email            TEXT NOT NULL DEFAULT '',
      quote_price      TEXT NOT NULL DEFAULT '',
      quote_due        TEXT NOT NULL DEFAULT '',
      customer_message TEXT NOT NULL DEFAULT '',
      created_at       TEXT NOT NULL,
      updated_at       TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id  INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      at        TEXT NOT NULL,
      kind      TEXT NOT NULL,
      text      TEXT NOT NULL,
      public    INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS events_order ON events(order_id);
  `);
  // waiting = 1 when the customer is waiting on us (new order, a message, or an approved quote)
  const cols = db.prepare('PRAGMA table_info(orders)').all().map(c => c.name);
  if (!cols.includes('waiting')) db.exec('ALTER TABLE orders ADD COLUMN waiting INTEGER NOT NULL DEFAULT 1');
  return db;
}
