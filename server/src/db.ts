import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.PONDO_DATA ?? path.resolve(here, '../../data');
fs.mkdirSync(dataDir, { recursive: true });

export const dbFile = path.join(dataDir, 'pondo.db');
export const sqlite = new Database(dbFile);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

sqlite.exec(`
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('cash','bank','ewallet','credit','investment')),
  subtitle TEXT NOT NULL DEFAULT '',
  opening_cents INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('expense','income')),
  icon TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('expense','income','transfer')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  category_id INTEGER REFERENCES categories(id),
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  to_account_id INTEGER REFERENCES accounts(id),
  note TEXT NOT NULL DEFAULT '',
  occurred_on TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(occurred_on);
CREATE INDEX IF NOT EXISTS idx_tx_account ON transactions(account_id);
CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL UNIQUE REFERENCES categories(id),
  monthly_cap_cents INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  frequency TEXT NOT NULL CHECK (frequency IN ('monthly','quarterly','annual')),
  next_due TEXT NOT NULL,
  account_id INTEGER REFERENCES accounts(id),
  category_id INTEGER REFERENCES categories(id),
  autopay INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS bill_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id INTEGER NOT NULL REFERENCES bills(id),
  transaction_id INTEGER REFERENCES transactions(id),
  paid_on TEXT NOT NULL,
  amount_cents INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS flips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'item' CHECK (kind IN ('item','cost')),
  name TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  note TEXT NOT NULL DEFAULT '',
  buy_date TEXT NOT NULL,
  buy_cost_cents INTEGER NOT NULL,
  other_cost_cents INTEGER NOT NULL DEFAULT 0,
  sale_date TEXT,
  sale_price_cents INTEGER,
  sale_fees_cents INTEGER NOT NULL DEFAULT 0,
  buy_tx_id INTEGER REFERENCES transactions(id),
  sale_tx_id INTEGER REFERENCES transactions(id)
);
`);

// additive migrations for databases created before these columns existed
const flipCols = sqlite.prepare('PRAGMA table_info(flips)').all() as { name: string }[];
if (!flipCols.some(c => c.name === 'kind')) {
  sqlite.exec("ALTER TABLE flips ADD COLUMN kind TEXT NOT NULL DEFAULT 'item'");
}
if (!flipCols.some(c => c.name === 'buy_tx_id')) {
  sqlite.exec('ALTER TABLE flips ADD COLUMN buy_tx_id INTEGER REFERENCES transactions(id)');
  sqlite.exec('ALTER TABLE flips ADD COLUMN sale_tx_id INTEGER REFERENCES transactions(id)');
}

export const db = drizzle(sqlite, { schema });

// dedicated ledger categories for the Buy & Sell module
export function ensureCategory(name: string, kind: 'expense' | 'income', icon: string): number {
  const row = sqlite.prepare('SELECT id FROM categories WHERE name = ? AND kind = ?').get(name, kind) as { id: number } | undefined;
  if (row) return row.id;
  return Number(sqlite.prepare(
    'INSERT INTO categories (name, kind, icon, sort) VALUES (?, ?, ?, 99)',
  ).run(name, kind, icon).lastInsertRowid);
}

const DEFAULT_CATEGORIES: [string, 'expense' | 'income', string][] = [
  ['Groceries', 'expense', '🛒'],
  ['Dining', 'expense', '🍜'],
  ['Transport', 'expense', '🚗'],
  ['Utilities', 'expense', '💡'],
  ['Housing', 'expense', '🏠'],
  ['Shopping', 'expense', '🛍️'],
  ['Health', 'expense', '💊'],
  ['Fun', 'expense', '🎬'],
  ['Family', 'expense', '👨‍👩‍👧'],
  ['Subscriptions', 'expense', '🔁'],
  ['Insurance', 'expense', '🛡️'],
  ['Other', 'expense', '🧾'],
  ['Salary', 'income', '💼'],
  ['Side income', 'income', '🧰'],
  ['Interest', 'income', '🏦'],
  ['Refund', 'income', '↩️'],
];

const catCount = (sqlite.prepare('SELECT COUNT(*) c FROM categories').get() as { c: number }).c;
if (catCount === 0) {
  const ins = sqlite.prepare('INSERT INTO categories (name, kind, icon, sort) VALUES (?, ?, ?, ?)');
  DEFAULT_CATEGORIES.forEach(([name, kind, icon], i) => ins.run(name, kind, icon, i));
}
