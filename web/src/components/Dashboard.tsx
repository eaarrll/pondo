import { useEffect, useState } from 'react';
import { api, peso, shortDate, signedPeso, type Bill, type Period, type Summary, type Tx } from '../api';
import TrendChart from './TrendChart';
import TxRow from './TxRow';
import type { ScreenProps } from '../App';

const PERIODS: Period[] = ['day', 'week', 'month', 'year'];
const PERIOD_NOTE: Record<Period, string> = { day: 'today', week: 'this week', month: 'this month', year: 'year to date' };
const monOf = (s: string) => shortDate(s).split(' ')[0];
const TYPE_ICON: Record<string, string> = {
  cash: '💵', bank: '🏦', ewallet: '📱', credit: '💳', investment: '📈', external: '⭐',
};

export default function Dashboard({ boot, rev, openAdd, onNav, viewAccountTx }: ScreenProps) {
  const [period, setPeriod] = useState<Period>('month');
  const [sum, setSum] = useState<Summary | null>(null);
  const [recent, setRecent] = useState<Tx[]>([]);
  const [dayTxs, setDayTxs] = useState<Tx[]>([]);
  const [upcoming, setUpcoming] = useState<Bill[]>([]);

  useEffect(() => {
    api.summary(period).then(s => {
      setSum(s);
      if (!s.trend) {
        api.transactions('?limit=100').then(t => setDayTxs(t.filter(x => x.occurredOn === s.start)));
      }
    });
  }, [period, rev]);

  useEffect(() => {
    api.transactions('?limit=5').then(setRecent);
    api.bills().then(b => setUpcoming(b.filter(x => x.status === 'due' || x.status === 'overdue').slice(0, 4)));
  }, [rev]);

  if (!sum) return null;

  const delta = (cur: number, prev: number, goodWhenUp: boolean) => {
    if (!prev) return <span className="tx-meta">no prior data</span>;
    const pct = ((cur - prev) / prev) * 100;
    const up = pct >= 0;
    return (
      <span>
        <span className={up === goodWhenUp ? 'up' : 'down'}>{up ? '↑' : '↓'} {Math.abs(pct).toFixed(1)}%</span> vs prior
      </span>
    );
  };

  const maxCat = Math.max(1, ...sum.cats.map(c => c.cents));

  return (
    <section>
      <div className="topbar">
        <div>
          <h1>{sum.title}</h1>
          <div className="top-sub">{sum.sub}</div>
        </div>
        <div className="spacer" />
        <div className="seg">
          {PERIODS.map(p => (
            <button key={p} className={p === period ? 'on' : ''} onClick={() => setPeriod(p)}>
              {p[0].toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
        <button className="add-btn" onClick={openAdd}>＋ Add <span className="kbd">N</span></button>
      </div>

      <div className="grid g3">
        <div className="card">
          <div className="stat-label">Money in</div>
          <div className="stat-value num">{peso(sum.inCents)}</div>
          <div className="stat-delta">{delta(sum.inCents, sum.prev.inCents, true)}</div>
        </div>
        <div className="card">
          <div className="stat-label">Money out</div>
          <div className="stat-value num">{peso(sum.outCents)}</div>
          <div className="stat-delta">{delta(sum.outCents, sum.prev.outCents, false)}</div>
        </div>
        <div className="card">
          <div className="stat-label">Net</div>
          <div className="stat-value num" style={{ color: sum.netCents >= 0 ? 'var(--good-text)' : 'var(--crit)' }}>
            {signedPeso(sum.netCents)}
          </div>
          <div className="stat-delta">
            {sum.inCents > 0 ? `${((sum.netCents / sum.inCents) * 100).toFixed(1)}% of income kept` : ' '}
          </div>
        </div>
      </div>

      <div className="grid g2 mt">
        <div className="card">
          <div className="h2row">
            <h2>{sum.trend ? sum.trend.label : "Today's transactions"}</h2>
            {sum.trend && <span className="note">hover for values</span>}
          </div>
          {sum.trend
            ? <TrendChart trend={sum.trend} />
            : dayTxs.length
              ? dayTxs.map(t => <TxRow key={t.id} tx={t} />)
              : <div className="empty-note">Nothing logged yet today. Press <span className="kbd">N</span> to add.</div>}
        </div>
        <div className="card">
          <div className="h2row"><h2>Spend by category</h2><span className="note">{PERIOD_NOTE[period]}</span></div>
          {sum.cats.length === 0 && <div className="empty-note">No expenses in this period.</div>}
          {sum.cats.map(c => (
            <div className="cat-row" key={c.name}>
              <span className="cat-name">{c.icon} {c.name}</span>
              <span className="cat-track">
                <span className="cat-fill" style={{ width: `${Math.max(2, (c.cents / maxCat) * 100)}%` }} />
              </span>
              <span className="cat-amt num">{peso(c.cents)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid g2 mt">
        <div className="card">
          <div className="h2row"><h2>Account balances</h2><button className="theme-btn" onClick={() => onNav('accts')}>Manage →</button></div>
          {boot.accounts.filter(a => a.type !== 'external').map(a => (
            <button key={a.id} className="dash-acct" title={`View ${a.name} transactions`}
              onClick={() => viewAccountTx(a)}>
              <span className="dash-acct-ico">{TYPE_ICON[a.type]}</span>
              <span className="dash-acct-name">{a.name}</span>
              <span className={`num dash-acct-bal ${a.balanceCents < 0 ? 'down' : 'up'}`}>
                {(a.balanceCents < 0 ? '−' : '+') + peso(a.balanceCents)}
              </span>
            </button>
          ))}
          {boot.accounts.filter(a => a.type !== 'external').length === 0 && (
            <div className="empty-note">No accounts yet — set them up first.</div>
          )}
          <div className="dash-nw">
            <span>Net worth</span>
            <span className="num">
              {(() => {
                const nw = boot.accounts.filter(a => a.type !== 'external')
                  .reduce((s, a) => s + a.balanceCents, 0);
                return (nw < 0 ? '−' : '') + peso(nw);
              })()}
            </span>
          </div>
        </div>
        <div className="card">
          <div className="h2row"><h2>Coming up</h2><button className="theme-btn" onClick={() => onNav('bills')}>All bills →</button></div>
          {upcoming.map(b => (
            <div className="bill-row" key={b.id}>
              <div className="bill-when"><div className="d num">{+b.nextDue.slice(8, 10)}</div><div className="m">{monOf(b.nextDue)}</div></div>
              <div><div className="bill-name">{b.name}</div><div className="bill-sub">{b.status === 'overdue' ? 'overdue' : `due ${shortDate(b.nextDue)}`}</div></div>
              <div className="bill-right">
                <span className="bill-amt num">{peso(b.amountCents)}</span>
                <span className={`pill ${b.status}`}>{b.status === 'overdue' ? '⚠ overdue' : 'due'}</span>
              </div>
            </div>
          ))}
          {upcoming.length === 0 && <div className="empty-note">Nothing due in the next two weeks.</div>}
        </div>
      </div>

      <div className="card mt">
        <div className="h2row"><h2>Recent transactions</h2><button className="theme-btn" onClick={() => onNav('tx')}>View all →</button></div>
        {recent.map(t => <TxRow key={t.id} tx={t} />)}
        {recent.length === 0 && <div className="empty-note">Nothing yet — press <span className="kbd">N</span> to log your first transaction.</div>}
      </div>
    </section>
  );
}
