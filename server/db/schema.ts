import { relations } from 'drizzle-orm'
import {
  bigint,
  boolean,
  date,
  foreignKey,
  index,
  int,
  json,
  mysqlTable,
  serial,
  text,
  timestamp,
  tinyint,
  uniqueIndex,
  varchar
} from 'drizzle-orm/mysql-core'

const id = () => serial('id').primaryKey()
const fk = (name: string) => bigint(name, { mode: 'number', unsigned: true })
const cents = (name: string) => bigint(name, { mode: 'number', unsigned: true }).notNull()
const timestamps = {
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow()
}

export const users = mysqlTable('users', {
  id: id(),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  password: varchar('password', { length: 255 }).notNull(),
  emailVerifiedAt: timestamp('email_verified_at'),
  isCardOwner: boolean('is_card_owner').notNull().default(false),
  ...timestamps
})

export const recurringBills = mysqlTable('recurring_bills', {
  id: id(),
  createdBy: fk('created_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 20 }).$type<'bill' | 'reimbursement'>().notNull().default('bill'),
  otherUserId: fk('other_user_id').references(() => users.id, { onDelete: 'set null' }),
  name: varchar('name', { length: 255 }).notNull(),
  amountCents: cents('amount_cents'),
  dayOfMonth: tinyint('day_of_month', { unsigned: true }).notNull(),
  sortOrder: int('sort_order', { unsigned: true }).notNull().default(0),
  active: boolean('active').notNull().default(true),
  ...timestamps
}, t => [index('recurring_bills_day_sort_idx').on(t.dayOfMonth, t.sortOrder)])

export const recurringBillParticipants = mysqlTable('recurring_bill_participants', {
  id: id(),
  recurringBillId: fk('recurring_bill_id').notNull(),
  userId: fk('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  amountCents: cents('amount_cents'),
  ...timestamps
}, t => [
  uniqueIndex('recurring_bill_participants_unique').on(t.recurringBillId, t.userId),
  // Named by hand: the generated name is over MySQL's 64 character limit.
  foreignKey({ name: 'rbp_recurring_bill_id_fk', columns: [t.recurringBillId], foreignColumns: [recurringBills.id] }).onDelete('cascade')
])

export const bills = mysqlTable('bills', {
  id: id(),
  recurringBillId: fk('recurring_bill_id').references(() => recurringBills.id, { onDelete: 'set null' }),
  createdBy: fk('created_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  amountCents: cents('amount_cents'),
  addedOn: date('added_on', { mode: 'string' }).notNull(),
  cardPaidAt: timestamp('card_paid_at'),
  /** Paid by check from the shared account: the shares still get paid, but nothing goes on the Citi card. */
  paidByCheck: boolean('paid_by_check').notNull().default(false),
  ...timestamps
}, t => [
  index('bills_added_on_idx').on(t.addedOn),
  index('bills_recurring_added_idx').on(t.recurringBillId, t.addedOn)
])

export const billParticipants = mysqlTable('bill_participants', {
  id: id(),
  billId: fk('bill_id').notNull().references(() => bills.id, { onDelete: 'cascade' }),
  userId: fk('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  amountCents: cents('amount_cents'),
  paidAt: timestamp('paid_at'),
  ...timestamps
}, t => [uniqueIndex('bill_participants_unique').on(t.billId, t.userId)])

/** Money a store put back on the card for a bill; becomes credit later bills use up a bite at a time. */
export const refunds = mysqlTable('refunds', {
  id: id(),
  billId: fk('bill_id').notNull().references(() => bills.id, { onDelete: 'cascade' }),
  amountCents: cents('amount_cents'),
  refundedOn: date('refunded_on', { mode: 'string' }).notNull(),
  createdBy: fk('created_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
  ...timestamps
}, t => [index('refunds_bill_idx').on(t.billId)])

export const refundShares = mysqlTable('refund_shares', {
  id: id(),
  refundId: fk('refund_id').notNull().references(() => refunds.id, { onDelete: 'cascade' }),
  userId: fk('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  amountCents: cents('amount_cents'),
  ...timestamps
}, t => [uniqueIndex('refund_shares_unique').on(t.refundId, t.userId)])

/** One person's piece of a refund credit that a bill used. The bill's card reduction is the sum of its pieces. */
export const creditUses = mysqlTable('credit_uses', {
  id: id(),
  refundId: fk('refund_id').notNull().references(() => refunds.id, { onDelete: 'cascade' }),
  billId: fk('bill_id').notNull().references(() => bills.id, { onDelete: 'cascade' }),
  userId: fk('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  amountCents: cents('amount_cents'),
  ...timestamps
}, t => [
  uniqueIndex('credit_uses_unique').on(t.refundId, t.billId, t.userId),
  index('credit_uses_bill_idx').on(t.billId)
])

export const reimbursements = mysqlTable('reimbursements', {
  id: id(),
  recurringBillId: fk('recurring_bill_id').references(() => recurringBills.id, { onDelete: 'set null' }),
  createdBy: fk('created_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
  otherUserId: fk('other_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  owedCents: cents('owed_cents'),
  notes: text('notes'),
  transferCompletedAt: timestamp('transfer_completed_at'),
  completedAt: timestamp('completed_at'),
  ...timestamps
}, t => [
  index('reimbursements_completed_idx').on(t.completedAt),
  index('reimbursements_recurring_created_idx').on(t.recurringBillId, t.createdAt)
])

/** Login codes, password resets and email-change verifications. Only hashes are stored. */
export const authTokens = mysqlTable('auth_tokens', {
  id: id(),
  userId: fk('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 20 }).$type<'login_code' | 'password_reset' | 'email_change'>().notNull(),
  tokenHash: varchar('token_hash', { length: 64 }).notNull(),
  meta: varchar('meta', { length: 255 }),
  attempts: int('attempts').notNull().default(0),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow()
}, t => [index('auth_tokens_user_type_idx').on(t.userId, t.type)])

export const trustedDevices = mysqlTable('trusted_devices', {
  id: id(),
  userId: fk('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  userAgent: varchar('user_agent', { length: 255 }),
  lastUsedAt: timestamp('last_used_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow()
})

/** Household-wide settings, one JSON value per key. */
export const settings = mysqlTable('settings', {
  key: varchar('key', { length: 64 }).primaryKey(),
  value: json('value').notNull(),
  ...timestamps
})

export const billsRelations = relations(bills, ({ many }) => ({
  participants: many(billParticipants),
  refunds: many(refunds),
  creditUses: many(creditUses)
}))
export const refundsRelations = relations(refunds, ({ one, many }) => ({
  bill: one(bills, { fields: [refunds.billId], references: [bills.id] }),
  shares: many(refundShares),
  uses: many(creditUses)
}))
export const creditUsesRelations = relations(creditUses, ({ one }) => ({
  refund: one(refunds, { fields: [creditUses.refundId], references: [refunds.id] }),
  bill: one(bills, { fields: [creditUses.billId], references: [bills.id] })
}))
export const refundSharesRelations = relations(refundShares, ({ one }) => ({
  refund: one(refunds, { fields: [refundShares.refundId], references: [refunds.id] })
}))
export const billParticipantsRelations = relations(billParticipants, ({ one }) => ({
  bill: one(bills, { fields: [billParticipants.billId], references: [bills.id] })
}))
export const recurringBillsRelations = relations(recurringBills, ({ many }) => ({
  participants: many(recurringBillParticipants)
}))
export const recurringBillParticipantsRelations = relations(recurringBillParticipants, ({ one }) => ({
  recurringBill: one(recurringBills, { fields: [recurringBillParticipants.recurringBillId], references: [recurringBills.id] })
}))
