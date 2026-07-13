import { useEffect, useState } from 'react';
import { api, dateLabel, peso, type Account, type Tx } from '../api';
import TxRow from './TxRow';
import QuickAdd from './QuickAdd';
import type { ScreenProps } from '../App';

const TYPES = [
  ['all', 'All'], ['expense', 'Expenses'], ['income', 'Income'], ['transfer', 'Transfers'],
] as const;

const PERIODS = [
  ['all', 'All time'], ['month', 'This month'], ['lastmonth', 'Last month'],
  ['90d', 'Last 90 days'], ['year', 'This year'],
] as const;

const SORTS = [
  ['date_desc', 'Newest first'], ['date_asc', 'Oldest first'],
  ['amount_desc', 'Amount: high → low'], ['amount_asc', 'Amount: low → high'],
] as const;

function periodRange(p: string): { from?: string; to?: string } {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  switch (p) {
    case 'month': return { from: fmt(new Date(y, m, 1)) };
    case 'lastmonth': return { from: fmt(new Date(y, m - 1, 1)), to: fmt(new Date(y, m, 0)) };
    case '90d': { const d = new Date(); d.setDate(d.getDate() - 90); return { from: fmt(d) }; }
    case 'year': return { from: `${y}-01-01` };
    default: return {};
  }
}

export default function Transactions({ boot, rev, refresh, showToast, openAdd, account, onClearAccount }:
  ScreenProps & { account: Account | null; onClearAccount: () => void }) {
  const [type, setType] = useState('all');
  const [categoryId, setCategoryId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [period, setPeriod] = useState('all');
  const [sort, setSort] = useState('date_desc');
  const [search, setSearch] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [txs, setTxs] = useState<Tx[]>([]);
  const [editTx, setEditTx] = useState<Tx | null>(null);

  // account drill-in from the Accounts screen pre-selects the account filter
  useEffect(() => { if (account) setAccountId(String(account.id)); }, [account]);

  // debounce free-text search
  useEffect(() => {
    const t = window.setTimeout(() => setSearchQ(search.trim()), 250);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const { from, to } = periodRange(period);
    const parts = ['limit=500', `sort=${sort}`];
    if (type !== 'all') parts.push(`type=${type}`);
    if (categoryId) parts.push(`categoryId=${categoryId}`);
    if (accountId) parts.push(`accountId=${accountId}`);
    if (from) parts.push(`from=${from}`);
    if (to) parts.push(`to=${to}`);
    if (searchQ) parts.push(`q=${encodeURIComponent(searchQ)}`);
    api.transactions('?' + parts.join('&')).then(setTxs);
  }, [type, categoryId, accountId, period, sort, searchQ, rev]);

  const del = async (tx: Tx) => {
    if (!window.confirm(`Delete "${tx.note || tx.catName || 'this transaction'}"? Balances will be recalculated.`)) return;
    try {
      await api.delTx(tx.id);
      showToast('Transaction deleted');
      refresh();
    } catch (err) {
      showToast(`Could not delete: ${(err as Error).message}`);
    }
  };

  const filtered = type !== 'all' || categoryId || accountId || period !== 'all' || searchQ || sort !== 'date_desc';
  const clearAll = () => {
    setType('all'); setCategoryId(''); setAccountId(''); setPeriod('all');
    setSort('date_desc'); setSearch(''); onClearAccount();
  };

  const inSum = txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amountCents, 0);
  const outSum = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amountCents, 0);
  const groupByDate = sort.startsWith('date');
  const expenseCats = boot.categories.filter(c => c.kind === 'expense');
  const incomeCats = boot.categories.filter(c => c.kind === 'income');

  let lastDate = '';
  return (
    <section>
      <div className="topbar">
        <div><h1>Transactions</h1><div className="top-sub">Every peso in and out — transfers never double-count</div></div>
        <div className="spacer" />
        <a className="theme-btn" href="/api/export/transactions.csv" download>⇩ Export CSV</a>
        <button className="add-btn" onClick={openAdd}>＋ Add <span className="kbd">N</span></button>
      </div>

      <div className="filters">
        {TYPES.map(([id, label]) => (
          <button key={id} className={`fchip ${type === id ? 'on' : ''}`} onClick={() => setType(id)}>{label}</button>
        ))}
        <select className="fsel" value={categoryId} onChange={e => setCategoryId(e.target.value)} aria-label="Filter by category">
          <option value="">All categories</option>
          <optgroup label="Expense">
            {expenseCats.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </optgroup>
          <optgroup label="Income">
            {incomeCats.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </optgroup>
        </select>
        <select className="fsel" value={accountId}
          onChange={e => { setAccountId(e.target.value); if (!e.target.value) onClearAccount(); }}
          aria-label="Filter by account">
          <option value="">All accounts</option>
          {boot.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select className="fsel" value={period} onChange={e => setPeriod(e.target.value)} aria-label="Filter by period">
          {PERIODS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
        <select className="fsel" value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort">
          {SORTS.map(([id, label]) => <option key={id} value={id}>⇅ {label}</option>)}
        </select>
        <input className="fsearch" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search notes, category, account…" aria-label="Search transactions" />
        {filtered && <button className="fchip clear-chip" onClick={clearAll}>✕ Clear</button>}
      </div>

      <div className="fsummary num">
        {txs.length} transaction{txs.length === 1 ? '' : 's'}
        {inSum > 0 ? <> · in <span className="up">{peso(inSum)}</span></> : null}
        {outSum > 0 ? <> · out <span className="down">{peso(outSum)}</span></> : null}
      </div>

      <div className="card">
        {txs.map(t => {
          const header = groupByDate && t.occurredOn !== lastDate
            ? <div className="tx-group">{dateLabel(t.occurredOn)}</div> : null;
          lastDate = t.occurredOn;
          return <div key={t.id}>{header}<TxRow tx={t} onDelete={del} onEdit={setEditTx} /></div>;
        })}
        {txs.length === 0 && (
          <div className="empty-note">
            {filtered ? 'Nothing matches these filters.' : <>No transactions yet. Press <span className="kbd">N</span> to log one.</>}
          </div>
        )}
      </div>

      {editTx && (
        <QuickAdd
          accounts={boot.accounts}
          categories={boot.categories}
          edit={editTx}
          onClose={() => setEditTx(null)}
          onSaved={(msg) => { setEditTx(null); showToast(msg); refresh(); }}
        />
      )}
    </section>
  );
}

