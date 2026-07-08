// All dates are local-time 'YYYY-MM-DD' strings. Never use toISOString()
// for date-only values — it shifts to UTC and breaks evening entries in UTC+8.

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const fmt = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const parse = (s: string): Date =>
  new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));

export const today = (): string => fmt(new Date());

export function addDays(s: string, n: number): string {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return fmt(d);
}

export function addMonths(s: string, n: number): string {
  const d = parse(s);
  const day = d.getDate();
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(day, last));
  return fmt(t);
}

export const monthEnd = (year: number, month0: number): string =>
  fmt(new Date(year, month0 + 1, 0));

export const short = (s: string): string => `${MON[parse(s).getMonth()]} ${parse(s).getDate()}`;
