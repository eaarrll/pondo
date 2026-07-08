# Pondo — design document

## Goal & constraints

Personal finance tracker for one user, optimized for **entry speed** (log an expense
in ~3 interactions) and **trustworthy math** (transfers never double-count, money is
integer centavos). Local-first: no cloud, no auth, no telemetry; data is one SQLite
file the owner can copy to back up. Scale target is decades of personal data
(~10⁴–10⁵ transactions) — small enough that every report is computed live with SQL;
no caching layer, no background jobs.

## Architecture

```
┌────────────────────────── your machine ─────────────────────────┐
│                                                                  │
│  Browser (localhost)                                             │
│  React SPA (Vite build)                                          │
│     │  JSON /api/*                                               │
│     ▼                                                            │
│  Fastify server (Node/TypeScript, port 4177)                     │
│     │  Drizzle ORM (CRUD) + prepared SQL (aggregates)            │
│     ▼                                                            │
│  SQLite file  data/pondo.db  (WAL mode)                          │
└──────────────────────────────────────────────────────────────────┘
```

- `server/` — Fastify + better-sqlite3 + Drizzle. Serves the built SPA in prod mode.
- `web/` — React 19 + Vite. Dev mode proxies `/api` to the server.
- Server binds `127.0.0.1` only. LAN/phone access is a deliberate v2 change
  (bind `0.0.0.0` + add a PIN), not an accident waiting to happen.

## Data model

```
accounts       id, name, type(cash|bank|ewallet|credit|investment),
               subtitle, opening_cents, archived, sort
categories     id, name, kind(expense|income), icon, sort     ← seeded defaults
transactions   id, type(expense|income|transfer), amount_cents(>0),
               category_id?, account_id, to_account_id?, note,
               occurred_on(YYYY-MM-DD), created_at
budgets        category_id (unique), monthly_cap_cents         ← standing monthly caps
bills          id, name, amount_cents, frequency(monthly|quarterly|annual),
               next_due, account_id?, category_id?, autopay, active
bill_payments  bill_id, transaction_id, paid_on, amount_cents  ← audit trail
```

Key decisions:

- **Sign lives in `type`, not the amount.** `amount_cents` is always positive;
  expense subtracts, income adds, transfer moves (`account_id` → `to_account_id`).
  This is "double-entry-lite": one row per event, but transfers touch two balances
  and net to zero — so card payments, GCash top-ups, and savings sweeps never
  inflate income or expenses.
- **Balances are derived, never stored**: `opening_cents + Σ signed flows`.
  No drift, no reconciliation bugs; recomputing is microseconds at this scale.
- **Net worth** = Σ openings + Σ income − Σ expenses (transfers cancel out).
  Credit-card spending correctly reduces net worth when spent, not when the
  statement is paid.
- **Bills advance on payment**: paying writes the expense + a `bill_payments` row,
  then moves `next_due` forward by the frequency. Status (overdue / due ≤14d /
  upcoming / auto) is computed, not stored.
- **Budgets are standing monthly caps** (not per-month rows). Month-specific
  overrides are a v2 concern if ever needed.

## API (JSON over HTTP)

| Endpoint | Purpose |
|---|---|
| `GET /api/bootstrap` | accounts (with computed balances) + categories |
| `GET /api/summary?period=day\|week\|month\|year` | in/out/net, prior-period comparison, category breakdown, trend buckets |
| `GET/POST/DELETE /api/transactions` | ledger CRUD (validated: transfer needs distinct target, etc.) |
| `POST/PATCH /api/accounts` | create / edit / archive |
| `GET/PUT /api/budgets` | caps + month-to-date spend per category |
| `GET/POST/PATCH /api/bills`, `POST /api/bills/:id/pay` | recurring bills; pay = log expense + advance due date |
| `GET /api/networth` | current, 30-day delta, 6-month series |

Period math (server-side, `summary.ts`): weeks start Monday; month trend buckets by
7-day chunks; year by month; the day view has no trend (the UI shows that day's
transactions instead). Every period also computes the previous period for deltas.

## Conventions that prevent classic money bugs

1. **Integer centavos** everywhere; formatting happens only at the UI edge.
2. **Local dates as text** (`YYYY-MM-DD`), compared lexicographically.
   `toISOString()` is banned for date-only values — it would shift evening
   entries (UTC+8) to the previous day.
3. **Deletes recalculate** — since balances are derived, deleting a transaction
   is safe; linked `bill_payments` rows are removed with it.

## Trade-offs accepted

- **No auth** — OS login is the boundary (localhost-only). Revisit at LAN access.
- **Live SQL over materialized summaries** — right up to ~10⁶ rows; revisit never, probably.
- **Investment accounts are balance-tracked** — lot/price tracking is v2; edit the
  balance via an adjustment income/expense or opening-balance change for now.
- **Single currency (PHP)** — multi-currency would touch every table and report; deferred.

## Roadmap (v2+)

1. CSV/statement import with mapping + dedup (bank/e-wallet exports)
2. LAN access for phone quick-add (bind + PIN)
3. Auto-log autopay bills on their due date
4. Investment holdings (tickers, units, price snapshots) and net-worth attribution
5. Savings goals; category rules; search
