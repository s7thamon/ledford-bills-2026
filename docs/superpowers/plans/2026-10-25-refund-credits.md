# Refund Credits and Different-Card Bills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record store refunds as credits that a later bill absorbs, mark bills paid with a personal card, and show both clearly on the Bills table and in history.

**Architecture:**
- **Pure money rules** live in `shared/utils/credits.ts`, plus extensions to `rules.ts` and `bill-view.ts`, so the client and server agree.
- **Data:** a new `refunds` table and a `refund_shares` table, plus a nullable `bills.paid_with_card_of`.
- **Services:** a new `server/services/refunds.ts` owns record, apply, unapply and delete. `BillDto` gains `paidWithCardOf`, `credit` and `refunds`, so pages render from bill data.
- **Client:** small API routes broadcast on the `bills` topic with no message (quiet: no email and no toast). Three new modals plus additions on the Bills page.

**Tech Stack:** Nuxt 4, Nuxt UI 4.12, Drizzle ORM + MySQL, Vitest

**Spec:** `docs/superpowers/specs/2026-10-25-refund-credits-design.md`

## Global Constraints

- Money is integer cents. Per-person credits are proportional to the original bill's stored shares (largest remainder) and add up **exactly** to the refund.
- One applied credit per bill, ever. A credit applies only to a bill that has no payments, is not card-paid, and is not on a different card.
- No email for refund or different-card actions. Broadcast `{ topics: ['bills'] }` with no `message`.
- A different-card bill is excluded from every card figure, tab, bulk card action and the Card Ready email, but still counts in Total This Month and in people's shares.
- Tooltips are instant (`:delay-duration="0"`) and open above (`:content="{ side: 'top' }"`).
- Colors:
  - credit = purple soft badge,
  - refunded = red soft badge,
  - different card = neutral soft badge,
  - each readable in dark mode.
- No new dependencies.

## Review Focus

- Applying a credit that zeroes someone's share must mark that share paid and, if everyone is then paid, send the existing Card Ready email exactly once (Task 3 test `zero share auto-paid`).
- Editing the amount or split of a bill that carries a credit must return the credit to unused, never leave a stale credit or block the edit (Task 3 test `edit returns credit`).
- A different-card bill that becomes fully paid must not send Card Ready and must not appear in Ready for Card (Task 3 test `different card skips card ready`; Task 2 tab test).
- Recording more than the remaining refundable amount must be rejected with 422 (Task 3 test `over-refund rejected`).
- Concurrent apply of one refund to two bills must not double-apply. Use a conditional update `WHERE applied_to_bill_id IS NULL` and check affected rows (Task 3 test `apply is single-use`).

---

### Task 1: Credit math (pure)

**Files:**
- Create: `shared/utils/credits.ts`
- Test: `test/shared.test.ts`

**Interfaces:**
- Produces:
  - `export interface CreditLike { amountCents: number, shares: Record<number, number> }`
  - `export function splitRefund(refundCents: number, shares: { userId: number, amountCents: number }[]): Record<number, number>`: proportional to `amountCents` with largest remainder. Ties go to the larger share, then the lower `userId`. If all shares are 0, split equally by the same rule.
  - `export function canAbsorb(bill: { amountCents: number, participants: { userId: number, amountCents: number }[] }, credit: CreditLike): boolean`: true when `bill.amountCents >= credit.amountCents` and every user's share is at least their credit share.
  - `export function shareDue(participant: { userId: number, amountCents: number }, credit?: CreditLike | null): number`: share minus that user's credit share, never below 0.
  - `export function cardDue(bill: { amountCents: number, credit?: CreditLike | null }): number`: amount minus the credit amount, never below 0.

- [ ] **Step 1: Write failing tests**

