import { useEffect, useState } from 'react';
import { api, peso, type BudgetRow, type Tx } from '../api';
import TxRow from './TxRow';
import type { ScreenProps } from '../App';

export default function Budgets({ rev, refresh, showToast, openAdd }: ScreenProps) {
  const [rows, setRows] = useState<BudgetRow[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [val, setVal] = useState('');
  const [openCat, setOpenCat] = useState<number | null>(null);
  const [catTxs, setCatTxs] = useState<Tx[]>([]);

  const now = new Date();
  const day = now.getDate();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const monthName = now.toLocaleString('en-US', { month: 'long' });
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  useEffect(() => { api.budgets().then(setRows); }, [rev]);

  // breakdown for the expanded category, current month only
  useEffect(() => {
    if (openCat == null) { setCatTxs([]); return; }
    api.transactions(`?type=expense&categoryId=${openCat}&from=${ym}-01&to=${ym}-${lastDay}&limit=200`)
      .then(setCatTxs);
  }, [openCat, rev, ym, lastDay]);

  const toggle = (categoryId: number) => setOpenCat(c => (c === categoryId ? null : categoryId));

  const delTx = async (tx: Tx) => {
    if (!window.confirm(`Delete "${tx.note || tx.catName || 'this transaction'}"? Balances and budgets will be recalculated.`)) return;
    try {
      await api.delTx(tx.id);
      showToast('Transaction deleted');
      refresh();
    } catch (err) {
      showToast(`Could not delete: ${(err as Error).message}`);
    }
  };

  const startEdit = (r: BudgetRow) => {
    setEditing(r.categoryId);
    setVal(r.capCents ? String(r.capCents / 100) : '');
  };

  const commit = async (categoryId: number) => {
    if (editing !== categoryId) return;
    setEditing(null);
    const capCents = Math.round(parseFloat(val || '0') * 100);
    try {
      await api.setBudget(categoryId, capCents);
      showToast(capCents > 0 ? 'Budget saved' : 'Budget removed');
      refresh();
    } catch (err) {
      showToast(`Could not save budget: ${(err as Error).message}`);
    }
  };

  const withCap = rows.filter(r => r.capCents != null);
  const noCap = rows.filter(r => r.capCents == null);

  const editBox = (r: BudgetRow) => (
    <input
      className="inp cap-inp num" autoFocus inputMode="decimal" value={val}
      onChange={e => setVal(e.target.value)}
      onClick={e => e.stopPropagation()}
      onBlur={() => commit(r.categoryId)}
      onKeyDown={e => {
        if (e.key === 'Enter') commit(r.categoryId);
        if (e.key === 'Escape') setEditing(null);
      }}
    />
  );

  const breakdown = (r: BudgetRow) => openCat === r.categoryId && (
    <div className="bud-breakdown">
      {catTxs.length > 0 ? (
        <>
          <div className="bud-bd-head">
            {catTxs.length} expense{catTxs.length === 1 ? '' : 's'} in {r.name} this month
            · <span className="num">{peso(catTxs.reduce((s, t) => s + t.amountCents, 0))}</span>
          </div>
          {catTxs.map(t => <TxRow key={t.id} tx={t} onDelete={delTx} />)}
        </>
      ) : (
        <div className="empty-note">No {r.name} expenses logged this month.</div>
      )}
    </div>
  );

  const caret = (r: BudgetRow) => (
    <span className="bud-caret">{openCat === r.categoryId ? '▾' : '▸'}</span>
  );

  return (
    <section>
      <div className="topbar">
        <div><h1>Budgets</h1><div className="top-sub">{monthName} {now.getFullYear()} · day {day} of {lastDay} · click a category for its expenses</div></div>
        <div className="spacer" />
        <button className="add-btn" onClick={openAdd}>＋ Add <span className="kbd">N</span></button>
      </div>

      <div className="card">
        {withCap.length === 0 && (
          <div className="empty-note">No budgets set yet. Give any category below a monthly cap.</div>
        )}
        {withCap.map(r => {
          const cap = r.capCents!;
          const pct = (r.spentCents / cap) * 100;
          const cls = pct > 100 ? 'crit' : pct >= 90 ? 'warn' : '';
          const left = cap - r.spentCents;
          return (
            <div className="bud-row" key={r.categoryId}>
              <div className="bud-top bud-click" role="button" tabIndex={0}
                title={`Show ${r.name} expenses`}
                onClick={() => toggle(r.categoryId)}
                onKeyDown={e => { if (e.key === 'Enter') toggle(r.categoryId); }}>
                {caret(r)}
                <span>{r.icon}</span><span className="nm">{r.name}</span>
                <span className="amt num">
                  {peso(r.spentCents)} /{' '}
                  {editing === r.categoryId
                    ? editBox(r)
                    : <button className="cap-btn num" title="Edit cap"
                        onClick={e => { e.stopPropagation(); startEdit(r); }}>{peso(cap)}</button>}
                </span>
              </div>
              <div className="bud-track"><div className={`bud-fill ${cls}`} style={{ width: `${Math.min(100, pct)}%` }} /></div>
              <div className="bud-note">
                {pct > 100
                  ? <span className="over">⚠ {peso(-left)} over budget</span>
                  : pct >= 90
                    ? <span className="close">◔ {peso(left)} left — pace carefully</span>
                    : <>{peso(left)} left · {Math.round(pct)}% used</>}
              </div>
              {breakdown(r)}
            </div>
          );
        })}
        {noCap.length > 0 && (
          <>
            <h3 className="nocap-head">No budget yet</h3>
            {noCap.map(r => (
              <div className="bud-row slim" key={r.categoryId}>
                <div className="bud-top bud-click" role="button" tabIndex={0}
                  title={`Show ${r.name} expenses`}
                  onClick={() => toggle(r.categoryId)}
                  onKeyDown={e => { if (e.key === 'Enter') toggle(r.categoryId); }}>
                  {caret(r)}
                  <span>{r.icon}</span><span className="nm">{r.name}</span>
                  <span className="amt num">{r.spentCents > 0 ? `${peso(r.spentCents)} spent this month` : ''}</span>
                  {editing === r.categoryId
                    ? editBox(r)
                    : <button className="bud-set" onClick={e => { e.stopPropagation(); startEdit(r); }}>Set budget</button>}
                </div>
                {breakdown(r)}
              </div>
            ))}
          </>
        )}
      </div>
    </section>
  );
}
