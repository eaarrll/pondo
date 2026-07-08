import { useEffect, useState } from 'react';
import { api, peso, type BudgetRow } from '../api';
import type { ScreenProps } from '../App';

export default function Budgets({ rev, refresh, showToast, openAdd }: ScreenProps) {
  const [rows, setRows] = useState<BudgetRow[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [val, setVal] = useState('');

  useEffect(() => { api.budgets().then(setRows); }, [rev]);

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

  const now = new Date();
  const day = now.getDate();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const monthName = now.toLocaleString('en-US', { month: 'long' });

  const withCap = rows.filter(r => r.capCents != null);
  const noCap = rows.filter(r => r.capCents == null);

  const editBox = (r: BudgetRow) => (
    <input
      className="inp cap-inp num" autoFocus inputMode="decimal" value={val}
      onChange={e => setVal(e.target.value)}
      onBlur={() => commit(r.categoryId)}
      onKeyDown={e => {
        if (e.key === 'Enter') commit(r.categoryId);
        if (e.key === 'Escape') setEditing(null);
      }}
    />
  );

  return (
    <section>
      <div className="topbar">
        <div><h1>Budgets</h1><div className="top-sub">{monthName} {now.getFullYear()} · day {day} of {lastDay}</div></div>
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
              <div className="bud-top">
                <span>{r.icon}</span><span className="nm">{r.name}</span>
                <span className="amt num">
                  {peso(r.spentCents)} /{' '}
                  {editing === r.categoryId
                    ? editBox(r)
                    : <button className="cap-btn num" onClick={() => startEdit(r)} title="Edit cap">{peso(cap)}</button>}
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
            </div>
          );
        })}
        {noCap.length > 0 && (
          <>
            <h3 className="nocap-head">No budget yet</h3>
            {noCap.map(r => (
              <div className="bud-row slim" key={r.categoryId}>
                <div className="bud-top">
                  <span>{r.icon}</span><span className="nm">{r.name}</span>
                  <span className="amt num">{r.spentCents > 0 ? `${peso(r.spentCents)} spent this month` : ''}</span>
                  {editing === r.categoryId
                    ? editBox(r)
                    : <button className="bud-set" onClick={() => startEdit(r)}>Set budget</button>}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </section>
  );
}
