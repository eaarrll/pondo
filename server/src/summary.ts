import { addDays, DOW, MON, MONTHS, monthEnd, parse, short, today, WEEKDAYS } from './dates.js';

export type Period = 'day' | 'week' | 'month' | 'year';

export interface Bucket { label: string; start: string; end: string }

export interface PeriodInfo {
  start: string;
  end: string;
  prevStart: string;
  prevEnd: string;
  title: string;
  sub: string;
  trendLabel: string | null;
  buckets: Bucket[] | null; // null → no trend chart (day view shows the tx list)
}

export function periodInfo(period: Period, ref?: string): PeriodInfo {
  const now = today();
  const refStr = ref || now;
  const d = parse(refStr);
  const y = d.getFullYear();
  const m = d.getMonth();

  if (period === 'day') {
    return {
      start: refStr, end: refStr,
      prevStart: addDays(refStr, -1), prevEnd: addDays(refStr, -1),
      title: refStr === now ? 'Today' : short(refStr) + ', ' + y,
      sub: `${WEEKDAYS[d.getDay()]} · ${short(refStr)}, ${y}`,
      trendLabel: null, buckets: null,
    };
  }

  if (period === 'week') {
    const dow = (d.getDay() + 6) % 7; // Monday = 0
    const start = addDays(refStr, -dow);
    const end = addDays(start, 6);
    const isCurrent = now >= start && now <= end;
    return {
      start, end,
      prevStart: addDays(start, -7), prevEnd: addDays(start, -1),
      title: isCurrent ? 'This Week' : `Week of ${short(start)}`,
      sub: `${short(start)} – ${short(end)}, ${parse(end).getFullYear()}`,
      trendLabel: 'Cashflow · this week by day',
      buckets: DOW.map((label, i) => {
        const day = addDays(start, i);
        return { label, start: day, end: day };
      }),
    };
  }

  if (period === 'month') {
    const start = `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const end = monthEnd(y, m);
    const isCurrent = now >= start && now <= end;
    const lastDay = parse(end).getDate();
    const buckets: Bucket[] = [];
    for (let i = 0; i < 5; i++) {
      const from = 1 + i * 7;
      if (from > lastDay) break;
      const to = Math.min(from + 6, lastDay);
      buckets.push({
        label: `${MON[m]} ${from}–${to}`,
        start: addDays(start, from - 1),
        end: addDays(start, to - 1),
      });
    }
    return {
      start, end,
      prevStart: fmt2(y, m - 1, 1), prevEnd: monthEnd(m === 0 ? y - 1 : y, (m + 11) % 12),
      title: `${MONTHS[m]} ${y}`,
      sub: isCurrent ? `Month to date · ${MON[m]} 1–${parse(now).getDate()}` : `${MON[m]} 1 – ${lastDay}`,
      trendLabel: `Cashflow · ${MONTHS[m]} by week`,
      buckets,
    };
  }

  // year
  const start = `${y}-01-01`;
  const end = `${y}-12-31`;
  const isCurrent = now.slice(0, 4) === String(y);
  return {
    start, end,
    prevStart: `${y - 1}-01-01`, prevEnd: `${y - 1}-12-31`,
    title: String(y),
    sub: isCurrent ? `Year to date · Jan 1 – ${short(now)}` : 'Full year',
    trendLabel: `Cashflow · ${y} by month`,
    buckets: MON.map((label, i) => ({
      label,
      start: `${y}-${String(i + 1).padStart(2, '0')}-01`,
      end: monthEnd(y, i),
    })),
  };
}

function fmt2(y: number, m0: number, day: number): string {
  const d = new Date(y, m0, day);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
