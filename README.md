# Pondo — personal finance tracker

Local-first, single-user finance tracker. Everything runs on your machine; the data
is one SQLite file. Tracks cash, banks, e-wallets (GCash/Maya), credit cards, and
investment balances; expenses, income, transfers, budgets, bills & subscriptions;
with daily / weekly / monthly / annual dashboards.

## Quickstart

```bash
npm install          # once
npm run seed:demo    # optional: 6 months of sample data to explore
npm run dev          # dev mode → http://localhost:5173 (hot reload)
# or
npm start            # build + serve → http://localhost:4177
```

Keyboard: `N` opens quick-add anywhere, `Enter` saves, `Esc` closes.

## Pretty hostname (http://pondo.test)

The server also listens on port 80 (loopback callers only) and proxies to `:4177`.
Add one line to `/etc/hosts` (one-time, needs your password):

```bash
echo "127.0.0.1 pondo.test" | sudo tee -a /etc/hosts
```

Then plain **http://pondo.test** works whenever Pondo is running. We use `.test`
(reserved for local use) — never `.local`, which macOS reserves for Bonjour/mDNS.
If something else grabs port 80, Pondo logs it and keeps working on `:4177`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | API (4177) + Vite dev server (5173) with hot reload |
| `npm start` | Build the UI once and serve everything at `:4177` |
| `npm run seed:demo` | Populate an **empty** database with demo data |
| `npm run db:reset` | Delete the database (fresh start on next boot) |
| `npm run backup` | Copy `data/pondo.db` to `backups/` with a timestamp |
| `npm run typecheck` | TypeScript check for the web app |

## Where your data lives

Everything is in **`data/pondo.db`** (SQLite, WAL mode). The server takes an
**automatic daily backup** to `backups/auto-YYYY-MM-DD.db` (last 14 kept) using
SQLite's native backup API; `npm run backup` still works for manual snapshots.
Restoring = copying a backup over `data/pondo.db`. Set `PONDO_DATA=/some/dir`
to keep the live file elsewhere (e.g. an iCloud/Syncthing folder). You can also
export the full ledger as CSV from the Transactions screen (or
`GET /api/export/transactions.csv`).

Bills marked **autopay** log their expense automatically on the due date and
advance to the next cycle; stale past dues advance without logging.

## Conventions

- Amounts are stored as **integer centavos** — never floats.
- Dates are local `YYYY-MM-DD` strings (no UTC conversion — entries after 8 AM UTC+8 stay on the right day).
- **Transfers** (card payments, wallet top-ups, savings sweeps) move money between
  accounts and are never counted as income or expense — no double counting.
- Credit cards are accounts with negative balances; investments are balance-tracked accounts.

See [DESIGN.md](DESIGN.md) for architecture, schema, and API.