```ts
describe('credits', () => {
  const even = [{ userId: 1, amountCents: 15000 }, { userId: 2, amountCents: 15000 }]
  it('splits a refund in proportion to stored shares, exactly', () => {
    expect(splitRefund(30000, even)).toEqual({ 1: 15000, 2: 15000 })
    expect(splitRefund(301, even)).toEqual({ 1: 151, 2: 150 })
    expect(splitRefund(1000, [{ userId: 1, amountCents: 2668 }, { userId: 2, amountCents: 0 }])).toEqual({ 1: 1000, 2: 0 })
    expect(splitRefund(1000, [{ userId: 1, amountCents: 7500 }, { userId: 2, amountCents: 2500 }])).toEqual({ 1: 750, 2: 250 })
    const odd = splitRefund(1001, [{ userId: 1, amountCents: 3334 }, { userId: 2, amountCents: 6667 }])
    expect(odd[1]! + odd[2]!).toBe(1001)
  })
  it('checks a bill can absorb a credit', () => {
    const credit = { amountCents: 30000, shares: { 1: 15000, 2: 15000 } }
    expect(canAbsorb({ amountCents: 32000, participants: [{ userId: 1, amountCents: 16000 }, { userId: 2, amountCents: 16000 }] }, credit)).toBe(true)
    expect(canAbsorb({ amountCents: 32000, participants: [{ userId: 1, amountCents: 32000 }, { userId: 2, amountCents: 0 }] }, credit)).toBe(false)
    expect(canAbsorb({ amountCents: 29999, participants: [{ userId: 1, amountCents: 15000 }, { userId: 2, amountCents: 15000 }] }, credit)).toBe(false)
  })
  it('computes amounts due after a credit', () => {
    const credit = { amountCents: 30000, shares: { 1: 15000, 2: 15000 } }
    expect(shareDue({ userId: 1, amountCents: 16000 }, credit)).toBe(1000)
    expect(shareDue({ userId: 1, amountCents: 16000 }, null)).toBe(16000)
    expect(cardDue({ amountCents: 32000, credit })).toBe(2000)
    expect(cardDue({ amountCents: 32000 })).toBe(32000)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/shared.test.ts`
Expected: FAIL. The imports aren't defined.

