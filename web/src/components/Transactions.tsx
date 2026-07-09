import { useEffect, useState } from 'react';
import { api, dateLabel, peso, type Account, type Tx } from '../api';
import TxRow from './TxRow';
import type { ScreenProps } from '../App';

const FILTERS = [
  ['all', 'All'], ['expense', 'Expenses'], ['income', 'Income'], ['transfer', 'Transfers'],
] as const;

export default function Transactions({ rev, refresh, showToast, openAdd, account, onClearAccount }:
  ScreenProps & { account: Account | null; onClearAccount: () => void }) {
  const [filter, setFilter] = useState<string>('all');
  const [txs, setTxs] = useState<Tx[]>([]);

  useEffect(() => {
    const q = '?limit=300'
      + (filter !== 'all' ? `&type=${filter}` : '')
      + (account ? `&accountId=${account.id}` : '');
    api.transactions(q).then(setTxs);
  }, [filter, rev, account]);

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

  let lastDate = '';
  return (
    <section>
      <div className="topbar">
        <div>
          <h1>{account ? account.name : 'Transactions'}</h1>
          <div className="top-sub">
            {account
              ? `All activity on this account · balance ${(account.balanceCents < 0 ? '−' : '') + peso(account.balanceCents)}`
              : 'Every peso in and out — transfers never double-count'}
          </div>
        </div>
        <div className="spacer" />
        <button className="add-btn" onClick={openAdd}>＋ Add <span className="kbd">N</span></button>
      </div>
      <div className="filters">
        {FILTERS.map(([id, label]) => (
          <button key={id} className={`fchip ${filter === id ? 'on' : ''}`} onClick={() => setFilter(id)}>{label}</button>
        ))}
        {account && (
          <button className="fchip acct-chip" onClick={onClearAccount} title="Show all accounts">
            ▤ {account.name} ✕
          </button>
        )}
      </div>
      <div className="card">
        {txs.map(t => {
          const header = t.occurredOn !== lastDate ? <div className="tx-group">{dateLabel(t.occurredOn)}</div> : null;
          lastDate = t.occurredOn;
          return <div key={t.id}>{header}<TxRow tx={t} onDelete={del} /></div>;
        })}
        {txs.length === 0 && (
          <div className="empty-note">
            {account ? 'No transactions on this account yet.' : <>No transactions yet. Press <span className="kbd">N</span> to log one.</>}
          </div>
        )}
      </div>
    </section>
  );
}
