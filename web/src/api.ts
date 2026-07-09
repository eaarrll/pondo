// ---------- types (mirror server JSON) ----------

export interface Account {
  id: number;
  name: string;
  type: 'cash' | 'bank' | 'ewallet' | 'credit' | 'investment';
  subtitle: string;
  balanceCents: number;
}

export interface Category {
  id: number;
  name: string;
  kind: 'expense' | 'income';
  icon: string;
}

export interface Bootstrap {
  accounts: Account[];
  categories: Category[];
}

export interface Tx {
  id: number;
  type: 'expense' | 'income' | 'transfer';
  amountCents: number;
  categoryId: number | null;
  accountId: number;
  toAccountId: number | null;
  note: string;
  occurredOn: string;
  catName: string | null;
  catIcon: string | null;
  acctName: string;
  toName: string | null;
}

export type Period = 'day' | 'week' | 'month' | 'year';

export interface Summary {
  title: string;
  sub: string;
  start: string;
  end: string;
  inCents: number;
  outCents: number;
  netCents: number;
  prev: { inCents: number; outCents: number };
  cats: { name: string; icon: string; cents: number }[];
  trend: { label: string; buckets: { label: string; inCents: number; outCents: number }[] } | null;
}

export interface BudgetRow {
  categoryId: number;
  name: string;
  icon: string;
  capCents: number | null;
  spentCents: number;
}

export interface Bill {
  id: number;
  name: string;
  amountCents: number;
  frequency: 'monthly' | 'quarterly' | 'annual';
  nextDue: string;
  accountId: number | null;
  categoryId: number | null;
  autopay: number;
  acctName: string | null;
  catName: string | null;
  lastPaid: string | null;
  status: 'auto' | 'overdue' | 'due' | 'upcoming';
  paidThisMonth: boolean;
}

export interface NetWorth {
  currentCents: number;
  delta30Cents: number;
  series: { label: string; cents: number }[];
}

// ---------- fetch helpers ----------

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) {
    let msg = `${r.status}`;
    try { msg = ((await r.json()) as { error?: string }).error ?? msg; } catch { /* keep status */ }
    throw new Error(msg);
  }
  return r.json() as Promise<T>;
}

const post = <T,>(url: string, body: unknown, method = 'POST') =>
  j<T>(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const api = {
  bootstrap: () => j<Bootstrap>('/api/bootstrap'),
  summary: (period: Period) => j<Summary>(`/api/summary?period=${period}`),
  transactions: (q = '') => j<Tx[]>(`/api/transactions${q}`),
  addTx: (body: {
    type: string; amountCents: number; categoryId?: number;
    accountId: number; toAccountId?: number; note?: string; occurredOn?: string;
  }) => post<Tx>('/api/transactions', body),
  delTx: (id: number) => j<{ ok: boolean }>(`/api/transactions/${id}`, { method: 'DELETE' }),
  addAccount: (body: { name: string; type: string; subtitle?: string; openingCents?: number }) =>
    post<Account>('/api/accounts', body),
  delAccount: (id: number) =>
    j<{ ok: boolean; deletedTx: number }>(`/api/accounts/${id}`, { method: 'DELETE' }),
  budgets: () => j<BudgetRow[]>('/api/budgets'),
  setBudget: (categoryId: number, capCents: number) =>
    post<{ ok: boolean }>('/api/budgets', { categoryId, capCents }, 'PUT'),
  bills: () => j<Bill[]>('/api/bills'),
  addBill: (body: {
    name: string; amountCents: number; frequency: string; nextDue: string;
    accountId?: number; categoryId?: number; autopay?: boolean;
  }) => post<Bill>('/api/bills', body),
  payBill: (id: number) => post<{ ok: boolean; nextDue: string }>(`/api/bills/${id}/pay`, {}),
  networth: () => j<NetWorth>('/api/networth'),
};

// ---------- formatting ----------

export const peso = (cents: number): string => {
  const v = Math.abs(cents) / 100;
  return '₱' + v.toLocaleString('en-PH', {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
};

export const signedPeso = (cents: number): string => (cents < 0 ? '−' : '+') + peso(cents);

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const todayStr = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const shortDate = (s: string): string => `${MON[+s.slice(5, 7) - 1]} ${+s.slice(8, 10)}`;

export const dateLabel = (s: string): string => {
  if (s === todayStr()) return `Today · ${shortDate(s)}`;
  return s.slice(0, 4) === todayStr().slice(0, 4) ? shortDate(s) : `${shortDate(s)}, ${s.slice(0, 4)}`;
};
