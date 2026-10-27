# Running Refund Credit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refund credits are used up a bite at a time by later shared-card bills, with a running counter, Paid Directly exclusions, a refunded-bill lock, an admin delete with a spelled-out settlement, and a Check toggle replacing the personal-card option.

**Architecture:** One pure function sizes a bite (`sizeBite`) and one computes the delete settlement (`settlement`), both in `shared/utils/credits.ts` so the popup, history and server agree. Bites are stored as per-refund, per-person pieces in a new `credit_uses` table; a bill's `credit` is the sum of its pieces, so `shareDue`/`cardDue` and every total keep working. Eligibility rules live in `shared/utils/rules.ts`.

**Tech Stack:** Nuxt 4, Nuxt UI 4.12, Drizzle ORM (MySQL), zod, Vitest (real MySQL test DB).

**Spec:** `docs/superpowers/specs/2026-10-27-running-refund-credit-design.md`

## Global Constraints

- No new dependencies. Money is integer cents.
- Card reduction on a bill = sum of its pieces, and never more than the bill amount.
- Only shared-card bills take a bite: not `paidByCheck`, not on the Paid Directly name list (case-insensitive), not the refund's own source bill.
- A person always confirms a bite (popup or history). Recurring generation never bites.
- No emails for refund or credit actions; routes `broadcast(event, { topics: ['bills'] })`.
- Existing applied credits migrate unchanged.
- Copy fixed by the spec: popup title "Use Refund Credit?", note "**Paying this bill by check?** Choose Not Now. Credit only works on bills that go on the Citi card.", button "Use $X Credit"; counter "◎ Credit left · You $A · {Partner} $B · Card $C"; delete title "Delete {name}? · ${amount}", subtitle "Do this only after the money is settled by hand.", steps "{Name} adds **$X** to the shared account." / "Withdraw **$Y** to the card it went on.", button "It's Settled · Delete"; check-switch block "Someone already paid this bill with the credit taken off. Delete it (admin) and add it again as a check."

## Review Focus

1. Two applies racing on the same credit: credit left must never go negative. (Task 2 concurrency test.)
2. A bill refunded after taking a bite, then edited / credit removed / switched to Check: must be refused, or money comes back twice. (Task 3 rug-chain test.)
3. Penny-over shares ($59.99 → $30.00/$30.00) fully covered: card reduction capped at $59.99. (Task 1 test.)
4. A bite whose source refund is the bill itself (bill refunded, later re-offered): never bites its own refund. (Task 1 test.)
5. Admin delete with only one person paid: adds are bite for the payer, full share for the non-payer. (Task 1 settlement test.)

---

### Task 1: Credit math and rules (shared, pure)

**Files:**
- Modify: `shared/utils/credits.ts` (remove `canAbsorb`; add `sizeBite`, `settlement`, `poolsFromRefunds`)
- Modify: `shared/utils/rules.ts`
- Test: `test/shared.test.ts`

**Interfaces:**
- Produces (credits.ts):
  - `interface CreditPool { refundId: number, sourceBillId: number, left: Record<number, number> }` — per-person credit left; caller passes pools oldest first.
  - `interface CreditPiece { refundId: number, userId: number, amountCents: number }`
  - `sizeBite(bill: { id: number, amountCents: number, participants: { userId: number, amountCents: number }[] }, pools: CreditPool[]): CreditPiece[]` — only pieces > 0.
  - `creditFromPieces(pieces: CreditPiece[]): CreditLike` — `{ amountCents: sum, shares: per-user sums }`.
  - `interface Settlement { deposits: { userId: number, cents: number | null }[], receivedCents: number, creditCents: number, adds: { userId: number, cents: number }[], withdrawCents: number }`
  - `settlement(bill: { amountCents: number, participants: ParticipantLike[], credit?: CreditLike | null }): Settlement`
