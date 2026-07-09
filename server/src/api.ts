import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, sqlite } from './db.js';
import { accounts, billPayments, bills, transactions } from './schema.js';
import { periodInfo, type Period } from './summary.js';
import { addDays, addMonths, MON, monthEnd, parse, today } from './dates.js';

const FREQ_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, annual: 12 };
const ACCOUNT_TYPES = ['cash', 'bank', 'ewallet', 'credit', 'investment'];

function sums(start: string, end: string): { inCents: number; outCents: number } {
  const rows = sqlite.prepare(
    `SELECT type, COALESCE(SUM(amount_cents), 0) s FROM transactions
     WHERE occurred_on BETWEEN ? AND ? AND type IN ('expense','income') GROUP BY type`,
  ).all(start, end) as { type: string; s: number }[];
  const get = (t: string) => rows.find(r => r.type === t)?.s ?? 0;
  return { inCents: get('income'), outCents: get('expense') };
}

function accountBalances() {
  return sqlite.prepare(`
    SELECT a.id, a.name, a.type, a.subtitle,
      a.opening_cents + COALESCE((
        SELECT SUM(CASE
          WHEN t.type = 'income'   AND t.account_id = a.id    THEN t.amount_cents
          WHEN t.type = 'expense'  AND t.account_id = a.id    THEN -t.amount_cents
          WHEN t.type = 'transfer' AND t.account_id = a.id    THEN -t.amount_cents
          WHEN t.type = 'transfer' AND t.to_account_id = a.id THEN t.amount_cents
          ELSE 0 END)
        FROM transactions t
        WHERE t.account_id = a.id OR t.to_account_id = a.id), 0) AS balanceCents
    FROM accounts a
    WHERE a.archived = 0
    ORDER BY a.sort, a.id`).all();
}

// Net worth = openings + all income − all expenses up to a date.
// Transfers move money between owned accounts, so they cancel out.
function netWorthAt(date: string): number {
  const opening = (sqlite.prepare(
    'SELECT COALESCE(SUM(opening_cents), 0) s FROM accounts WHERE archived = 0',
  ).get() as { s: number }).s;
  const flows = (sqlite.prepare(
    `SELECT COALESCE(SUM(CASE WHEN type = 'income' THEN amount_cents
                              WHEN type = 'expense' THEN -amount_cents
                              ELSE 0 END), 0) s
     FROM transactions WHERE occurred_on <= ?`,
  ).get(date) as { s: number }).s;
  return opening + flows;
}

const TX_SELECT = `
  SELECT t.id, t.type, t.amount_cents amountCents, t.category_id categoryId,
         t.account_id accountId, t.to_account_id toAccountId, t.note, t.occurred_on occurredOn,
         c.name catName, c.icon catIcon, a.name acctName, b.name toName
  FROM transactions t
  LEFT JOIN categories c ON c.id = t.category_id
  JOIN accounts a ON a.id = t.account_id
  LEFT JOIN accounts b ON b.id = t.to_account_id`;

