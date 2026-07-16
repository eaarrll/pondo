import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, ensureCategory, sqlite } from './db.js';
import { accounts, billPayments, bills, flips, transactions } from './schema.js';
import { periodInfo, type Period } from './summary.js';
import { addDays, addMonths, MON, monthEnd, parse, today } from './dates.js';

const FREQ_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, annual: 12 };
const ACCOUNT_TYPES = ['cash', 'bank', 'ewallet', 'credit', 'investment', 'external'];

// Money in/out for a period. Transfers between owned accounts are neutral;
// transfers to an external (favorite) account are money out, from one money in.
function sums(start: string, end: string): { inCents: number; outCents: number } {
  return sqlite.prepare(
    `SELECT
       COALESCE(SUM(CASE
         WHEN t.type = 'income' AND fa.type != 'external' THEN t.amount_cents
         WHEN t.type = 'transfer' AND fa.type = 'external' AND COALESCE(ta.type, '') != 'external' THEN t.amount_cents
         ELSE 0 END), 0) inCents,
       COALESCE(SUM(CASE
         WHEN t.type = 'expense' AND fa.type != 'external' THEN t.amount_cents
         WHEN t.type = 'transfer' AND COALESCE(ta.type, '') = 'external' AND fa.type != 'external' THEN t.amount_cents
         ELSE 0 END), 0) outCents
     FROM transactions t
     JOIN accounts fa ON fa.id = t.account_id
     LEFT JOIN accounts ta ON ta.id = t.to_account_id
     WHERE t.occurred_on BETWEEN ? AND ?`,
  ).get(start, end) as { inCents: number; outCents: number };
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

// Net worth = owned openings + income − expenses ± transfers crossing the
// owned/external boundary. Owned↔owned transfers cancel out; favorites
// (external accounts) are other people's money and never count.
function netWorthAt(date: string): number {
  const opening = (sqlite.prepare(
    "SELECT COALESCE(SUM(opening_cents), 0) s FROM accounts WHERE archived = 0 AND type != 'external'",
  ).get() as { s: number }).s;
  const flows = (sqlite.prepare(
    `SELECT COALESCE(SUM(CASE
        WHEN t.type = 'income' AND fa.type != 'external' THEN t.amount_cents
        WHEN t.type = 'expense' AND fa.type != 'external' THEN -t.amount_cents
        WHEN t.type = 'transfer' AND COALESCE(ta.type, '') = 'external' AND fa.type != 'external' THEN -t.amount_cents
        WHEN t.type = 'transfer' AND fa.type = 'external' AND COALESCE(ta.type, '') != 'external' THEN t.amount_cents
        ELSE 0 END), 0) s
     FROM transactions t
     JOIN accounts fa ON fa.id = t.account_id
     LEFT JOIN accounts ta ON ta.id = t.to_account_id
     WHERE t.occurred_on <= ?`,
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
  const TX_SORTS: Record<string, string> = {
    date_desc: 't.occurred_on DESC, t.id DESC',
    date_asc: 't.occurred_on ASC, t.id ASC',
    amount_desc: 't.amount_cents DESC, t.occurred_on DESC, t.id DESC',
    amount_asc: 't.amount_cents ASC, t.occurred_on DESC, t.id DESC',
  };

  app.get('/api/transactions', (req) => {
    const q = req.query as {
      type?: string; accountId?: string; categoryId?: string;
      from?: string; to?: string; q?: string; sort?: string; limit?: string;
    };
    const where: string[] = [];
    const args: unknown[] = [];
    if (q.type) { where.push('t.type = ?'); args.push(q.type); }
    if (q.accountId) { where.push('(t.account_id = ? OR t.to_account_id = ?)'); args.push(+q.accountId, +q.accountId); }
    if (q.categoryId) { where.push('t.category_id = ?'); args.push(+q.categoryId); }
    if (q.from) { where.push('t.occurred_on >= ?'); args.push(q.from); }
    if (q.to) { where.push('t.occurred_on <= ?'); args.push(q.to); }
    if (q.q?.trim()) {
      where.push('(t.note LIKE ? OR c.name LIKE ? OR a.name LIKE ?)');
      const like = `%${q.q.trim()}%`;
      args.push(like, like, like);
    }
    const sql = `${TX_SELECT}
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY ${TX_SORTS[q.sort ?? ''] ?? TX_SORTS.date_desc} LIMIT ?`;
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

  app.patch('/api/transactions/:id', (req, reply) => {
    const id = +(req.params as { id: string }).id;
    const existing = sqlite.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as {
      type: string; amount_cents: number; category_id: number | null;
      account_id: number; to_account_id: number | null; note: string; occurred_on: string;
    } | undefined;
    if (!existing) return reply.code(404).send({ error: 'transaction not found' });
    const b = req.body as Partial<{
      type: string; amountCents: number; categoryId: number | null;
      accountId: number; toAccountId: number | null; note: string; occurredOn: string;
    }>;
    const type = b.type ?? existing.type;
    const amountCents = b.amountCents ?? existing.amount_cents;
    const categoryId = b.categoryId !== undefined ? b.categoryId : existing.category_id;
    const accountId = b.accountId ?? existing.account_id;
    const toAccountId = b.toAccountId !== undefined ? b.toAccountId : existing.to_account_id;
    if (!['expense', 'income', 'transfer'].includes(type)) {
      return reply.code(400).send({ error: 'invalid type' });
    }
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      return reply.code(400).send({ error: 'amountCents must be a positive integer' });
    }
    if (type === 'transfer') {
      if (!toAccountId || toAccountId === accountId) {
        return reply.code(400).send({ error: 'transfer needs a distinct toAccountId' });
      }
    } else if (!categoryId) {
      return reply.code(400).send({ error: 'expense/income needs a categoryId' });
    }
    db.update(transactions).set({
      type,
      amountCents,
      categoryId: type === 'transfer' ? null : categoryId,
      accountId,
      toAccountId: type === 'transfer' ? toAccountId : null,
      note: b.note ?? existing.note,
      occurredOn: b.occurredOn ?? existing.occurred_on,
    }).where(eq(transactions.id, id)).run();
    return sqlite.prepare(`${TX_SELECT} WHERE t.id = ?`).get(id);
  });

  // full ledger as CSV — oldest first, for spreadsheets and taxes
  app.get('/api/export/transactions.csv', (_req, reply) => {
    const rows = sqlite.prepare(`${TX_SELECT} ORDER BY t.occurred_on ASC, t.id ASC`).all() as {
      occurredOn: string; type: string; amountCents: number;
      catName: string | null; acctName: string; toName: string | null; note: string;
    }[];
    const esc = (v: unknown) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = ['date,type,amount_php,category,account,to_account,note'];
    for (const r of rows) {
      lines.push([
        r.occurredOn, r.type, (r.amountCents / 100).toFixed(2),
        r.catName ?? '', r.acctName, r.toName ?? '', r.note,
      ].map(esc).join(','));
    }
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="pondo-transactions.csv"');
    return lines.join('\n') + '\n';
  });

  app.delete('/api/transactions/:id', (req) => {
    const id = +(req.params as { id: string }).id;
    sqlite.prepare('DELETE FROM bill_payments WHERE transaction_id = ?').run(id);
    // a flip's linked ledger row may be deleted directly — unlink, don't dangle
    sqlite.prepare('UPDATE flips SET buy_tx_id = NULL WHERE buy_tx_id = ?').run(id);
    sqlite.prepare('UPDATE flips SET sale_tx_id = NULL WHERE sale_tx_id = ?').run(id);
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

  // Reconcile: user states the account's TRUE current balance; we adjust the
  // opening balance by the difference. History stays intact, no fake transactions.
  app.post('/api/accounts/:id/reconcile', (req, reply) => {
    const id = +(req.params as { id: string }).id;
    const b = req.body as { targetBalanceCents: number };
    if (!Number.isInteger(b.targetBalanceCents)) {
      return reply.code(400).send({ error: 'targetBalanceCents must be an integer' });
    }
    const acct = (accountBalances() as { id: number; balanceCents: number }[]).find(a => a.id === id);
    if (!acct) return reply.code(404).send({ error: 'account not found' });
    const deltaCents = b.targetBalanceCents - acct.balanceCents;
    if (deltaCents !== 0) {
      sqlite.prepare('UPDATE accounts SET opening_cents = opening_cents + ? WHERE id = ?').run(deltaCents, id);
    }
    return { ok: true, deltaCents };
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
      sqlite.prepare('UPDATE flips SET buy_tx_id = NULL WHERE buy_tx_id NOT IN (SELECT id FROM transactions)').run();
      sqlite.prepare('UPDATE flips SET sale_tx_id = NULL WHERE sale_tx_id NOT IN (SELECT id FROM transactions)').run();
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

  // ---------- buy & sell (flips) ----------
  // Standalone side-business module: cash math is derived from the rows, never stored.
  app.get('/api/flips', () => {
    const rows = sqlite.prepare(`
      SELECT f.id, f.kind, f.name, f.qty, f.note, f.buy_date buyDate, f.buy_cost_cents buyCostCents,
             f.other_cost_cents otherCostCents, f.sale_date saleDate,
             f.sale_price_cents salePriceCents, f.sale_fees_cents saleFeesCents,
             f.buy_tx_id buyTxId, f.sale_tx_id saleTxId,
             ba.name buyAcctName, sa.name saleAcctName
      FROM flips f
      LEFT JOIN transactions bt ON bt.id = f.buy_tx_id
      LEFT JOIN accounts ba ON ba.id = bt.account_id
      LEFT JOIN transactions st ON st.id = f.sale_tx_id
      LEFT JOIN accounts sa ON sa.id = st.account_id
      ORDER BY COALESCE(f.sale_date, f.buy_date) DESC, f.id DESC`).all() as {
      id: number; kind: string; name: string; qty: number; note: string;
      buyDate: string; buyCostCents: number; otherCostCents: number;
      saleDate: string | null; salePriceCents: number | null; saleFeesCents: number;
      buyTxId: number | null; saleTxId: number | null;
      buyAcctName: string | null; saleAcctName: string | null;
    }[];
    const now = today();
    const items = rows.map(r => {
      const costCents = r.buyCostCents + r.otherCostCents;
      if (r.kind === 'cost') {
        // operational expense: instant realized loss, never stock, nothing to sell
        return { ...r, costCents, proceedsCents: null, profitCents: -costCents, status: 'cost', daysHeld: 0 };
      }
      const sold = r.saleDate != null;
      const proceedsCents = sold ? (r.salePriceCents ?? 0) - r.saleFeesCents : null;
      const profitCents = sold ? (proceedsCents as number) - costCents : null;
      const status = !sold ? 'stock' : (r.salePriceCents ?? 0) === 0 ? 'writeoff' : 'sold';
      const daysHeld = Math.round(
        (parse(sold ? (r.saleDate as string) : now).getTime() - parse(r.buyDate).getTime()) / 86_400_000,
      );
      return { ...r, costCents, proceedsCents, profitCents, status, daysHeld };
    });

    const sold = items.filter(i => i.status === 'sold' || i.status === 'writeoff');
    const stock = items.filter(i => i.status === 'stock');
    const opCosts = items.filter(i => i.status === 'cost');
    const cashInCents = sold.reduce((s, i) => s + (i.proceedsCents ?? 0), 0);
    const cashOutCents = items.reduce((s, i) => s + i.costCents, 0);
    // business P&L: flip profits minus operational costs (ROI stays items-only)
    const soldProfitCents = sold.reduce((s, i) => s + (i.profitCents ?? 0), 0);
    const realizedCents = soldProfitCents - opCosts.reduce((s, i) => s + i.costCents, 0);
    const soldCost = sold.reduce((s, i) => s + i.costCents, 0);

    // monthly in/out with running balance, first activity month → current month
    const byMonth = new Map<string, { inCents: number; outCents: number }>();
    const bump = (ym: string, key: 'inCents' | 'outCents', v: number) => {
      const m = byMonth.get(ym) ?? { inCents: 0, outCents: 0 };
      m[key] += v;
      byMonth.set(ym, m);
    };
    for (const i of items) {
      bump(i.buyDate.slice(0, 7), 'outCents', i.costCents);
      if (i.saleDate) bump(i.saleDate.slice(0, 7), 'inCents', i.proceedsCents ?? 0);
    }
    const monthly: { month: string; inCents: number; outCents: number; netCents: number; runningCents: number }[] = [];
    if (byMonth.size > 0) {
      const first = [...byMonth.keys()].sort()[0];
      let cur = first;
      let running = 0;
      const last = now.slice(0, 7);
      while (cur <= last && monthly.length < 60) {
        const m = byMonth.get(cur) ?? { inCents: 0, outCents: 0 };
        running += m.inCents - m.outCents;
        monthly.push({ month: cur, ...m, netCents: m.inCents - m.outCents, runningCents: running });
        cur = addMonths(`${cur}-01`, 1).slice(0, 7);
      }
    }

    return {
      items,
      summary: {
        cashInCents, cashOutCents,
        netCents: cashInCents - cashOutCents,
        tiedUpCents: stock.reduce((s, i) => s + i.costCents, 0),
        stockCount: stock.length,
        realizedCents,
        soldCount: sold.length,
        opCostCents: opCosts.reduce((s, i) => s + i.costCents, 0),
        roiPct: soldCost > 0 ? (soldProfitCents / soldCost) * 100 : null,
      },
      monthly,
    };
  });

  // create the linked ledger row for a flip's cash movement
  const flipLedgerTx = (dir: 'buy' | 'sale', name: string, amountCents: number, accountId: number, date: string) =>
    db.insert(transactions).values({
      type: dir === 'buy' ? 'expense' : 'income',
      amountCents,
      categoryId: dir === 'buy'
        ? ensureCategory('Buy & Sell', 'expense', '📦')
        : ensureCategory('Buy & Sell', 'income', '🏷️'),
      accountId,
      note: name,
      occurredOn: date,
      createdAt: new Date().toISOString(),
    }).returning().get();

  const accountExists = (id: number) =>
    !!sqlite.prepare("SELECT id FROM accounts WHERE id = ? AND archived = 0 AND type != 'external'").get(id);

  app.post('/api/flips', (req, reply) => {
    const b = req.body as {
      kind?: string; name: string; qty?: number; note?: string; buyDate?: string;
      buyCostCents: number; otherCostCents?: number;
      // optional: item was already sold — record the whole flip in one entry
      salePriceCents?: number; saleFeesCents?: number; saleDate?: string;
      // optional ledger links
      accountId?: number; saleAccountId?: number;
    };
    const kind = b.kind ?? 'item';
    if (!['item', 'cost'].includes(kind)) return reply.code(400).send({ error: 'invalid kind' });
    if (!b.name?.trim()) return reply.code(400).send({ error: 'name is required' });
    if (!Number.isInteger(b.buyCostCents) || b.buyCostCents < 0) {
      return reply.code(400).send({ error: 'buyCostCents must be a non-negative integer' });
    }
    const sold = kind === 'item' && b.salePriceCents != null;
    if (sold && (!Number.isInteger(b.salePriceCents) || (b.salePriceCents as number) < 0)) {
      return reply.code(400).send({ error: 'salePriceCents must be a non-negative integer' });
    }
    if (b.accountId && !accountExists(b.accountId)) return reply.code(400).send({ error: 'unknown accountId' });
    if (b.saleAccountId && !accountExists(b.saleAccountId)) return reply.code(400).send({ error: 'unknown saleAccountId' });

    const name = b.name.trim();
    const buyDate = b.buyDate ?? today();
    const totalCost = b.buyCostCents + (kind === 'cost' ? 0 : Math.max(0, Math.round(b.otherCostCents ?? 0)));
    const proceeds = sold ? (b.salePriceCents as number) - Math.max(0, Math.round(b.saleFeesCents ?? 0)) : 0;

    const run = sqlite.transaction(() => {
      const buyTx = b.accountId && totalCost > 0
        ? flipLedgerTx('buy', name, totalCost, b.accountId, buyDate) : null;
      const saleTx = sold && b.saleAccountId && proceeds > 0
        ? flipLedgerTx('sale', name, proceeds, b.saleAccountId, b.saleDate ?? today()) : null;
      return db.insert(flips).values({
        kind,
        name,
        qty: kind === 'cost' ? 1 : (b.qty && b.qty > 0 ? Math.round(b.qty) : 1),
        note: b.note ?? '',
        buyDate,
        buyCostCents: b.buyCostCents,
        otherCostCents: kind === 'cost' ? 0 : Math.max(0, Math.round(b.otherCostCents ?? 0)),
        saleDate: sold ? (b.saleDate ?? today()) : null,
        salePriceCents: sold ? (b.salePriceCents as number) : null,
        saleFeesCents: sold ? Math.max(0, Math.round(b.saleFeesCents ?? 0)) : 0,
        buyTxId: buyTx?.id ?? null,
        saleTxId: saleTx?.id ?? null,
      }).returning().get();
    });
    return run();
  });

  // Sell (salePriceCents > 0) or write off (salePriceCents = 0)
  app.post('/api/flips/:id/sell', (req, reply) => {
    const id = +(req.params as { id: string }).id;
    const b = req.body as { salePriceCents: number; saleFeesCents?: number; saleDate?: string; accountId?: number };
    const row = sqlite.prepare('SELECT id, kind, name FROM flips WHERE id = ?').get(id) as { kind: string; name: string } | undefined;
    if (!row) return reply.code(404).send({ error: 'item not found' });
    if (row.kind === 'cost') return reply.code(400).send({ error: 'operational costs cannot be sold' });
    if (!Number.isInteger(b.salePriceCents) || b.salePriceCents < 0) {
      return reply.code(400).send({ error: 'salePriceCents must be a non-negative integer' });
    }
    if (b.accountId && !accountExists(b.accountId)) return reply.code(400).send({ error: 'unknown accountId' });
    const fees = Math.max(0, Math.round(b.saleFeesCents ?? 0));
    const proceeds = b.salePriceCents - fees;
    const saleDate = b.saleDate ?? today();
    const run = sqlite.transaction(() => {
      const saleTx = b.accountId && proceeds > 0
        ? flipLedgerTx('sale', row.name, proceeds, b.accountId, saleDate) : null;
      db.update(flips).set({
        saleDate,
        salePriceCents: b.salePriceCents,
        saleFeesCents: fees,
        saleTxId: saleTx?.id ?? null,
      }).where(eq(flips.id, id)).run();
    });
    run();
    return { ok: true };
  });

  // Undo a sale (back to stock) — removes the linked income row too
  app.post('/api/flips/:id/unsell', (req, reply) => {
    const id = +(req.params as { id: string }).id;
    const row = sqlite.prepare('SELECT id, kind, sale_tx_id saleTxId FROM flips WHERE id = ?').get(id) as
      { kind: string; saleTxId: number | null } | undefined;
    if (!row) return reply.code(404).send({ error: 'item not found' });
    if (row.kind === 'cost') return reply.code(400).send({ error: 'operational costs have no sale to undo' });
    const run = sqlite.transaction(() => {
      db.update(flips).set({ saleDate: null, salePriceCents: null, saleFeesCents: 0, saleTxId: null })
        .where(eq(flips.id, id)).run();
      if (row.saleTxId) db.delete(transactions).where(eq(transactions.id, row.saleTxId)).run();
    });
    run();
    return { ok: true };
  });

  // Deleting a flip removes its linked ledger rows with it
  app.delete('/api/flips/:id', (req) => {
    const id = +(req.params as { id: string }).id;
    const row = sqlite.prepare('SELECT buy_tx_id buyTxId, sale_tx_id saleTxId FROM flips WHERE id = ?').get(id) as
      { buyTxId: number | null; saleTxId: number | null } | undefined;
    const run = sqlite.transaction(() => {
      db.delete(flips).where(eq(flips.id, id)).run();
      if (row?.buyTxId) db.delete(transactions).where(eq(transactions.id, row.buyTxId)).run();
      if (row?.saleTxId) db.delete(transactions).where(eq(transactions.id, row.saleTxId)).run();
    });
    run();
    return { ok: true };
  });
}
