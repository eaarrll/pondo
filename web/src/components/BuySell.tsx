import { useEffect, useState } from 'react';
import { api, peso, shortDate, signedPeso, todayStr, type FlipItem, type FlipsData } from '../api';
import type { ScreenProps } from '../App';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (ym: string) => `${MON[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;

const STATUS: Record<FlipItem['status'], { cls: string; label: string }> = {
  stock: { cls: 'due', label: 'in stock' },
  sold: { cls: 'paid', label: '✓ sold' },
  writeoff: { cls: 'overdue', label: 'written off' },
};

export default function BuySell({ rev, refresh, showToast }: ScreenProps) {
  const [data, setData] = useState<FlipsData | null>(null);
  const [buyOpen, setBuyOpen] = useState(false);
  const [selling, setSelling] = useState<FlipItem | null>(null);

  // buy form
  const [name, setName] = useState('');
  const [qty, setQty] = useState('1');
  const [cost, setCost] = useState('');
  const [otherCost, setOtherCost] = useState('');
  const [buyDate, setBuyDate] = useState(todayStr());
  const [note, setNote] = useState('');

  // sell form
  const [price, setPrice] = useState('');
  const [fees, setFees] = useState('');
  const [saleDate, setSaleDate] = useState(todayStr());

  useEffect(() => { api.flips().then(setData); }, [rev]);

  const cents = (s: string) => Math.round(parseFloat(s || '0') * 100);

  const saveBuy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !(cents(cost) >= 0)) return;
    try {
      await api.addFlip({
        name: name.trim(), qty: Math.max(1, Math.round(+qty || 1)), note: note.trim(),
        buyDate, buyCostCents: cents(cost), otherCostCents: cents(otherCost),
      });
      showToast(`Purchase logged — ${name.trim()}`);
      setBuyOpen(false); setName(''); setQty('1'); setCost(''); setOtherCost(''); setNote('');
      refresh();
    } catch (err) { showToast(`Could not save: ${(err as Error).message}`); }
  };

  const saveSell = async (e: React.FormEvent | null, writeOff = false) => {
    e?.preventDefault();
    if (!selling) return;
    const p = writeOff ? 0 : cents(price);
    if (!writeOff && !(p > 0)) return;
    try {
      await api.sellFlip(selling.id, { salePriceCents: p, saleFeesCents: cents(fees), saleDate });
      showToast(writeOff
        ? `${selling.name} written off — ${peso(selling.costCents)} realized loss`
        : `${selling.name} sold for ${peso(p)}`);
      setSelling(null); setPrice(''); setFees('');
      refresh();
    } catch (err) { showToast(`Could not save: ${(err as Error).message}`); }
  };

  const unsell = async (i: FlipItem) => {
    await api.unsellFlip(i.id);
    showToast(`${i.name} moved back to stock`);
    refresh();
  };

  const del = async (i: FlipItem) => {
    if (!window.confirm(`Delete "${i.name}" and its cash flow from Buy & Sell? This cannot be undone.`)) return;
    await api.delFlip(i.id);
    showToast(`"${i.name}" deleted`);
    refresh();
  };

  if (!data) return null;
  const { summary: s, items, monthly } = data;
  const soldItems = items.filter(i => i.status !== 'stock');
  const avgDays = soldItems.length
    ? Math.round(soldItems.reduce((a, i) => a + i.daysHeld, 0) / soldItems.length) : null;

  return (
    <section>
      <div className="topbar">
        <div>
          <h1>Buy &amp; Sell</h1>
          <div className="top-sub">Side-business flips — per-item profit, stock, and cash flow</div>
        </div>
        <div className="spacer" />
        <button className="add-btn" onClick={() => { setBuyDate(todayStr()); setBuyOpen(true); }}>＋ New purchase</button>
      </div>

      <div className="grid g3">
        <div className="card">
          <div className="stat-label">Cash in (sales)</div>
          <div className="stat-value num">{peso(s.cashInCents)}</div>
          <div className="stat-delta">{s.soldCount} item{s.soldCount === 1 ? '' : 's'} sold</div>
        </div>
        <div className="card">
          <div className="stat-label">Cash out (buys + costs)</div>
          <div className="stat-value num">{peso(s.cashOutCents)}</div>
          <div className="stat-delta">fees, shipping &amp; customs included</div>
        </div>
        <div className="card">
          <div className="stat-label">Net cash flow</div>
          <div className="stat-value num" style={{ color: s.netCents >= 0 ? 'var(--good-text)' : 'var(--crit)' }}>
            {signedPeso(s.netCents)}
          </div>
          <div className="stat-delta">cash position of the side business</div>
        </div>
      </div>
      <div className="grid g3 mt">
        <div className="card">
          <div className="stat-label">Tied up in stock</div>
          <div className="stat-value num">{peso(s.tiedUpCents)}</div>
          <div className="stat-delta">{s.stockCount} unsold item{s.stockCount === 1 ? '' : 's'} at cost</div>
        </div>
        <div className="card">
          <div className="stat-label">Realized profit</div>
          <div className="stat-value num" style={{ color: s.realizedCents >= 0 ? 'var(--good-text)' : 'var(--crit)' }}>
            {signedPeso(s.realizedCents)}
          </div>
          <div className="stat-delta">{s.roiPct != null ? `${s.roiPct.toFixed(1)}% return on sold cost` : 'nothing sold yet'}</div>
        </div>
        <div className="card">
          <div className="stat-label">Avg time to sell</div>
          <div className="stat-value num">{avgDays != null ? `${avgDays}d` : '—'}</div>
          <div className="stat-delta">across sold / written-off items</div>
        </div>
      </div>

      <div className="card mt">
        <div className="h2row"><h2>Items</h2><span className="note">buy → sell, one row per item</span></div>
        <div className="flip-scroll">
          <div className="flip-row flip-head">
            <span /> <span>Item</span> <span className="ra">Cost</span> <span className="ra">Proceeds</span>
            <span className="ra">Profit</span> <span>Status</span> <span />
          </div>
          {items.map(i => (
            <div className="flip-row" key={i.id}>
              <div className="tx-ico">{i.status === 'stock' ? '📦' : i.status === 'sold' ? '🏷️' : '🗑️'}</div>
              <div className="tx-what">
                <div className="tx-title">{i.name}{i.qty > 1 ? ` ×${i.qty}` : ''}</div>
                <div className="tx-meta">
                  bought {shortDate(i.buyDate)}
                  {i.saleDate ? ` · ${i.status === 'writeoff' ? 'written off' : 'sold'} ${shortDate(i.saleDate)}` : ''}
                  {` · ${i.daysHeld}d${i.saleDate ? '' : ' held'}`}
                  {i.note ? ` · ${i.note}` : ''}
                </div>
              </div>
              <div className="ra num">{peso(i.costCents)}{i.otherCostCents > 0 && <div className="tx-meta">incl. {peso(i.otherCostCents)} costs</div>}</div>
              <div className="ra num">{i.proceedsCents != null ? peso(i.proceedsCents) : <span className="tx-meta">—</span>}</div>
              <div className="ra num">
                {i.profitCents != null
                  ? <span className={i.profitCents >= 0 ? 'up' : 'down'}>{signedPeso(i.profitCents)}
                      <div className="tx-meta">{i.costCents > 0 ? `${((i.profitCents / i.costCents) * 100).toFixed(0)}% ROI` : ''}</div>
                    </span>
                  : <span className="tx-meta">—</span>}
              </div>
              <div><span className={`pill ${STATUS[i.status].cls}`}>{STATUS[i.status].label}</span></div>
              <div className="flip-actions">
                {i.status === 'stock'
                  ? <button className="mark-btn" onClick={() => { setSelling(i); setSaleDate(todayStr()); }}>Sell</button>
                  : <button className="mark-btn" title="Undo — back to stock" onClick={() => unsell(i)}>↩</button>}
                <button className="tx-del" title={`Delete ${i.name}`} onClick={() => del(i)}>✕</button>
              </div>
            </div>
          ))}
          {items.length === 0 && (
            <div className="empty-note">No items yet. Log your first purchase — when it sells, profit and ROI are computed automatically.</div>
          )}
        </div>
      </div>

      {monthly.length > 0 && (
        <div className="card mt">
          <div className="h2row"><h2>Monthly cash flow</h2><span className="note">running balance since first purchase</span></div>
          <div className="flip-scroll">
            <div className="month-row month-head">
              <span>Month</span><span className="ra">In</span><span className="ra">Out</span><span className="ra">Net</span><span className="ra">Running</span>
            </div>
            {monthly.map(m => (
              <div className="month-row" key={m.month}>
                <span>{monthLabel(m.month)}</span>
                <span className="ra num">{m.inCents ? peso(m.inCents) : <span className="tx-meta">—</span>}</span>
                <span className="ra num">{m.outCents ? peso(m.outCents) : <span className="tx-meta">—</span>}</span>
                <span className={`ra num ${m.netCents > 0 ? 'up' : m.netCents < 0 ? 'down' : ''}`}>{m.netCents ? signedPeso(m.netCents) : '—'}</span>
                <span className={`ra num ${m.runningCents < 0 ? 'down' : ''}`}>{signedPeso(m.runningCents)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {buyOpen && (
        <div className="overlay open" onClick={e => { if (e.target === e.currentTarget) setBuyOpen(false); }}>
          <form className="modal" onSubmit={saveBuy}>
            <h2>New purchase</h2>
            <div className="frow">
              <label className="fld-label">Item</label>
              <input className="inp" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Wilson Ultra v5" autoFocus />
            </div>
            <div className="frow2">
              <div style={{ flex: 2 }}>
                <label className="fld-label">Total cost (₱)</label>
                <input className="inp" value={cost} onChange={e => setCost(e.target.value)} inputMode="decimal" placeholder="0.00" />
              </div>
              <div style={{ flex: 2 }}>
                <label className="fld-label">Other costs (₱)</label>
                <input className="inp" value={otherCost} onChange={e => setOtherCost(e.target.value)} inputMode="decimal" placeholder="fees, shipping, customs" />
              </div>
              <div style={{ flex: 1 }}>
                <label className="fld-label">Qty</label>
                <input className="inp" value={qty} onChange={e => setQty(e.target.value)} inputMode="numeric" />
              </div>
            </div>
            <div className="frow2">
              <div style={{ flex: 1 }}>
                <label className="fld-label">Bought on</label>
                <input className="inp" type="date" value={buyDate} max={todayStr()} onChange={e => setBuyDate(e.target.value)} />
              </div>
              <div style={{ flex: 2 }}>
                <label className="fld-label">Note (optional)</label>
                <input className="inp" value={note} onChange={e => setNote(e.target.value)} placeholder="supplier, condition…" />
              </div>
            </div>
            <div className="modal-foot">
              <button type="button" className="ghost-btn" onClick={() => setBuyOpen(false)}>Cancel</button>
              <button type="submit" className="save-btn" disabled={!name.trim() || !(parseFloat(cost) >= 0)}>Add purchase</button>
            </div>
          </form>
        </div>
      )}

      {selling && (
        <div className="overlay open" onClick={e => { if (e.target === e.currentTarget) setSelling(null); }}>
          <form className="modal" onSubmit={saveSell}>
            <h2>Sell — {selling.name}</h2>
            <div className="tx-meta" style={{ marginBottom: 14 }}>
              Cost basis {peso(selling.costCents)} · bought {shortDate(selling.buyDate)} · held {selling.daysHeld}d
            </div>
            <div className="frow2">
              <div style={{ flex: 2 }}>
                <label className="fld-label">Sale price (₱)</label>
                <input className="inp" value={price} onChange={e => setPrice(e.target.value)} inputMode="decimal" placeholder="0.00" autoFocus />
              </div>
              <div style={{ flex: 2 }}>
                <label className="fld-label">Fees (₱)</label>
                <input className="inp" value={fees} onChange={e => setFees(e.target.value)} inputMode="decimal" placeholder="platform / shipping" />
              </div>
              <div style={{ flex: 2 }}>
                <label className="fld-label">Sold on</label>
                <input className="inp" type="date" value={saleDate} max={todayStr()} onChange={e => setSaleDate(e.target.value)} />
              </div>
            </div>
            {parseFloat(price) > 0 && (
              <div className="tx-meta" style={{ marginBottom: 12 }}>
                Profit: <b className={cents(price) - cents(fees) - selling.costCents >= 0 ? 'up' : 'down'}>
                  {signedPeso(cents(price) - cents(fees) - selling.costCents)}
                </b>
              </div>
            )}
            <div className="modal-foot">
              <button type="button" className="ghost-btn" onClick={() => setSelling(null)}>Cancel</button>
              <button type="button" className="ghost-btn writeoff-btn" onClick={() => saveSell(null, true)}
                title="Sunk cost — counts as a realized loss">Write off</button>
              <button type="submit" className="save-btn" disabled={!(parseFloat(price) > 0)}>Save sale</button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