export function registerApi(app: FastifyInstance): void {
  app.get('/api/bootstrap', () => ({
    accounts: accountBalances(),
    categories: sqlite.prepare(
      'SELECT id, name, kind, icon FROM categories ORDER BY kind, sort, id',
    ).all(),
  }));

  // ---------- summary (dashboard) ----------
  app.get('/api/summary', (req) => {
    const q = req.query as { period?: Period; date?: string };
    const p = periodInfo(q.period ?? 'month', q.date);
    const cur = sums(p.start, p.end);
    const prev = sums(p.prevStart, p.prevEnd);
    const cats = sqlite.prepare(`
      SELECT c.name, c.icon, SUM(t.amount_cents) cents
      FROM transactions t JOIN categories c ON c.id = t.category_id
      WHERE t.type = 'expense' AND t.occurred_on BETWEEN ? AND ?
      GROUP BY c.id ORDER BY cents DESC`).all(p.start, p.end);
    const trend = p.buckets && {
      label: p.trendLabel,
      buckets: p.buckets.map(b => ({ label: b.label, ...sums(b.start, b.end) })),
    };
    return {
      title: p.title, sub: p.sub, start: p.start, end: p.end,
      ...cur, netCents: cur.inCents - cur.outCents, prev, cats, trend,
    };
  });

  // ---------- transactions ----------
  app.get('/api/transactions', (req) => {
    const q = req.query as { type?: string; accountId?: string; limit?: string };
    const where: string[] = [];
    const args: unknown[] = [];
    if (q.type) { where.push('t.type = ?'); args.push(q.type); }
    if (q.accountId) { where.push('(t.account_id = ? OR t.to_account_id = ?)'); args.push(+q.accountId, +q.accountId); }
    const sql = `${TX_SELECT}
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY t.occurred_on DESC, t.id DESC LIMIT ?`;
    args.push(Math.min(+(q.limit ?? 200), 1000));
    return sqlite.prepare(sql).all(...args);
  });

  app.post('/api/transactions', (req, reply) => {
    const b = req.body as {
      type: string; amountCents: number; categoryId?: number;
      accountId: number; toAccountId?: number; note?: string; occurredOn?: string;
    };
    if (!['expense', 'income', 'transfer'].includes(b.type)) {
      return reply.code(400).send({ error: 'invalid type' });
    }
    if (!Number.isInteger(b.amountCents) || b.amountCents <= 0) {
      return reply.code(400).send({ error: 'amountCents must be a positive integer' });
    }
    if (b.type === 'transfer') {
      if (!b.toAccountId || b.toAccountId === b.accountId) {
        return reply.code(400).send({ error: 'transfer needs a distinct toAccountId' });
      }
    } else if (!b.categoryId) {
      return reply.code(400).send({ error: 'expense/income needs a categoryId' });
    }
    const row = db.insert(transactions).values({
      type: b.type,
      amountCents: b.amountCents,
      categoryId: b.type === 'transfer' ? null : b.categoryId,
      accountId: b.accountId,
      toAccountId: b.type === 'transfer' ? b.toAccountId : null,
      note: b.note ?? '',
      occurredOn: b.occurredOn ?? today(),
      createdAt: new Date().toISOString(),
    }).returning().get();
    return sqlite.prepare(`${TX_SELECT} WHERE t.id = ?`).get(row.id);
  });

  app.delete('/api/transactions/:id', (req) => {
    const id = +(req.params as { id: string }).id;
    sqlite.prepare('DELETE FROM bill_payments WHERE transaction_id = ?').run(id);
    db.delete(transactions).where(eq(transactions.id, id)).run();
    return { ok: true };
  });

  // ---------- accounts ----------
  app.post('/api/accounts', (req, reply) => {
    const b = req.body as { name: string; type: string; subtitle?: string; openingCents?: number };
    if (!b.name?.trim()) return reply.code(400).send({ error: 'name is required' });
    if (!ACCOUNT_TYPES.includes(b.type)) return reply.code(400).send({ error: 'invalid account type' });
    return db.insert(accounts).values({
      name: b.name.trim(),
      type: b.type,
      subtitle: b.subtitle ?? '',
      openingCents: Math.round(b.openingCents ?? 0),
      sort: ACCOUNT_TYPES.indexOf(b.type),
    }).returning().get();
  });

  app.patch('/api/accounts/:id', (req) => {
    const id = +(req.params as { id: string }).id;
    const b = req.body as Partial<{ name: string; subtitle: string; openingCents: number; archived: number }>;
    db.update(accounts).set(b).where(eq(accounts.id, id)).run();
    return { ok: true };
  });

  // Deleting an account cascades: its transactions (both sides of transfers) go
  // with it, linked bill payments are unlinked, and bills fall back to "no account".
  app.delete('/api/accounts/:id', (req, reply) => {
    const id = +(req.params as { id: string }).id;
    const acct = sqlite.prepare('SELECT id FROM accounts WHERE id = ?').get(id);
    if (!acct) return reply.code(404).send({ error: 'account not found' });
    const run = sqlite.transaction(() => {
      const txIds = sqlite.prepare(
        'SELECT id FROM transactions WHERE account_id = ? OR to_account_id = ?',
      ).all(id, id) as { id: number }[];
      const unlinkPay = sqlite.prepare('DELETE FROM bill_payments WHERE transaction_id = ?');
      for (const t of txIds) unlinkPay.run(t.id);
      sqlite.prepare('DELETE FROM transactions WHERE account_id = ? OR to_account_id = ?').run(id, id);
      sqlite.prepare('UPDATE bills SET account_id = NULL WHERE account_id = ?').run(id);
      sqlite.prepare('DELETE FROM accounts WHERE id = ?').run(id);
      return txIds.length;
    });
    return { ok: true, deletedTx: run() };
  });

  // ---------- budgets ----------
  app.get('/api/budgets', (req) => {
    const ym = (req.query as { month?: string }).month ?? today().slice(0, 7);
    const start = `${ym}-01`;
    const end = monthEnd(+ym.slice(0, 4), +ym.slice(5, 7) - 1);
    return sqlite.prepare(`
      SELECT c.id categoryId, c.name, c.icon, b.monthly_cap_cents capCents,
        COALESCE((SELECT SUM(t.amount_cents) FROM transactions t
          WHERE t.category_id = c.id AND t.type = 'expense'
            AND t.occurred_on BETWEEN ? AND ?), 0) spentCents
      FROM categories c LEFT JOIN budgets b ON b.category_id = c.id
      WHERE c.kind = 'expense'
      ORDER BY (b.monthly_cap_cents IS NULL), c.sort, c.id`).all(start, end);
  });

  app.put('/api/budgets', (req, reply) => {
    const b = req.body as { categoryId: number; capCents: number };
    if (!b.categoryId) return reply.code(400).send({ error: 'categoryId is required' });
    if (b.capCents > 0) {
      sqlite.prepare(`
        INSERT INTO budgets (category_id, monthly_cap_cents) VALUES (?, ?)
        ON CONFLICT (category_id) DO UPDATE SET monthly_cap_cents = excluded.monthly_cap_cents`,
      ).run(b.categoryId, Math.round(b.capCents));
    } else {
      sqlite.prepare('DELETE FROM budgets WHERE category_id = ?').run(b.categoryId);
    }
    return { ok: true };
  });

  // ---------- bills ----------
  app.get('/api/bills', () => {
    const now = today();
    const soon = addDays(now, 14);
    const rows = sqlite.prepare(`
      SELECT b.id, b.name, b.amount_cents amountCents, b.frequency, b.next_due nextDue,
             b.account_id accountId, b.category_id categoryId, b.autopay,
             a.name acctName, c.name catName,
             (SELECT MAX(paid_on) FROM bill_payments p WHERE p.bill_id = b.id) lastPaid
      FROM bills b
      LEFT JOIN accounts a ON a.id = b.account_id
      LEFT JOIN categories c ON c.id = b.category_id
      WHERE b.active = 1
      ORDER BY b.next_due`).all() as Record<string, unknown>[];
    return rows.map(r => {
      const due = r.nextDue as string;
      const status = r.autopay ? 'auto'
        : due < now ? 'overdue'
        : due <= soon ? 'due'
        : 'upcoming';
      const paidThisMonth = typeof r.lastPaid === 'string' && r.lastPaid.slice(0, 7) === now.slice(0, 7);
      return { ...r, status, paidThisMonth };
    });
  });

  app.post('/api/bills', (req, reply) => {
    const b = req.body as {
      name: string; amountCents: number; frequency: string; nextDue: string;
      accountId?: number; categoryId?: number; autopay?: boolean;
    };
    if (!b.name?.trim()) return reply.code(400).send({ error: 'name is required' });
    if (!FREQ_MONTHS[b.frequency]) return reply.code(400).send({ error: 'invalid frequency' });
    if (!b.nextDue) return reply.code(400).send({ error: 'nextDue is required' });
    return db.insert(bills).values({
      name: b.name.trim(),
      amountCents: Math.round(b.amountCents),
      frequency: b.frequency,
      nextDue: b.nextDue,
      accountId: b.accountId ?? null,
      categoryId: b.categoryId ?? null,
      autopay: b.autopay ? 1 : 0,
    }).returning().get();
  });

  app.patch('/api/bills/:id', (req) => {
    const id = +(req.params as { id: string }).id;
    const b = req.body as Partial<{ name: string; amountCents: number; active: number; autopay: number; nextDue: string }>;
    db.update(bills).set(b).where(eq(bills.id, id)).run();
    return { ok: true };
  });

  // Pay a bill: logs the expense, records the payment, advances next_due.
  app.post('/api/bills/:id/pay', (req, reply) => {
    const id = +(req.params as { id: string }).id;
    const b = (req.body ?? {}) as { accountId?: number; date?: string };
    const bill = sqlite.prepare('SELECT * FROM bills WHERE id = ?').get(id) as Record<string, number | string> | undefined;
    if (!bill) return reply.code(404).send({ error: 'bill not found' });
    const accountId = b.accountId ?? (bill.account_id as number | null);
    if (!accountId) return reply.code(400).send({ error: 'bill has no default account — pass accountId' });
    const date = b.date ?? today();
    const tx = db.insert(transactions).values({
      type: 'expense',
      amountCents: bill.amount_cents as number,
      categoryId: (bill.category_id as number | null) ?? null,
      accountId,
      note: bill.name as string,
      occurredOn: date,
      createdAt: new Date().toISOString(),
    }).returning().get();
    db.insert(billPayments).values({
      billId: id, transactionId: tx.id, paidOn: date, amountCents: bill.amount_cents as number,
    }).run();
    const nextDue = addMonths(bill.next_due as string, FREQ_MONTHS[bill.frequency as string]);
    db.update(bills).set({ nextDue }).where(eq(bills.id, id)).run();
    return { ok: true, nextDue, transactionId: tx.id };
  });

  // ---------- net worth ----------
  app.get('/api/networth', () => {
    const now = today();
    const d = parse(now);
    const series: { label: string; cents: number }[] = [];
    for (let i = 5; i >= 1; i--) {
      const t = new Date(d.getFullYear(), d.getMonth() - i + 1, 0); // end of month, i months back
      series.push({ label: MON[t.getMonth()], cents: netWorthAt(
        `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`,
      ) });
    }
    series.push({ label: MON[d.getMonth()], cents: netWorthAt(now) });
    return {
      currentCents: netWorthAt(now),
      delta30Cents: netWorthAt(now) - netWorthAt(addDays(now, -30)),
      series,
    };
  });
}
