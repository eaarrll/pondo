// Background maintenance: runs at boot and every 6 hours.
// 1. Daily on-disk backup of the database (kept for 14 days).
// 2. Autopay bills log their expense on the due date and advance.
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db, dbFile, sqlite } from './db.js';
import { billPayments, bills, transactions } from './schema.js';
import { addMonths, today } from './dates.js';

const FREQ_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, annual: 12 };
const KEEP_BACKUPS = 14;

export async function autoBackup(): Promise<void> {
  const dir = path.resolve(path.dirname(dbFile), '../backups');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `auto-${today()}.db`);
  if (fs.existsSync(dest)) return; // one per day
  await sqlite.backup(dest); // sqlite-native backup — safe against WAL, unlike cp
  const autos = fs.readdirSync(dir).filter(f => /^auto-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
  for (const f of autos.slice(0, Math.max(0, autos.length - KEEP_BACKUPS))) {
    fs.unlinkSync(path.join(dir, f));
  }
  console.log(`auto-backup → backups/auto-${today()}.db`);
}

export function processAutopayBills(): void {
  const now = today();
  const rows = sqlite.prepare(`
    SELECT id, name, amount_cents amountCents, frequency, next_due nextDue,
           account_id accountId, category_id categoryId
    FROM bills WHERE active = 1 AND autopay = 1 AND account_id IS NOT NULL AND next_due <= ?
  `).all(now) as {
    id: number; name: string; amountCents: number; frequency: string;
    nextDue: string; accountId: number; categoryId: number | null;
  }[];

  for (const b of rows) {
    const step = FREQ_MONTHS[b.frequency] ?? 1;
    let due = b.nextDue;
    // Stale past dues (e.g. the app was off, or the bill predates autopay logging):
    // catch the date up WITHOUT logging money we didn't watch happen.
    while (due < now) {
      due = addMonths(due, step);
      console.log(`autopay: ${b.name} was stale — advanced to ${due} without logging`);
    }
    if (due === now) {
      const already = sqlite.prepare(
        'SELECT id FROM bill_payments WHERE bill_id = ? AND paid_on = ?',
      ).get(b.id, now);
      if (!already && b.amountCents > 0) {
        const tx = db.insert(transactions).values({
          type: 'expense',
          amountCents: b.amountCents,
          categoryId: b.categoryId,
          accountId: b.accountId,
          note: `${b.name} (autopay)`,
          occurredOn: now,
          createdAt: new Date().toISOString(),
        }).returning().get();
        db.insert(billPayments).values({
          billId: b.id, transactionId: tx.id, paidOn: now, amountCents: b.amountCents,
        }).run();
        console.log(`autopay: logged ${b.name} — ${(b.amountCents / 100).toFixed(2)}`);
      }
      due = addMonths(due, step);
    }
    if (due !== b.nextDue) db.update(bills).set({ nextDue: due }).where(eq(bills.id, b.id)).run();
  }
}

export function startMaintenance(): void {
  const tick = () => {
    try { processAutopayBills(); } catch (e) { console.log('autopay failed:', (e as Error).message); }
    autoBackup().catch(e => console.log('auto-backup failed:', (e as Error).message));
  };
  tick();
  setInterval(tick, 6 * 60 * 60 * 1000).unref();
}
