import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// Money is always integer centavos. Dates are local 'YYYY-MM-DD' text.

export const accounts = sqliteTable('accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  type: text('type').notNull(), // cash | bank | ewallet | credit | investment
  subtitle: text('subtitle').notNull().default(''),
  openingCents: integer('opening_cents').notNull().default(0),
  archived: integer('archived').notNull().default(0),
  sort: integer('sort').notNull().default(0),
});

export const categories = sqliteTable('categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  kind: text('kind').notNull(), // expense | income
  icon: text('icon').notNull().default(''),
  sort: integer('sort').notNull().default(0),
});

export const transactions = sqliteTable('transactions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type').notNull(), // expense | income | transfer
  amountCents: integer('amount_cents').notNull(), // always positive; sign comes from type
  categoryId: integer('category_id'), // null for transfers
  accountId: integer('account_id').notNull(), // source account (receiving account for income)
  toAccountId: integer('to_account_id'), // transfer destination only
  note: text('note').notNull().default(''),
  occurredOn: text('occurred_on').notNull(),
  createdAt: text('created_at').notNull(),
});

export const budgets = sqliteTable('budgets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  categoryId: integer('category_id').notNull().unique(),
  monthlyCapCents: integer('monthly_cap_cents').notNull(),
});

export const bills = sqliteTable('bills', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  amountCents: integer('amount_cents').notNull(),
  frequency: text('frequency').notNull(), // monthly | quarterly | annual
  nextDue: text('next_due').notNull(),
  accountId: integer('account_id'),
  categoryId: integer('category_id'),
  autopay: integer('autopay').notNull().default(0),
  active: integer('active').notNull().default(1),
});

export const billPayments = sqliteTable('bill_payments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  billId: integer('bill_id').notNull(),
  transactionId: integer('transaction_id'),
  paidOn: text('paid_on').notNull(),
  amountCents: integer('amount_cents').notNull(),
});

// Buy & sell side-business: one row per item, buy → sell lifecycle.
// Sold = sale_date set; written off = sold with sale_price_cents = 0.
// kind 'cost' = operational expense (customs, supplies) — cash out with nothing to sell.
export const flips = sqliteTable('flips', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  kind: text('kind').notNull().default('item'), // item | cost
  name: text('name').notNull(),
  qty: integer('qty').notNull().default(1),
  note: text('note').notNull().default(''),
  buyDate: text('buy_date').notNull(),
  buyCostCents: integer('buy_cost_cents').notNull(),
  otherCostCents: integer('other_cost_cents').notNull().default(0), // fees, shipping, customs
  saleDate: text('sale_date'),
  salePriceCents: integer('sale_price_cents'),
  saleFeesCents: integer('sale_fees_cents').notNull().default(0),
  // optional ledger links: the expense/income rows this flip created
  buyTxId: integer('buy_tx_id'),
  saleTxId: integer('sale_tx_id'),
});