- [ ] **Step 3: Implement `shared/utils/credits.ts` per the Interfaces block**

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/shared.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/utils/credits.ts test/shared.test.ts
git commit -m "feat: refund credit math"
```

### Task 2: Rules and tabs know about credits and different cards

**Files:**
- Modify: `shared/utils/rules.ts`, `shared/utils/bill-view.ts`
- Test: `test/shared.test.ts`

**Interfaces:**
- Consumes: `CreditLike`, `cardDue` from Task 1.
- Produces:
  - `BillLike` gains optional `paidWithCardOf?: number | null` and `credit?: CreditLike | null`.
  - `canMarkCardPaid(bill)` is now `!bill.cardPaidAt && !bill.paidWithCardOf && allParticipantsPaid(bill)`.
  - `billInTab`: `'card'` and `'ready'` exclude `paidWithCardOf` bills. `'mine'` and `'theirs'` are unchanged.
  - `readyForCardCents(bills)` sums `cardDue(b)` for bills where `canMarkCardPaid`.
  - New: `export const cardUnpaidCents = (bills: BillLike[]) => bills.reduce((s, b) => s + (b.cardPaidAt || b.paidWithCardOf ? 0 : cardDue(b)), 0)`, in `bill-view.ts`.

- [ ] **Step 1: Write failing tests**

```ts
describe('different card and credits in rules', () => {
  const p = (userId: number, paid: boolean) => ({ userId, amountCents: 500, paidAt: paid ? '2026-10-01' : null })
  const personal = { amountCents: 1000, cardPaidAt: null, paidWithCardOf: 1, participants: [p(1, true), p(2, true)] }
  const credited = { amountCents: 32000, cardPaidAt: null, credit: { amountCents: 30000, shares: { 1: 15000, 2: 15000 } }, participants: [p(1, true), p(2, true)] }
  it('never offers the card for a different-card bill', () => {
    expect(canMarkCardPaid(personal)).toBe(false)
    expect(billInTab(personal, 'ready', 1)).toBe(false)
    expect(billInTab(personal, 'card', 1)).toBe(false)
    expect(cardUnpaidCents([personal])).toBe(0)
  })
  it('uses the reduced card amount for credited bills', () => {
    expect(readyForCardCents([credited])).toBe(2000)
    expect(cardUnpaidCents([credited])).toBe(2000)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/shared.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the changes in the Interfaces block**

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/shared.test.ts`
Expected: PASS, including the existing tab tests.

- [ ] **Step 5: Commit**

```bash
git add shared/utils/rules.ts shared/utils/bill-view.ts test/shared.test.ts
git commit -m "feat: card rules skip different-card bills and honor credits"
```

### Task 3: Schema, migration, refund service, bill DTO

**Files:**
- Modify: `server/db/schema.ts`
- Create: `server/db/migrations/0001_*.sql`, generated by `npm run db:generate`
- Create: `server/services/refunds.ts`
- Modify: `server/services/bills.ts`
- Modify: `test/helpers.ts`: add `'refund_shares', 'refunds'` to the front of `TABLES`.
- Test: `test/refunds.test.ts`

**Interfaces:**
- **Schema:**
  - `bills.paidWithCardOf`: `fk('paid_with_card_of').references(() => users.id, { onDelete: 'set null' })`.
  - `refunds`:
    - `id`
    - `billId` (fk, cascade)
    - `amountCents` (cents)
    - `refundedOn` (date string)
    - `createdBy` (fk users, cascade)
    - `appliedToBillId` (fk bills, `set null`, with a unique index `refunds_applied_unique`; MySQL allows multiple NULLs)
    - `appliedAt` (timestamp, nullable)
    - `...timestamps`
  - `refundShares`:
    - `id`
    - `refundId` (fk, cascade)
    - `userId` (fk users, cascade)
    - `amountCents`
    - unique `(refundId, userId)`
  - Add Drizzle `relations`: bill has many `refunds` (by `billId`), and one `appliedCredit` (refund by `appliedToBillId`). Refund has many `shares`.
- **`BillDto`** gains:
  - `paidWithCardOf: number | null`
  - `credit: { refundId: number, amountCents: number, shares: Record<number, number>, sourceBillId: number, sourceName: string, sourceAddedOn: string, refundedOn: string } | null`
  - `refunds: { id: number, amountCents: number, refundedOn: string, appliedToBillId: number | null, appliedToName: string | null, appliedToAddedOn: string | null }[]`
  - `getBill`, `listBills` and `searchBills` all populate these through one shared loader.
- **`server/services/refunds.ts`:**
  - `recordRefund(billId: number, input: { amountCents: number, refundedOn: string }, actorId: number): Promise<RefundDto>`
    - 409 if the bill is still editable (no payments) or `paidWithCardOf` is set.
    - 422 if the amount is above the bill amount minus existing refunds.
    - Shares come from `splitRefund(amount, bill.participants)`.
  - `applyRefund(refundId: number, billId: number): Promise<BillDto>`
    - 409 if the target has payments, is card-paid or different-card, already has a credit, or is the refund's own bill.
    - 422 if `!canAbsorb`.
    - The update is conditional on `applied_to_bill_id IS NULL`, and 0 affected rows means 409.
    - Then marks paid every participant whose `shareDue` is 0, and calls the existing card-ready notify path when `canMarkCardPaid`.
  - `unapplyRefund(refundId: number): Promise<void>`
    - 409 unless the target bill is not card-paid and every paid participant there has `shareDue === 0`.
    - Clears those auto-paid shares, then clears the link.
  - `deleteRefund(refundId: number): Promise<void>`: 409 if applied.
  - `listRefunds(): Promise<RefundDto[]>`: newest first, with source and applied bill names and dates, and `shares`.
  - `export interface RefundDto { id, billId, billName, billAddedOn, amountCents, refundedOn, shares: Record<number, number>, appliedToBillId, appliedToName, appliedToAddedOn, appliedAt }`
- **`server/services/bills.ts`:**
  - `updateBill`: when the bill carries a credit and the amount or splits change, clear its `refunds.appliedToBillId` in the same transaction.
  - New: `setPaidWithCard(billId: number, userId: number | null): Promise<BillDto>`, with 422 if `userId` isn't a household user.
  - `notifyIfCardReady` already goes through `canMarkCardPaid`, so different-card bills are skipped.

- [ ] **Step 1: Update schema and generate the migration**

Run: `npm run db:generate`
Expected: a new `server/db/migrations/0001_*.sql` that creates `refunds` and `refund_shares` and adds `bills.paid_with_card_of`. Inspect it and confirm no existing table is dropped.

- [ ] **Step 2: Write failing service tests in `test/refunds.test.ts`**

Cover these cases, each one `it`, using `seedUsers` and `createBill`/`markParticipantPaid`/`markCardPaid`:

- `records proportional credits`:
  - A $300 rug, both paid, card paid.
  - `recordRefund(rug, { amountCents: 30000, refundedOn: '2026-11-02' })` gives shares `{ tim: 15000, kelly: 15000 }`.
  - `getBill(rug).refunds[0].amountCents === 30000`.
- `over-refund rejected`: a second refund of 1 cent after a full refund returns 422.
- `refund needs a paid bill`: on an unpaid bill, 409.
- `applies to an absorbing bill and reduces amounts due`:
  - Apply to a $320 bill.
  - `getBill(replacement).credit.amountCents === 30000`.
  - `shareDue` per user is 1000, and `cardDue` is 2000.
- `apply is single-use`: applying the same refund to a second bill returns 409. Applying a second refund to the same bill also returns 409.
- `zero share auto-paid`:
  - Apply a $300 credit to a $300 bill.
  - Both shares are paid after the apply.
  - `flushMail()` shows exactly one `Card Ready to Pay` email to Kelly.
- `edit returns credit`: `updateBill(replacement, { amountCents: 40000 })` makes `credit` null and leaves `listRefunds()[0].appliedToBillId` null.
- `delete returns credit`: `deleteBill(replacement)` leaves the refund unapplied.
- `unapply rules`: unapply works before payments. After Tim pays a non-zero share, unapply returns 409.
- `different card skips card ready`:
  - `setPaidWithCard(bill, tim)`, then both pay.
  - No `Card Ready to Pay` email.
  - `markCardPaid` returns 409.
  - `recordRefund` on it returns 409.
  - `setPaidWithCard(bill, null)` makes `canMarkCardPaid` true again.
- `no refund emails`: recording and applying send no mail.

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run test/refunds.test.ts`
Expected: FAIL. The module isn't found.

- [ ] **Step 4: Implement `server/services/refunds.ts` and the `bills.ts` changes per the Interfaces block**

Put every multi-row change in a single `db.transaction`.

- [ ] **Step 5: Run to verify pass**

Run: `npm test`
Expected: all suites PASS, including the existing bills tests.

- [ ] **Step 6: Commit**

```bash
git add server/db test/helpers.ts server/services/refunds.ts server/services/bills.ts test/refunds.test.ts
git commit -m "feat: refunds, credits and different-card bills in the data layer"
```

### Task 4: API routes

**Files:**
- Create:
  - `server/api/bills/[id]/refunds.post.ts`
  - `server/api/bills/[id]/card.put.ts`
  - `server/api/refunds/index.get.ts`
  - `server/api/refunds/[id].delete.ts`
  - `server/api/refunds/[id]/apply.post.ts`
  - `server/api/refunds/[id]/unapply.post.ts`

**Interfaces:**
- Consumes the Task 3 services. Follow the existing route style (`idParam`, zod `readValidatedBody`, `broadcast(event, { topics: ['bills'] })`, no `message`).
- Bodies:
  - refunds POST: `{ amountCents: int 1..100_000_000, refundedOn: ISO date string }`
  - card PUT: `{ userId: int | null }`
  - apply POST: `{ billId: int }`
- Responses: the bill or refund DTO, or `{ status: 'ok' }`.

- [ ] **Step 1: Add the six routes**

- [ ] **Step 2: Verify**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add server/api
git commit -m "feat: refund and different-card API routes"
```

### Task 5: Bills page UI

**Files:**
- Create:
  - `app/components/RefundModal.vue`: record a refund. Amount is prefilled with the remaining refundable amount, the date defaults to today, and the card and per-person credit preview uses `splitRefund`.
  - `app/components/CreditPromptModal.vue`: the "Apply refund credit?" popup with the mockup's breakdown (source, credit applied, each person deposits, joint pays Citi). Buttons are "Not now" and "Apply Credit".
  - `app/components/CreditsModal.vue`: history from `GET /api/refunds`. Each row shows source bill and date, amount, status, and actions: Apply to… (a select of absorbable unpaid bills this month), Unapply, Delete.
- Modify:
  - `app/components/BillEditModal.vue`:
    - Footer gets a "Record Refund" button when `!canEditBill && !paidWithCardOf`, opening RefundModal.
    - A "Paid with different card" `USelect` (None / each household user) that calls `PUT /api/bills/:id/card`.
    - When the bill has a credit, a warning above Save: "Saving amount or split changes removes the −$X refund credit (it becomes available again)."
  - `app/pages/index.vue`:
    - Name cell tags:
      - red `UBadge` "↩ Refunded −$X" (the sum of `refunds`), with a tooltip naming where each was applied;
      - purple "◎ −$X credit", with a tooltip "Credit from {sourceName}, refunded {usDotDate}".
      - Clicking a tag navigates to the other bill's month.
    - Amount and Each are struck through when refunds total the bill amount.
    - Pay buttons show `formatMoney(shareDue(p, bill.credit))`. A paid share on a credited bill shows the sub-label "Paid $X + $Y credit".
    - Card column:
      - a `paidWithCardOf` bill shows a neutral badge "{First}'s card" with the spec's tooltip;
      - a credited bill shows "Pay Card $X" (`cardDue`) and the "Paid $X + $Y credit" sub-label.
    - Stats and footer use `shareDue`, `cardUnpaidCents` and `readyForCardCents`.
    - Credits note above the table, shown when any refund is unapplied: "◎ Credits available · You $A · {Partner} $B · Card $C". It opens CreditsModal.
    - After `createBill` succeeds, fetch `/api/refunds` and find the oldest unapplied refund where `canAbsorb(newBill, credit)`. If one exists, open CreditPromptModal, and on Apply POST `/api/refunds/:id/apply`.
  - `app/pages/search.vue`: the same two tags in the name cell.

**Interfaces:**
- Consumes the Task 1–2 helpers (auto-imported from `shared/utils`), the Task 3 `BillDto` fields, and the Task 4 routes.
- Badge colors:
  - credit: `color="secondary"` remapped, or a class override to violet soft, with a dark variant;
  - refunded: `color="error" variant="soft"`;
  - different card: `color="neutral" variant="soft"`.

- [ ] **Step 1: Build the three modals and the BillEditModal additions**

- [ ] **Step 2: Wire the Bills and Search pages**

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm test && npm run build`
Expected: all exit 0.

- [ ] **Step 4: Browser acceptance**

Use the dev user `tim@example.com` / `DevPassword123`; the code is in Mailpit at http://localhost:8025. Restart the dev server first, because of the new auto-imports.

Walk through:
1. The rug scenario from the spec: record the refund, add a $320 bill, the prompt appears, apply.
2. Pay buttons show $10, and Pay Card shows $20.
3. The tags appear on both bills, and their tooltips open above.
4. The Credits note and modal work.
5. "Paid with different card → Tim" moves a ready bill out of Ready for Card and shows the "Tim's card" tag.

Check both light and dark mode.

Delete the test data afterwards.

- [ ] **Step 5: Commit**

```bash
git add app
git commit -m "feat: refund credits and different-card bills on the bills page"
```