- Produces (rules.ts):
  - `BillLike` loses `paidWithCardOf`, gains `refunds?: { amountCents: number }[]`.
  - `onSharedCard = (bill) => !bill.paidByCheck`
  - `isDirectPayName(name: string, names: string[]): boolean`
  - `canRemoveCredit(bill: BillLike): boolean` — has credit, card not paid, no refunds recorded, every paid share has `shareDue === 0`.
  - `canEditAmounts(bill)` = `canEditBill(bill) || canRemoveCredit(bill)`.
  - `canTakeCredit(bill: BillLike, directPay: boolean): boolean` — `canEditBill && !cardPaidAt && onSharedCard && !credit && !directPay`.
  - `canAdminDeleteBill(bill: BillLike, directPay: boolean): boolean` — `!canDeleteBill(bill) && onSharedCard && !directPay && !cardPaidAt` (refund-use block is server-side).

- [ ] **Step 1: Write failing tests** in `test/shared.test.ts` (replace the `canAbsorb` and personal-card cases):

```ts
const pool = (refundId: number, sourceBillId: number, a: number, b: number) => ({ refundId, sourceBillId, left: { 1: a, 2: b } })
const bill = (id: number, amountCents: number, a: number, b: number) => ({ id, amountCents, participants: [{ userId: 1, amountCents: a }, { userId: 2, amountCents: b }] })

it('bites the whole bill while credit lasts', () => {
  expect(sizeBite(bill(9, 21248, 10624, 10624), [pool(1, 5, 150000, 150000)]))
    .toEqual([{ refundId: 1, userId: 1, amountCents: 10624 }, { refundId: 1, userId: 2, amountCents: 10624 }])
})
it('takes only what is left', () => {
  const c = creditFromPieces(sizeBite(bill(9, 20000, 10000, 10000), [pool(1, 5, 4500, 4500)]))
  expect(c).toEqual({ amountCents: 9000, shares: { 1: 4500, 2: 4500 } })
})
it('spans refunds oldest first', () => {
  expect(sizeBite(bill(9, 20000, 10000, 10000), [pool(1, 5, 3000, 3000), pool(2, 6, 50000, 50000)])).toEqual([
    { refundId: 1, userId: 1, amountCents: 3000 }, { refundId: 2, userId: 1, amountCents: 7000 },
    { refundId: 1, userId: 2, amountCents: 3000 }, { refundId: 2, userId: 2, amountCents: 7000 }])
})
it('uneven credit bites only its owner', () => {
  expect(creditFromPieces(sizeBite(bill(9, 20000, 10000, 10000), [pool(1, 5, 30000, 0)])).shares).toEqual({ 1: 10000 })
})
it('caps the card at the bill amount when shares round up', () => {
  const c = creditFromPieces(sizeBite(bill(9, 5999, 3000, 3000), [pool(1, 5, 150000, 150000)]))
  expect(c.amountCents).toBe(5999)
  expect(c.shares).toEqual({ 1: 3000, 2: 2999 })
})
it('never bites a bill from its own refund', () => {
  expect(sizeBite(bill(5, 20000, 10000, 10000), [pool(1, 5, 9000, 9000)])).toEqual([])
})
it('settles a deleted bill', () => {
  const credit = { amountCents: 5000, shares: { 1: 2500, 2: 2500 } }
  const ps = (aPaid: boolean, bPaid: boolean) => [{ userId: 1, amountCents: 10000, paidAt: aPaid ? 'x' : null }, { userId: 2, amountCents: 10000, paidAt: bPaid ? 'x' : null }]
  expect(settlement({ amountCents: 20000, participants: ps(true, true), credit })).toEqual({
    deposits: [{ userId: 1, cents: 7500 }, { userId: 2, cents: 7500 }], receivedCents: 15000, creditCents: 5000,
    adds: [{ userId: 1, cents: 2500 }, { userId: 2, cents: 2500 }], withdrawCents: 20000 })
  expect(settlement({ amountCents: 20000, participants: ps(false, true), credit })).toMatchObject({
    receivedCents: 7500, adds: [{ userId: 1, cents: 10000 }, { userId: 2, cents: 2500 }] })
  expect(settlement({ amountCents: 20000, participants: ps(true, true) })).toMatchObject({ receivedCents: 20000, creditCents: 0, adds: [] })
})
it('credit rules', () => {
  const p = (userId: number, paid: boolean) => ({ userId, amountCents: 500, paidAt: paid ? 'x' : null })
  const fresh = { amountCents: 1000, cardPaidAt: null, participants: [p(1, false), p(2, false)] }
  expect(canTakeCredit(fresh, false)).toBe(true)
  expect(canTakeCredit(fresh, true)).toBe(false)
  expect(canTakeCredit({ ...fresh, paidByCheck: true }, false)).toBe(false)
  const covered = { ...fresh, credit: { amountCents: 1000, shares: { 1: 500, 2: 500 } }, participants: [p(1, true), p(2, true)] }
  expect(canRemoveCredit(covered)).toBe(true)
  expect(canRemoveCredit({ ...covered, refunds: [{ amountCents: 1000 }] })).toBe(false)
  expect(canEditAmounts({ ...covered, refunds: [{ amountCents: 1000 }] })).toBe(false)
  const paid = { ...fresh, participants: [p(1, true), p(2, true)] }
  expect(canAdminDeleteBill(paid, false)).toBe(true)
  expect(canAdminDeleteBill(paid, true)).toBe(false)
  expect(canAdminDeleteBill({ ...paid, cardPaidAt: 'x' }, false)).toBe(false)
  expect(canAdminDeleteBill({ ...paid, paidByCheck: true }, false)).toBe(false)
  expect(isDirectPayName('ledford mortgage', ['Ledford Mortgage'])).toBe(true)
})
```

