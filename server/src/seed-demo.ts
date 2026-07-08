// Seeds ~6 months of realistic demo data so the app is explorable immediately.
// Refuses to run on a database that already has accounts.
import { db, sqlite } from './db.js';
import { accounts, transactions } from './schema.js';
import { fmt, today } from './dates.js';

const existing = (sqlite.prepare('SELECT COUNT(*) c FROM accounts').get() as { c: number }).c;
if (existing > 0) {
  console.error('Refusing to seed: accounts already exist. Run `npm run db:reset` first.');
  process.exit(1);
}

const P = (pesos: number) => Math.round(pesos * 100);
const now = today();
const SORT = ['cash', 'bank', 'ewallet', 'credit', 'investment'];

// day N of the month `monthsBack` months ago; null if it lands in the future
function d(monthsBack: number, day: number): string | null {
  const base = new Date();
  const t = new Date(base.getFullYear(), base.getMonth() - monthsBack, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(day, last));
  const s = fmt(t);
  return s <= now ? s : null;
}

const acct = (name: string, type: string, subtitle: string, openingPesos: number): number =>
  db.insert(accounts).values({
    name, type, subtitle, openingCents: P(openingPesos), sort: SORT.indexOf(type),
  }).returning().get().id;

const cash = acct('Cash (wallet)', 'cash', 'physical cash', 6000);
const bpi = acct('BPI Checking', 'bank', 'payroll', 45000);
const ub = acct('UnionBank Savings', 'bank', 'emergency fund', 260000);
acct('SeaBank', 'bank', 'high-interest parking', 51200);
const gcash = acct('GCash', 'ewallet', 'daily spend', 3000);
const maya = acct('Maya', 'ewallet', 'bills', 6000);
const cc = acct('BPI Amore Visa', 'credit', 'credit card', 0);
acct('COL Financial', 'investment', 'PH equities', 214500);
acct('Pag-IBIG MP2', 'investment', '5-yr savings', 168000);

const catId = (name: string): number =>
  (sqlite.prepare('SELECT id FROM categories WHERE name = ?').get(name) as { id: number }).id;

let created = 0;
function tx(type: 'expense' | 'income' | 'transfer', pesos: number,
  o: { cat?: string; from: number; to?: number; note?: string; on: string | null }): void {
  if (!o.on) return;
  db.insert(transactions).values({
    type, amountCents: P(pesos),
    categoryId: o.cat ? catId(o.cat) : null,
    accountId: o.from, toAccountId: o.to ?? null,
    note: o.note ?? '', occurredOn: o.on, createdAt: new Date().toISOString(),
  }).run();
  created++;
}

