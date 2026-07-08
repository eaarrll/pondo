import { useState } from 'react';
import { peso, type Summary } from '../api';

type Trend = NonNullable<Summary['trend']>;

const W = 560, H = 210, PAD_L = 46, PAD_B = 26, PAD_T = 10;

export default function TrendChart({ trend }: { trend: Trend }) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);

  const maxV = Math.max(1, ...trend.buckets.flatMap(b => [b.inCents, b.outCents]));
  const band = (W - PAD_L - 8) / trend.buckets.length;
  const bw = Math.min(22, band * 0.28);
  const y = (v: number) => PAD_T + (H - PAD_B - PAD_T) * (1 - v / maxV);
  const kLabel = (v: number) => (v >= 100_000 ? Math.round(v / 100_000) + 'k' : String(Math.round(v / 100)));

  return (
    <div className="trend-wrap">
      <div className="legend">
        <span><i style={{ background: 'var(--in)' }} />In</span>
        <span><i style={{ background: 'var(--out)' }} />Out</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="trend-svg" role="img" aria-label={trend.label}
        onMouseLeave={() => setTip(null)}>
        {[0, 1, 2].map(i => {
          const v = (maxV / 2) * i;
          return (
            <g key={i}>
              <line x1={PAD_L} x2={W - 4} y1={y(v)} y2={y(v)} stroke="var(--grid)" strokeWidth={1} />
              <text x={PAD_L - 8} y={y(v) + 4} textAnchor="end" fontSize={10.5} fill="var(--ink-3)">{kLabel(v)}</text>
            </g>
          );
        })}
        {trend.buckets.map((b, i) => {
          const cx = PAD_L + band * i + band / 2;
          const bars: [number, string, string][] = [[b.inCents, 'var(--in)', 'In'], [b.outCents, 'var(--out)', 'Out']];
          return (
            <g key={b.label}>
              {bars.map(([v, col, nm], j) => {
                const bx = cx - bw - 1 + j * (bw + 2);
                const show = (e: React.MouseEvent) =>
                  setTip({ x: e.clientX, y: e.clientY, text: `${b.label} · ${nm}: ${peso(v)}` });
                return v > 0
                  ? <rect key={nm} x={bx} y={y(v)} width={bw} height={Math.max(2, H - PAD_B - y(v))} rx={3}
                      fill={col} onMouseMove={show} />
                  : <rect key={nm} x={bx} y={H - PAD_B - 2} width={bw} height={2} rx={1}
                      fill="var(--grid)" onMouseMove={show} />;
              })}
              <text x={cx} y={H - 8} textAnchor="middle" fontSize={10.5} fill="var(--ink-3)">{b.label}</text>
            </g>
          );
        })}
        <line x1={PAD_L} x2={W - 4} y1={H - PAD_B} y2={H - PAD_B} stroke="var(--hairline)" strokeWidth={1} />
      </svg>
      {tip && <div className="chart-tip show" style={{ left: tip.x + 12, top: tip.y - 30 }}>{tip.text}</div>}
    </div>
  );
}
