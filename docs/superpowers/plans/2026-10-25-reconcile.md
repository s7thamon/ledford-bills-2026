# Reconcile Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A CSV-only Reconcile page that matches a Citi export against shared-card bills, refunds and card payments, suggests combinations for a person to confirm, and lets leftovers be resolved by drag, click or one-button actions.

**Architecture:**
- **Pure parsing and matching** in `shared/utils/reconcile.ts`, unit-tested.
- **One read-only endpoint** that supplies bills and refunds for a date range.
- `POST /api/bills` gains an optional `addedOn`.
- **One page,** `app/pages/reconcile.vue`, keeps all reconciliation state in memory, and the CSV never leaves the browser.

**Tech Stack:** Nuxt 4, Nuxt UI 4.12, Drizzle/MySQL, Vitest

**Spec:** `docs/superpowers/specs/2026-10-25-reconcile-design.md`

## Global Constraints

- The CSV is never stored or sent to the server. Parse it in the browser with `FileReader`/`file.text()`.
- The matching window is ±5 days. Split-charge suggestions use 2–4 lines, and combined-payment suggestions use 2–6 bills.
- Combinations are never applied automatically. Data changes only when a button is pressed.
- Bills marked paid with a different card are excluded everywhere.
- No new dependencies. Tooltips are instant and open above. Every click target gets a pointer cursor (already global).

## Review Focus

- **Quoted descriptions containing commas** must parse correctly, e.g. `"ONLINE PAYMENT, THANK YOU"` (Task 1 test).
- **A line or bill is used by at most one match.** Exact matches first, then suggestions only from what's left (Task 1 test).
- **Ties between equal amounts** pick the closest date, so two $51.22 Costco charges must not both match one bill (Task 1 test).
- **Credit-reduced bills:** a payment matches a bill's `cardDue`, not its gross amount (Task 1 test).
- **`addedOn`** in the future, or not a valid date, is rejected with 400 (Task 2 test).

---

### Task 1: CSV parsing and matching (pure)

**Files:**
- Create: `shared/utils/reconcile.ts`
- Test: `test/reconcile.test.ts`

**Interfaces:**
- **Types:**
  - `StatementLine { id: string, status: string, date: string /* ISO */, description: string, amountCents: number /* charge > 0, credit < 0 */, kind: 'charge' | 'refund' | 'payment' }`
  - `ReconcileBill { id: number, name: string, amountCents: number, addedOn: string, cardPaidAt: string | null, cardDueCents: number }`
  - `ReconcileRefund { id: number, billId: number, amountCents: number, refundedOn: string }`
- **`parseCitiCsv(text: string): { lines: StatementLine[], from: string, to: string }`**
  - Header-checked: throws `Error('Not a Citi CSV…')` unless the header is `Status,Date,Description,Debit,Credit`.
  - The parser is quote-aware.
  - `id` is the row index.
  - `kind` is `payment` when the description starts with `ONLINE PAYMENT`, otherwise `refund` for credits and `charge` for debits.
- **`storeKey(description: string): string`**
  - Uppercase.
  - Drops a leading `WWW `, `SPI*`, `DD *`, `SQ *`, `TST* `.
  - Cuts at the first `*`, `#` or digit run, and keeps the first 2 words. So `AMAZON RETA* …` and `AMAZON MKTPL*…` both become `AMAZON`, and `WWW COSTCO COM …` becomes `COSTCO COM`.
- **`daysApart(a: string, b: string): number`**
- **`findSubset(items: { id: string | number, cents: number }[], target: number, min: number, max: number): (string | number)[] | null`**: exact-sum search bounded by `max` size, preferring fewer items.
- **`matchCharges(lines, bills, refunds, windowDays = 5)`** returns:
  - `exact: { lineIds: string[], billId: number }[]`
  - `refunds: { lineId: string, refundId: number }[]`
  - `suggestions: { lineIds: string[], billId: number }[]`
  - `leftoverLines: string[]`
  - `leftoverBills: number[]`

  It works in this order:
  1. Exact single matches. For each bill, closest date first, take an unused charge with the same amount within the window.
  2. Refund lines to recorded refunds by amount within the window.
  3. Split suggestions. For each unmatched bill, take unmatched charges within the window, grouped by `storeKey`, and run `findSubset(…, bill.amountCents, 2, 4)`.
  4. A line used by one suggestion isn't offered in another.
- **`matchPayments(lines, bills, windowDays = 5)`**: the same shape with payments, using card-paid bills only and the `|amount|` of the payment against `cardDueCents`, sized 2–6.
  - It returns `exact`, `suggestions`, `leftoverLines` and `leftoverBills`, with `lineIds` holding a single id and a `billIds` array for payments.
  - For payments the shape is `{ lineId: string, billIds: number[] }`.

- [ ] **Step 1: Write failing tests in `test/reconcile.test.ts`**

Build small fixtures that mirror the real file's shapes:
- **parse:** a header row, `Cleared,09/01/2026,"WWW COSTCO COM ISSAQUAH WA",51.22,`, `Cleared,09/09/2026,"ONLINE PAYMENT, THANK YOU",,-21.21` and `Cleared,09/18/2026,"WWW COSTCO COM ISSAQUAH WA",,-51.22`.
  - Expect three lines with `amountCents` of 5122, -2121 and -5122, and kinds charge, payment and refund.
  - Expect `from` `2026-09-01` and `to` `2026-09-18`.
  - A wrong header throws.
