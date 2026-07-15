import { useEffect, useState } from 'react';
import { api, peso, shortDate, todayStr, type Bill } from '../api';
import type { ScreenProps } from '../App';

const ORDER: Record<Bill['status'], number> = { overdue: 0, due: 1, upcoming: 2, auto: 3 };
const monOf = (s: string) => shortDate(s).split(' ')[0];

export default function Bills({ boot, rev, refresh, showToast }: ScreenProps) {
  const [billsList, setBills] = useState<Bill[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [freq, setFreq] = useState('monthly');
  const [nextDue, setNextDue] = useState(todayStr());
  const [acctId, setAcctId] = useState('');
  const [catId, setCatId] = useState('');
  const [autopay, setAutopay] = useState(false);

  useEffect(() => { api.bills().then(setBills); }, [rev]);

  const pay = async (b: Bill) => {
    try {
      await api.payBill(b.id);
      showToast(`${b.name} paid — logged ${peso(b.amountCents)} from ${b.acctName ?? 'account'}`);
      refresh();
    } catch (err) {
      showToast(`Could not pay ${b.name}: ${(err as Error).message}`);
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const amountCents = Math.round(parseFloat(amount || '0') * 100);
    if (!name.trim() || amountCents <= 0) return;
    try {
      await api.addBill({
        name: name.trim(), amountCents, frequency: freq, nextDue,
        accountId: acctId ? +acctId : undefined,
        categoryId: catId ? +catId : undefined,
        autopay,
      });
      showToast(`Bill "${name.trim()}" added`);
      setFormOpen(false); setName(''); setAmount(''); setAutopay(false);
      refresh();
    } catch (err) {
      showToast(`Could not add bill: ${(err as Error).message}`);
    }
  };

  const thisMonth = todayStr().slice(0, 7);
  const dueThisMonth = billsList
    .filter(b => b.nextDue.slice(0, 7) === thisMonth)
    .reduce((s, b) => s + b.amountCents, 0);

  const sorted = [...billsList].sort(
    (a, b) => ORDER[a.status] - ORDER[b.status] || a.nextDue.localeCompare(b.nextDue),
  );
  const expenseCats = boot.categories.filter(c => c.kind === 'expense');

  return (
    <section>
      <div className="topbar">
        <div>
          <h1>Bills &amp; Subscriptions</h1>
          <div className="top-sub">{dueThisMonth > 0 ? `${peso(dueThisMonth)} still due this month` : 'Nothing left due this month'}</div>
        </div>
        <div className="spacer" />
        <button className="add-btn" onClick={() => setFormOpen(true)}>＋ New bill</button>
      </div>

      <div className="card">
        {sorted.length === 0 && (
          <div className="empty-note">
            No bills yet. Add recurring payments — utilities, rent, subscriptions, insurance —
            and Pondo will track due dates and log the expense when you mark them paid.
          </div>
        )}
        {sorted.map(b => (
          <div className="bill-row" key={b.id}>
            <div className="bill-when"><div className="d num">{+b.nextDue.slice(8, 10)}</div><div className="m">{monOf(b.nextDue)}</div></div>
            <div>
              <div className="bill-name">{b.name}</div>
              <div className="bill-sub">
                {b.frequency}{b.acctName ? ` · ${b.acctName}` : ''}
                {b.paidThisMonth && b.lastPaid ? ` · paid ${shortDate(b.lastPaid)}` : ''}
              </div>
            </div>
            <div className="bill-right">
              <span className="bill-amt num">{peso(b.amountCents)}</span>
              {b.paidThisMonth && b.status !== 'overdue'
                ? <span className="pill paid">✓ paid</span>
                : <span className={`pill ${b.status === 'upcoming' ? 'auto' : b.status}`}>
                    {b.status === 'overdue' ? '⚠ overdue'
                      : b.status === 'due' ? `due ${shortDate(b.nextDue)}`
                      : b.status === 'auto' ? 'auto' : shortDate(b.nextDue)}
                  </span>}
              {(b.status === 'due' || b.status === 'overdue') && (
                <button className="mark-btn" onClick={() => pay(b)}>Mark paid</button>
              )}
            </div>
          </div>
        ))}
      </div>

      {formOpen && (
        <div className="overlay open" onClick={e => { if (e.target === e.currentTarget) setFormOpen(false); }}>
          <form className="modal" onSubmit={save}>
            <h2>New bill or subscription</h2>
            <div className="frow">
              <label className="fld-label">Name</label>
              <input className="inp" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Meralco" autoFocus />
            </div>
            <div className="frow2">
              <div style={{ flex: 1 }}>
                <label className="fld-label">Amount (₱)</label>
                <input className="inp" value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" />
              </div>
              <div style={{ flex: 1 }}>
                <label className="fld-label">Frequency</label>
                <select className="inp" value={freq} onChange={e => setFreq(e.target.value)}>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="annual">Annual</option>
                </select>
              </div>
            </div>
            <div className="frow">
              <label className="fld-label">Next due date</label>
              <input className="inp" type="date" value={nextDue} onChange={e => setNextDue(e.target.value)} />
            </div>
            <div className="frow2">
              <div style={{ flex: 1 }}>
                <label className="fld-label">Pay from</label>
                <select className="inp" value={acctId} onChange={e => setAcctId(e.target.value)}>
                  <option value="">— choose account —</option>
                  {boot.accounts.filter(a => a.type !== 'external').map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label className="fld-label">Category</label>
                <select className="inp" value={catId} onChange={e => setCatId(e.target.value)}>
                  <option value="">— choose category —</option>
                  {expenseCats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <label className="check">
              <input type="checkbox" checked={autopay} onChange={e => setAutopay(e.target.checked)} />
              Auto-charged (no reminder needed, shows as “auto”)
            </label>
            <div className="modal-foot">
              <button type="button" className="ghost-btn" onClick={() => setFormOpen(false)}>Cancel</button>
              <button type="submit" className="save-btn" disabled={!name.trim() || !(parseFloat(amount) > 0)}>Add bill</button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
