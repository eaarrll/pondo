import { useEffect, useState } from 'react';
import { api, dateLabel, type Tx } from '../api';
import TxRow from './TxRow';
import type { ScreenProps } from '../App';

const FILTERS = [
  ['all', 'All'], ['expense', 'Expenses'], ['income', 'Income'], ['transfer', 'Transfers'],
] as const;

export default function Transactions({ rev, refresh, showToast, openAdd }: ScreenProps) {
  const [filter, setFilter] = useState<string>('all');
  const [txs, setTxs] = useState<Tx[]>([]);

  useEffect(() => {
    api.transactions(filter === 'all' ? '?limit=300' : `?limit=300&type=${filter}`).then(setTxs);
  }, [filter, rev]);

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
        <div><h1>Transactions</h1><div className="top-sub">Every peso in and out — transfers never double-count</div></div>
        <div className="spacer" />
        <button className="add-btn" onClick={openAdd}>＋ Add <span className="kbd">N</span></button>
      </div>
      <div className="filters">
        {FILTERS.map(([id, label]) => (
          <button key={id} className={`fchip ${filter === id ? 'on' : ''}`} onClick={() => setFilter(id)}>{label}</button>
        ))}
      </div>
      <div className="card">
        {txs.map(t => {
          const header = t.occurredOn !== lastDate ? <div className="tx-group">{dateLabel(t.occurredOn)}</div> : null;
          lastDate = t.occurredOn;
          return <div key={t.id}>{header}<TxRow tx={t} onDelete={del} /></div>;
        })}
        {txs.length === 0 && <div className="empty-note">No transactions yet. Press <span className="kbd">N</span> to log one.</div>}
      </div>
    </section>
  );
}