- **storeKey:** both Amazon descriptors give `AMAZON`, and the Costco descriptor gives `COSTCO COM`.
- **exact matching with a tie:** two 51.22 Costco charges on 9/1 and 9/2, and one bill of 51.22 added 9/2. The bill matches the 9/2 line, and the 9/1 line is left over.
- **split suggestion:** Amazon 75.00 on 9/7 and 25.00 on 9/8, with an Amazon bill of 100.00 on 9/7. One suggestion, with lines [75, 25].
- **refund match:** a refund line of -51.22 on 9/18 and a recorded refund of 5122 on 9/18. It goes to `refunds`.
- **payment exact and combined:**
  - A payment of 21.21 on 9/9 matches a bill with `cardDueCents` 2121 paid 9/8.
  - A payment of 305.35 is suggested as two bills with `cardDueCents` 27468 and 3067, both paid 9/8.
- **cardDue:** a bill with amount 32000 and `cardDueCents` 2000 paid 9/8 matches a 20.00 payment, not 320.00.
- **findSubset:** returns `null` when no exact sum exists, and prefers the 2-item answer over a 3-item one.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/reconcile.test.ts`
Expected: FAIL. The module isn't found.

- [ ] **Step 3: Implement per the Interfaces block**

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/reconcile.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** with the message `feat: Citi CSV parsing and reconcile matching`.

### Task 2: Server support

**Files:**
- Create: `server/api/reconcile.get.ts`
- Modify: `server/services/bills.ts`, `server/api/bills/index.post.ts`
- Test: `test/reconcile.test.ts` (service section)

**Interfaces:**
- `listForReconcile(from: string, to: string): Promise<{ bills: ReconcileBill[], refunds: ReconcileRefund[] }>`
  - Shared-card bills (`paidWithCardOf` is null) whose `addedOn` is within `[from − 5, to + 5]`, or whose `cardPaidAt` date is within that range.
  - `cardDueCents` comes from `cardDue`.
  - Refunds come with `refundedOn` within the same range.
- `GET /api/reconcile?from=&to=` validates ISO dates and returns the above.
- `POST /api/bills` accepts an optional `addedOn` (ISO date, not after `todayIso()`). Anything else returns 400.

- [ ] **Step 1: Failing tests**
  - `listForReconcile`:
    - includes a bill added inside the range;
    - includes a bill added outside the range but card-paid inside it;
    - excludes a different-card bill;
    - computes `cardDueCents` for a credited bill;
    - includes refunds in range.
  - `createBill` with `addedOn` keeps that date.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/reconcile.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit** with the message `feat: reconcile data endpoint and dated bill creation`.

### Task 3: Reconcile page

**Files:**
- Create: `app/pages/reconcile.vue`
- Modify: `app/layouts/default.vue` (add the nav item `{ label: 'Reconcile', icon: 'i-lucide-scale', to: '/reconcile' }` after Reimbursements)
- Modify: `app/components/RefundModal.vue` (optional props `initialAmountCents?: number`, `initialDate?: string`, used to prefill when present)

**Interfaces:**
- Consumes the Task 1 functions and types, the Task 2 endpoint, `POST /api/bills { name, amountCents, addedOn }`, `PUT /api/bills/:id/card`, and RefundModal.
- **Page state, all in memory:**
  - `lines`, `bills`, `refunds`;
  - a `matches` list of `{ kind: 'auto' | 'confirmed' | 'manual', lineIds, billId }`;
  - `paymentMatches`;
  - `ignored: Set<string>`;
  - `history` for Undo of manual charge assignments.

**Layout and behavior,** following the prototype `.superpowers/brainstorm/41296-1792912819/content/reconcile-v5.html` and the spec:
1. **Upload card:** a file input or drop zone with the note "Read in your browser, never uploaded or saved". After parsing, it shows the statement range and a "Start over" button.
2. **Summary bar:**
   - matched automatically;
   - needs you;
   - statement total (charges plus refunds, payments excluded);
   - app total (bills in the file range minus refunds in range);
   - Off by, the leftover lines sum minus the leftover bills sum, green at 0.
3. **Suggestions:** Confirm and Not this for split charges.
4. **Leftovers,** two columns:
   - **Lines:** draggable, click to select, Pending badge. Charge lines offer Add as new bill and Ignore. Refund lines offer a "Record refund on…" `USelect` of bills in range with a refundable amount left, which opens RefundModal prefilled.
   - **Bills:** drop targets that show piece chips with × and "$X of $Y · $Z to go", turning green when exact. A bill with no pieces offers "Mark paid with different card", a `UDropdownMenu` of users.
   - **Undo.**
5. **Matched (N):** a collapsible list with × Unmatch.
6. **Card payments section:**
   - exact and suggested payment matches with Confirm;
   - leftover payments, each with a checklist of unmatched card-paid bills that sums to "$X of $Y";
   - "Payments off by".

After any data-changing action, refetch `/api/reconcile` and run the matching again, keeping any `confirmed` and `manual` matches whose ids still exist.

- [ ] **Step 1: Build the page and the nav item, and add the RefundModal prefill props**

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm test && npm run build`
Expected: all exit 0.

- [ ] **Step 3: Browser check** with a synthetic CSV written to the scratch directory, never the user's file:
  - an Amazon 75/25 split;
  - a Costco duplicate tie;
  - a refund;
  - a combined payment;
  - an unmatched charge.

  Check upload, the auto matches, Confirm, drag and click assignment, ×, Undo, Unmatch, Add as new bill, Record refund prefill, and Mark paid with different card, in light and dark mode. Delete the test data afterwards.

- [ ] **Step 4: Commit** with the message `feat: reconcile page`.