for (let mb = 5; mb >= 0; mb--) {
  // deterministic wiggle so months differ without Math.random
  const v = (base: number, spread: number, salt: number) => base + ((mb * 13 + salt * 7) % spread);

  tx('income', 70000, { cat: 'Salary', from: bpi, note: 'Salary — 1st half', on: d(mb, 5) });
  tx('income', 70000, { cat: 'Salary', from: bpi, note: 'Salary — 2nd half', on: d(mb, 20) });
  if (mb % 2 === 0) tx('income', v(4000, 3000, 1), { cat: 'Side income', from: maya, note: 'Freelance', on: d(mb, 2) });

  tx('expense', 25000, { cat: 'Housing', from: bpi, note: 'Rent', on: d(mb, 1) });
  tx('expense', v(3100, 900, 2), { cat: 'Utilities', from: maya, note: 'Meralco', on: d(mb, 7) });
  tx('expense', v(580, 120, 3), { cat: 'Utilities', from: maya, note: 'Maynilad', on: d(mb, 15) });
  tx('expense', 2099, { cat: 'Utilities', from: bpi, note: 'PLDT Home Fiber', on: d(mb, 20) });
  tx('expense', 549, { cat: 'Subscriptions', from: cc, note: 'Netflix', on: d(mb, 10) });
  tx('expense', 149, { cat: 'Subscriptions', from: gcash, note: 'Spotify', on: d(mb, 3) });
  tx('expense', 99, { cat: 'Subscriptions', from: cc, note: 'iCloud+', on: d(mb, 5) });
  tx('expense', 239, { cat: 'Subscriptions', from: gcash, note: 'YouTube Premium', on: d(mb, 9) });
  for (const day of [2, 9, 16, 23]) tx('expense', v(1600, 1400, day), { cat: 'Groceries', from: cc, note: 'Groceries', on: d(mb, day) });
  for (const day of [4, 11, 18, 25]) tx('expense', v(400, 700, day), { cat: 'Dining', from: gcash, note: 'Eating out', on: d(mb, day) });
  for (const day of [3, 10, 17, 24]) tx('expense', v(250, 350, day), { cat: 'Transport', from: gcash, note: 'Grab / fuel', on: d(mb, day) });
  tx('expense', v(2500, 3500, 4), { cat: 'Shopping', from: cc, note: 'Shopping', on: d(mb, 14) });
  tx('expense', v(800, 2200, 5), { cat: 'Fun', from: gcash, note: 'Movies / games', on: d(mb, 21) });
  tx('expense', 15000, { cat: 'Family', from: bpi, note: 'Family support', on: d(mb, 21) });
  if (mb % 3 === 1) tx('expense', 8940, { cat: 'Insurance', from: bpi, note: 'Car insurance (quarterly)', on: d(mb, 12) });

  tx('transfer', 15000, { from: bpi, to: ub, note: 'Auto-save sweep', on: d(mb, 6) });
  tx('transfer', 6000, { from: bpi, to: gcash, note: 'GCash top-up', on: d(mb, 7) });
  tx('transfer', 2000, { from: bpi, to: cash, note: 'ATM withdrawal', on: d(mb, 8) });
  tx('transfer', v(9000, 4000, 6), { from: bpi, to: cc, note: 'Credit card payment', on: d(mb, 1) });
}

// ---- budgets ----
const BUDGETS: [string, number][] = [
  ['Groceries', 12000], ['Dining', 6000], ['Transport', 4000], ['Utilities', 9000],
  ['Shopping', 6000], ['Fun', 3000], ['Family', 15000], ['Subscriptions', 2000], ['Health', 3000],
];
for (const [name, cap] of BUDGETS) {
  sqlite.prepare('INSERT INTO budgets (category_id, monthly_cap_cents) VALUES (?, ?)').run(catId(name), P(cap));
}

// ---- bills ----
// due day this month, or next month if it would demo as ancient history
function due(day: number, opts: { allowPast?: boolean } = {}): string {
  const t = new Date();
  const thisMonth = fmt(new Date(t.getFullYear(), t.getMonth(),
    Math.min(day, new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate())));
  if (thisMonth >= now || opts.allowPast) return thisMonth;
  return fmt(new Date(t.getFullYear(), t.getMonth() + 1, day));
}
const bill = sqlite.prepare(`INSERT INTO bills
  (name, amount_cents, frequency, next_due, account_id, category_id, autopay)
  VALUES (?, ?, ?, ?, ?, ?, ?)`);
bill.run('Meralco', P(3450), 'monthly', due(12), maya, catId('Utilities'), 0);
bill.run('Maynilad', P(620), 'monthly', due(15), maya, catId('Utilities'), 0);
bill.run('PLDT Home Fiber', P(2099), 'monthly', due(20), bpi, catId('Utilities'), 0);
bill.run('Netflix', P(549), 'monthly', due(10), cc, catId('Subscriptions'), 1);
bill.run('Spotify', P(149), 'monthly', due(28), gcash, catId('Subscriptions'), 0);
bill.run('YouTube Premium', P(239), 'monthly', due(9), gcash, catId('Subscriptions'), 0);
bill.run('iCloud+ 200GB', P(99), 'monthly', due(26), cc, catId('Subscriptions'), 1);
bill.run('HOA dues', P(1500), 'monthly', due(5, { allowPast: true }), cash, catId('Housing'), 0); // demo: overdue
bill.run('Car insurance', P(8940), 'quarterly', due(12), bpi, catId('Insurance'), 0);

console.log(`Seeded 9 accounts, ${created} transactions, ${BUDGETS.length} budgets, 9 bills.`);
console.log('Start the app with `npm run dev` (or `npm start`).');
