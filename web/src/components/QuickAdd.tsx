import { useEffect, useRef, useState } from 'react';
import { api, peso, todayStr, type Account, type Category, type Tx } from '../api';

type TxType = 'expense' | 'income' | 'transfer';
const TITLES: Record<TxType, string> = {
  expense: 'Add expense', income: 'Add income', transfer: 'Record transfer',
};

export default function QuickAdd({ accounts, categories, onClose, onSaved, edit }: {
  accounts: Account[];
  categories: Category[];
  onClose: () => void;
  onSaved: (msg: string) => void;
  edit?: Tx | null;
}) {
  const [type, setType] = useState<TxType>(edit?.type ?? 'expense');
  const [amount, setAmount] = useState(edit ? String(edit.amountCents / 100) : '');
  const [catId, setCatId] = useState<number | null>(edit?.categoryId ?? null);
  const [fromId, setFromId] = useState<number | null>(edit?.accountId ?? null);
  const [toId, setToId] = useState<number | null>(edit?.toAccountId ?? null);
  const [note, setNote] = useState(edit?.note ?? '');
  const [date, setDate] = useState(edit?.occurredOn ?? todayStr());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const amtRef = useRef<HTMLInputElement>(null);

  useEffect(() => { amtRef.current?.focus(); }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const cats = categories.filter(c => c.kind === (type === 'income' ? 'income' : 'expense'));
  // favorites (not your accounts) can only be transfer counterparties
  const pickAccounts = type === 'transfer' ? accounts : accounts.filter(a => a.type !== 'external');
  const amountCents = Math.round(parseFloat(amount || '0') * 100);
  const valid = amountCents > 0 && fromId != null
    && (type === 'transfer' ? toId != null && toId !== fromId : catId != null);

  const switchType = (t: TxType) => { setType(t); setCatId(null); setToId(null); };

  const save = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    try {
      const body = {
        type, amountCents,
        categoryId: type === 'transfer' ? undefined : catId!,
        accountId: fromId!,
        toAccountId: type === 'transfer' ? toId! : undefined,
        note: note.trim(), occurredOn: date,
      };
      if (edit) await api.updateTx(edit.id, body);
      else await api.addTx(body);
      const catName = cats.find(c => c.id === catId)?.name;
      onSaved(`${edit ? 'Updated' : 'Saved'} — ${type} of ${peso(amountCents)}${type !== 'transfer' && catName ? ' · ' + catName : ''}`);
    } catch (err) {
      setSaving(false);
      setError(`Could not save: ${(err as Error).message}`);
    }
  };

  const chip = (on: boolean, label: string, onClick: () => void, key: number | string) => (
    <button type="button" key={key} className={`pick ${on ? 'on' : ''}`} onClick={onClick}>{label}</button>
  );

  return (
    <div className="overlay open" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="modal" onSubmit={save} aria-label={edit ? 'Edit transaction' : TITLES[type]}>
        <h2>{edit ? `Edit ${type}` : TITLES[type]}</h2>
        <div className="type-seg">
          {(['expense', 'income', 'transfer'] as TxType[]).map(t => (
            <button type="button" key={t} className={type === t ? 'on' : ''} onClick={() => switchType(t)}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <div className="amt-wrap">
          <span className="peso">₱</span>
          <input id="amt" ref={amtRef} inputMode="decimal" placeholder="0" autoComplete="off"
            aria-label="Amount" value={amount} onChange={e => setAmount(e.target.value)} />
        </div>

        {type !== 'transfer' && (
          <div>
            <p className="fld-label">Category</p>
            <div className="chips">
              {cats.map(c => chip(catId === c.id, `${c.icon} ${c.name}`, () => setCatId(c.id), c.id))}
            </div>
          </div>
        )}

        <div>
          <p className="fld-label">{type === 'transfer' ? 'From account' : type === 'income' ? 'Into account' : 'Account'}</p>
          <div className="chips">
            {pickAccounts.map(a => chip(fromId === a.id, a.type === 'external' ? `⭐ ${a.name}` : a.name, () => {
              setFromId(a.id);
              if (toId === a.id) setToId(null);
            }, a.id))}
          </div>
        </div>

        {type === 'transfer' && (
          <div>
            <p className="fld-label">To account</p>
            <div className="chips">
              {pickAccounts.filter(a => a.id !== fromId)
                .map(a => chip(toId === a.id, a.type === 'external' ? `⭐ ${a.name}` : a.name, () => setToId(a.id), a.id))}
            </div>
          </div>
        )}

        <div className="frow2">
          <input className="inp" placeholder="Note (optional)" value={note} onChange={e => setNote(e.target.value)} />
          <input className="inp date-inp" type="date" value={date} max={todayStr()} onChange={e => setDate(e.target.value)} />
        </div>

        {error && <div className="form-err">{error}</div>}

        <div className="modal-foot">
          <button type="button" className="ghost-btn" onClick={onClose}>Cancel <span className="kbd">Esc</span></button>
          <button type="submit" className="save-btn" disabled={!valid || saving}>
            {saving ? 'Saving…' : <>Save <span className="kbd">↵</span></>}
          </button>
        </div>
      </form>
    </div>
  );
}
