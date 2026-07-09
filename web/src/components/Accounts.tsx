import { useEffect, useState } from 'react';
import { api, peso, type Account, type NetWorth } from '../api';
import type { ScreenProps } from '../App';

const GROUPS: [string, string[]][] = [
  ['Cash & Banks', ['cash', 'bank']],
  ['E-Wallets', ['ewallet']],
  ['Credit Cards', ['credit']],
  ['Investments', ['investment']],
];
const TYPE_OPTIONS = [
  ['bank', 'Bank'], ['ewallet', 'E-wallet'], ['cash', 'Cash'],
  ['credit', 'Credit card'], ['investment', 'Investment'],
] as const;
const TYPE_ICON: Record<string, string> = {
  cash: '💵', bank: '🏦', ewallet: '📱', credit: '💳', investment: '📈',
};

export default function Accounts({ boot, rev, refresh, showToast, viewAccountTx }: ScreenProps) {
  const [nw, setNw] = useState<NetWorth | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<string>('bank');
  const [subtitle, setSubtitle] = useState('');
  const [opening, setOpening] = useState('');

  useEffect(() => { api.networth().then(setNw); }, [rev]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await api.addAccount({
        name: name.trim(), type, subtitle,
        openingCents: Math.round(parseFloat(opening || '0') * 100),
      });
      showToast(`Account "${name.trim()}" added`);
      setFormOpen(false); setName(''); setSubtitle(''); setOpening('');
      refresh();
    } catch (err) {
      showToast(`Could not add account: ${(err as Error).message}`);
    }
  };

  const del = async (a: Account) => {
    try {
      const txs = await api.transactions(`?accountId=${a.id}&limit=1000`);
      const detail = txs.length
        ? `\n\nThis also deletes its ${txs.length} transaction${txs.length === 1 ? '' : 's'} (including transfers touching it) and recalculates history.`
        : '';
      if (!window.confirm(`Delete account "${a.name}"?${detail}\n\nThis cannot be undone.`)) return;
      const res = await api.delAccount(a.id);
      showToast(`"${a.name}" deleted${res.deletedTx ? ` — ${res.deletedTx} transactions removed` : ''}`);
      refresh();
    } catch (err) {
      showToast(`Could not delete: ${(err as Error).message}`);
    }
  };

  const spark = () => {
    if (!nw || nw.series.length < 2) return null;
    const pts = nw.series.map(p => p.cents);
    const mn = Math.min(...pts), mx = Math.max(...pts);
    const px = (i: number) => 8 + (i * (150 - 16)) / (pts.length - 1);
    const py = (v: number) => (mx === mn ? 22 : 40 - 6 - ((v - mn) / (mx - mn)) * 26);
    const path = pts.map((v, i) => `${i ? 'L' : 'M'}${px(i)} ${py(v)}`).join(' ');
    return (
      <svg width="150" height="46" role="img" aria-label="Net worth, last 6 months">
        <path d={`${path} L ${px(pts.length - 1)} 40 L 8 40 Z`} fill="var(--accent-wash)" />
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} />
        <circle cx={px(pts.length - 1)} cy={py(pts[pts.length - 1])} r={3.5} fill="var(--accent)" />
        <text x="150" y="12" textAnchor="end" fontSize="10" fill="var(--ink-3)">6 mo</text>
      </svg>
    );
  };

  return (
    <section>
      <div className="topbar">
        <div><h1>Accounts</h1><div className="top-sub">Cash · banks · e-wallets · cards · investments</div></div>
        <div className="spacer" />
        <button className="add-btn" onClick={() => setFormOpen(true)}>＋ New account</button>
      </div>

      <div className="card nw-card">
        <div>
          <div className="stat-label">Net worth</div>
          <div className="stat-value num">{nw ? peso(nw.currentCents) : '…'}</div>
          {nw && (
            <div className="stat-delta">
              <span className={nw.delta30Cents >= 0 ? 'up' : 'down'}>
                {nw.delta30Cents >= 0 ? '↑' : '↓'} {peso(nw.delta30Cents)}
              </span> in the last 30 days
            </div>
          )}
        </div>
        <div className="nw-spark">{spark()}</div>
      </div>

      <div className="card mt">
        {boot.accounts.length === 0 && (
          <div className="empty-note">
            No accounts yet. Add each place your money lives — wallet cash, bank accounts,
            GCash/Maya, credit cards, investment accounts — with its current balance.
          </div>
        )}
        {GROUPS.map(([label, types]) => {
          const rows = boot.accounts.filter(a => types.includes(a.type));
          if (rows.length === 0) return null;
          const sub = rows.reduce((s, a) => s + a.balanceCents, 0);
          return (
            <div className="acct-group" key={label}>
              <h3>{label} · <span className="num">{(sub < 0 ? '−' : '') + peso(sub)}</span></h3>
              {rows.map(a => (
                <div className="acct-row clickable" key={a.id} role="button" tabIndex={0}
                  title="View this account's transactions"
                  onClick={() => viewAccountTx(a)}
                  onKeyDown={e => { if (e.key === 'Enter') viewAccountTx(a); }}>
                  <div className="tx-ico">{TYPE_ICON[a.type]}</div>
                  <div>
                    <div className="acct-name">{a.name}</div>
                    <div className="acct-sub">{a.subtitle || a.type}</div>
                  </div>
                  <div className={`acct-bal num ${a.balanceCents < 0 ? 'neg' : ''}`}>
                    {(a.balanceCents < 0 ? '−' : '') + peso(a.balanceCents)}
                  </div>
                  <span className="acct-go">›</span>
                  <button className="acct-del" title={`Delete ${a.name}`}
                    onClick={e => { e.stopPropagation(); del(a); }}>✕</button>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {formOpen && (
        <div className="overlay open" onClick={e => { if (e.target === e.currentTarget) setFormOpen(false); }}>
          <form className="modal" onSubmit={save}>
            <h2>New account</h2>
            <div className="frow">
              <label className="fld-label">Name</label>
              <input className="inp" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. BPI Checking" autoFocus />
            </div>
            <div className="frow">
              <label className="fld-label">Type</label>
              <select className="inp" value={type} onChange={e => setType(e.target.value)}>
                {TYPE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="frow">
              <label className="fld-label">Notes (optional)</label>
              <input className="inp" value={subtitle} onChange={e => setSubtitle(e.target.value)} placeholder="e.g. payroll account" />
            </div>
            <div className="frow">
              <label className="fld-label">Current balance (₱)</label>
              <input className="inp" value={opening} onChange={e => setOpening(e.target.value)} inputMode="decimal"
                placeholder={type === 'credit' ? 'what you owe, as negative — e.g. -12500' : '0.00'} />
            </div>
            <div className="modal-foot">
              <button type="button" className="ghost-btn" onClick={() => setFormOpen(false)}>Cancel</button>
              <button type="submit" className="save-btn" disabled={!name.trim()}>Add account</button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
