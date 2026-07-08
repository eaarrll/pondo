import { peso, signedPeso, type Tx } from '../api';

export default function TxRow({ tx, onDelete }: { tx: Tx; onDelete?: (tx: Tx) => void }) {
  const isTr = tx.type === 'transfer';
  const isIn = tx.type === 'income';
  const title = tx.note || tx.catName || (isTr ? 'Transfer' : 'Transaction');
  const meta = isTr ? `${tx.acctName} → ${tx.toName}` : `${tx.catName ?? '—'} · ${tx.acctName}`;
  return (
    <div className="tx-row">
      <div className="tx-ico">{isTr ? '⇄' : (tx.catIcon || '🧾')}</div>
      <div className="tx-what">
        <div className="tx-title">{title}</div>
        <div className="tx-meta">{meta}</div>
      </div>
      {isTr && <span className="chip transfer">transfer</span>}
      <div className={`tx-amt num ${isIn ? 'in' : ''}`}>
        {isTr ? peso(tx.amountCents) : signedPeso(isIn ? tx.amountCents : -tx.amountCents)}
      </div>
      {onDelete && (
        <button className="tx-del" title="Delete transaction" onClick={() => onDelete(tx)}>✕</button>
      )}
    </div>
  );
}