- [ ] **Step 2: Run** `npx vitest run test/shared.test.ts` — Expected: FAIL (missing exports).

- [ ] **Step 3: Implement.** `sizeBite`: for each participant in order, `need = share`; walk pools skipping `sourceBillId === bill.id`, take `min(left[user] ?? 0, need)`. Then penny cap: `excess = total − bill.amountCents`; while `excess > 0`, trim from the participant with the largest piece total (ties: highest userId), from that participant's last piece. `settlement`: `deposit = paidAt ? shareDue(p, credit) : null`; `add = share − (deposit ?? 0)` keeping adds > 0; `withdrawCents = bill.amountCents`. Fix the `shared.test.ts` personal-card case to drop `paidWithCardOf`.

- [ ] **Step 4: Run** `npx vitest run test/shared.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit** `feat: bite sizing, delete settlement and credit rules`

---

### Task 2: Store bites; credit service; drop personal card

**Files:**
- Modify: `server/db/schema.ts`; Create: migration `server/db/migrations/0004_*.sql` via `npm run db:generate`, hand-edited
- Modify: `server/services/bills.ts`, `server/services/refunds.ts`, `test/helpers.ts` (`TABLES` gets `'credit_uses'` first)
- Modify: `server/api/bills/[id]/card.put.ts`; Create: `server/api/bills/[id]/credit.post.ts`, `server/api/bills/[id]/credit.delete.ts`; Delete: `server/api/refunds/[id]/apply.post.ts`, `server/api/refunds/[id]/unapply.post.ts`
- Test: `test/refunds.test.ts`, `test/bills.test.ts`, `test/reconcile.test.ts`

**Interfaces:**
- Consumes: Task 1 exports.
- Produces:
  - Table `credit_uses`: `id`, `refund_id` (fk refunds cascade), `bill_id` (fk bills cascade), `user_id` (fk users cascade), `amount_cents`, timestamps; unique `(refund_id, bill_id, user_id)`; index `bill_id`. Relations: `bills.creditUses`, `refunds.uses`, `creditUses.refund/bill`.
  - Migration order: create `credit_uses` + FKs → `INSERT INTO credit_uses (refund_id, bill_id, user_id, amount_cents, created_at) SELECT rs.refund_id, r.applied_to_bill_id, rs.user_id, rs.amount_cents, COALESCE(r.applied_at, now()) FROM refund_shares rs JOIN refunds r ON r.id = rs.refund_id WHERE r.applied_to_bill_id IS NOT NULL AND rs.amount_cents > 0` → drop `refunds_applied_unique`, the applied FK, `applied_to_bill_id`, `applied_at` → drop `bills_paid_with_card_of` FK and column.
  - `BillCredit = CreditLike & { sources: { refundId: number, sourceBillId: number, sourceName: string, sourceAddedOn: string, refundedOn: string, amountCents: number, shares: Record<number, number> }[] }`
  - `BillRefund = { id, amountCents, refundedOn, uses: { billName: string, billAddedOn: string, amountCents: number }[] }`
  - `BillDto` loses `paidWithCardOf`.
  - `RefundDto = { id, billId, billName, billAddedOn, amountCents, refundedOn, shares, left: Record<number, number>, leftCents: number, uses: { billId, billName, billAddedOn, shares: Record<number, number>, amountCents, removable: boolean }[] }`
  - `releaseCredit(tx, bill: BillDto): Promise<void>` (bills.ts, exported) — unmarks shares with `shareDue === 0`, deletes the bill's `credit_uses`.
  - `setPaidByCheck(billId: number, check: boolean): Promise<BillDto>` replaces `setPaidWithCard`. 409 if `cardPaidAt` or refunds recorded; with a credit, allowed only if `canRemoveCredit` (then `releaseCredit` in the same transaction), else 409 with the spec's block message.
  - `applyCredit(billId: number): Promise<BillDto>`, `removeCredit(billId: number): Promise<void>` replace `applyRefund`/`unapplyRefund`.
  - `PUT /api/bills/:id/card` body `{ check: boolean }`; `POST /api/bills/:id/credit`; `DELETE /api/bills/:id/credit`.

- [ ] **Step 1: Rewrite tests.** In `test/refunds.test.ts`, port every `applyRefund(r, b)` → `applyCredit(b)`, `unapplyRefund(r)` → `removeCredit(billId)`, `appliedToBillId` asserts → `leftCents`/`uses`; delete personal-card tests; replace "rejects bills that cannot absorb" with:

```ts
it('a small bill takes a bite and the rest stays', async () => {
  const rug = await paidBill('Costco TV', 300000)
  await recordRefund(rug.id, { amountCents: 300000, refundedOn: '2026-10-12' }, tim)
  const kroger = await createBill({ name: 'Kroger', amountCents: 21248, createdBy: tim })
  const bill = await applyCredit(kroger.id)
  expect(bill.participants.every(p => p.paidAt)).toBe(true)
  expect(cardDue(bill)).toBe(0)
  expect((await listRefunds())[0]).toMatchObject({ leftCents: 278752, left: { [tim]: 139376, [kelly]: 139376 } })
})
it('two applies cannot overspend', async () => {
  const rug = await paidBill('Rug', 10000)
  await recordRefund(rug.id, { amountCents: 10000, refundedOn: '2026-10-12' }, tim)
  const a = await createBill({ name: 'A', amountCents: 10000, createdBy: tim })
  const b = await createBill({ name: 'B', amountCents: 10000, createdBy: tim })
  const results = await Promise.allSettled([applyCredit(a.id), applyCredit(b.id)])
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
  expect((await listRefunds())[0]!.leftCents).toBe(0)
})
it('a bill takes credit once', async () => { /* apply twice on a partial bite → second 409 */ })
it('check bills take no credit', async () => { /* setPaidByCheck(b, true); applyCredit → 409 */ })
```
Add to `test/bills.test.ts` the check toggle test using `setPaidByCheck(bill.id, true)` (assert `paidByCheck: true`), and in `test/reconcile.test.ts` replace the personal-card cases with check bills (set `paidByCheck: true` directly in the "leaves out refunds" case).

- [ ] **Step 2: Run** `npx vitest run` — Expected: FAIL (missing exports / columns).

- [ ] **Step 3: Schema + migration.** Edit schema, run `npm run db:generate`, insert the data-copy `INSERT` between the create and the drops, keep `--> statement-breakpoint` separators.

- [ ] **Step 4: Services.** `bills.ts`: load `creditUses` with refund + refund.bill; build `credit` via `creditFromPieces` + sources; drop every `paidWithCardOf` (columns, DTO, `listBills`, `unpaidByMonth`, `listForReconcile` queries); `updateBill` uses `releaseCredit`; `notifyIfCardReady` uses `isDirectPayName`. `refunds.ts`: `applyCredit` checks `canTakeCredit(bill, isDirectPayName(...))`, then in one transaction `SELECT ... FROM refunds FOR UPDATE` (`.for('update')`), recomputes pools from `refund_shares` minus `credit_uses` ordered `(refunded_on, id)`, re-checks the bill has no uses, `sizeBite`, 409 "No refund credit is left." if empty, inserts pieces, marks covered shares paid; `notifyIfCardReady` after. `removeCredit` 409 unless `canRemoveCredit`. `deleteRefund` 409 if any uses. `listRefunds` fills `left`, `leftCents`, `uses[].removable` (via `canRemoveCredit` on each used bill).

- [ ] **Step 5: Routes** as listed; credit routes broadcast `bills`.

- [ ] **Step 6: Run** `npx vitest run` — Expected: PASS.

- [ ] **Step 7: Commit** `feat: refund credit is used a bite at a time; personal card option removed`

---

### Task 3: Paid Directly, refunded-bill lock, admin delete

**Files:**
- Modify: `server/services/refunds.ts`, `server/services/bills.ts`, `server/api/bills/[id].delete.ts`
- Test: `test/refunds.test.ts`

**Interfaces:**
- Consumes: Task 1 rules, Task 2 services.
- Produces: `deleteBill(id: number, adminMode = false): Promise<BillDto>` — normal path unchanged; otherwise requires `adminMode && canAdminDeleteBill(bill, directPay)`, 409 if any refund on the bill has uses ("Remove the credit this bill's refund gave other bills first."), 403 when not admin. Cascades remove its pieces and unused refunds. Route passes `!!(await requireUserSession(event)).adminMode`.

- [ ] **Step 1: Failing tests:**

```ts
it('no refunds or credit on paid directly bills', async () => {
  const mortgage = await paidBill('Ledford Mortgage', 188000, false)
  await expectHttpError(recordRefund(mortgage.id, { amountCents: 100, refundedOn: '2026-10-12' }, tim), 409)
  const rug = await paidBill('Rug', 300000)
  await recordRefund(rug.id, { amountCents: 300000, refundedOn: '2026-10-12' }, tim)
  const next = await createBill({ name: 'Ledford Mortgage', amountCents: 188000, createdBy: tim })
  await expectHttpError(applyCredit(next.id), 409)
})
it('rug chain: a refunded bill keeps its bite', async () => {
  const a = await paidBill('Rug A', 30000)
  await recordRefund(a.id, { amountCents: 30000, refundedOn: '2026-10-12' }, tim)
  const b = await createBill({ name: 'Rug B', amountCents: 30000, createdBy: tim })
  await applyCredit(b.id) // fully covered, shares auto-paid
  await recordRefund(b.id, { amountCents: 30000, refundedOn: '2026-10-20' }, tim)
  await expectHttpError(removeCredit(b.id), 409)
  await expectHttpError(updateBill(b.id, { amountCents: 40000 }), 409)
  await expectHttpError(setPaidByCheck(b.id, true), 409)
  const refunds = await listRefunds()
  expect(refunds.reduce((s, r) => s + r.leftCents, 0)).toBe(30000)
})
it('rug chain with deposits: $320 refund leaves $160 each', async () => { /* A 30000 refunded; B 32000 bites 30000; pay both $10; card paid; refund B 32000 → B's refund shares {tim:16000,kelly:16000}, total leftCents 32000 */ })
it('switching to check returns an unpaid bite, blocks after a deposit', async () => { /* partial bite on 20000 bill with 9000 left; setPaidByCheck → credit null, leftCents back; re-create, apply, pay tim → setPaidByCheck 409 */ })
it('admin delete of a paid bill returns its bite', async () => {
  const rug = await paidBill('Rug', 5000)
  await recordRefund(rug.id, { amountCents: 5000, refundedOn: '2026-10-12' }, tim)
  const bb = await createBill({ name: 'Best Buy', amountCents: 20000, createdBy: tim })
  await applyCredit(bb.id)
  await markParticipantPaid(bb.id, tim, tim, false)
  await markParticipantPaid(bb.id, kelly, kelly, false)
  await expectHttpError(deleteBill(bb.id), 403)
  await deleteBill(bb.id, true)
  expect((await listRefunds())[0]!.leftCents).toBe(5000)
})
it('admin delete is refused when the card is paid or its refund was used', async () => { /* ... 409 each */ })
```

- [ ] **Step 2: Run** `npx vitest run test/refunds.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the `recordRefund` Paid Directly 409 ("This bill is paid directly from the shared account, so the refund did not go to the Citi card."), `updateBill` gate via `canEditAmounts` (already includes refunds), `deleteBill` admin path, route session.
- [ ] **Step 4: Run** `npx vitest run` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: paid directly takes no credit, refunded bills lock their bite, admin delete`

---

### Task 4: UI

**Files:**
- Modify: `app/components/CreditPromptModal.vue`, `app/components/CreditsModal.vue`, `app/components/BillEditModal.vue`, `app/pages/index.vue`, `app/pages/search.vue`, `app/pages/reconcile.vue` (only if its types reference removed fields)
- Create: `app/components/SettleDeleteModal.vue`

**Interfaces:**
- Consumes: `sizeBite`, `poolsFromRefunds(refunds: { id, billId, refundedOn, left }[]): CreditPool[]` (add to Task 1's file if not yet there: filters `leftCents > 0`, sorts `(refundedOn, id)`), `creditFromPieces`, `settlement`, `canTakeCredit`, `canRemoveCredit`, `canAdminDeleteBill`, `isDirectPayName`.
- Component props:
  - `CreditPromptModal`: `{ bill, refunds: RefundDto[], users }` — computes pieces; posts `/api/bills/:id/credit`.
  - `CreditsModal`: `{ refunds, bills, users, directPay: string[] }`.
  - `BillEditModal`: adds `adminMode: boolean`, `directPay: boolean`.
  - `SettleDeleteModal`: `{ bill, users }`, `v-model:open`, emits `changed`; DELETE `/api/bills/:id`.

- [ ] **Step 1: index.vue.** Counter from `refunds[].left`/`leftCents` with the spec copy; popup after quick-add when `canTakeCredit(bill, isDirectPay(bill))` and `sizeBite` is non-empty; `isDirectPay` uses `isDirectPayName`; `creditTip` lists `credit.sources`; credit tag click → `sources[0].sourceAddedOn`; `refundTip` from `refunds[].uses`; remove the personal-card Card cell branch; pass `adminMode`, `directPay` to `BillEditModal`, `directPay` list to `CreditsModal`.
- [ ] **Step 2: CreditPromptModal** per mockup section 2 (sources line, deposits with `($100.00 − $45.00)`, Joint pays Citi, Credit left after, amber check note, "Use $X Credit").
- [ ] **Step 3: CreditsModal** per mockup section 1: one top "Use on a bill" `USelect` over this month's bills with `canTakeCredit` and a non-empty bite, Apply; per refund "$left left of $total", progress bar, bites table (Used on · per user · Card · Left after, running), Remove on `removable` rows (DELETE `/api/bills/:billId/credit`), Delete refund when no uses.
- [ ] **Step 4: BillEditModal.** Replace Paid With select with `USwitch` "Paid by check" + `i-lucide-banknote` icon, disabled when `cardPaidAt || refunds.length || (credit && !canRemoveCredit(bill))`; PUT `{ check }`. `refundable` also requires `!directPay`. Show "Delete (admin)" opening `SettleDeleteModal` when `adminMode && canAdminDeleteBill(bill, directPay)`. Credit warning title uses `credit.sources.map(s => s.sourceName).join(', ')`.
- [ ] **Step 5: SettleDeleteModal** per mockup section 3 using `settlement(bill)`; returned-credit line per `credit.sources` with per-person shares; when no credit, omit credit lines.
- [ ] **Step 6: search.vue** credit tooltip from `sources`; drop the personal-card badge.
- [ ] **Step 7: Run** `npm run typecheck` and `npx vitest run` — Expected: no errors; all pass.
- [ ] **Step 8: Run the app** (dev server) and walk the acceptance: $3,000 refund → $212.48 bill popup → counter; $90-left popup math; check toggle; admin delete confirmation both variants.
- [ ] **Step 9: Commit** `feat: running credit counter, bite popup, check toggle, settle-and-delete`
