# Reconcile Page Design

## Intent

Once a month, Tim and Kelly check the shared Citi card against the app. Today that's line-by-line by eye, and a CSV hunt when the totals don't agree. Three things make it hard:
- stores split one purchase into several charges (Amazon $100 shows up as $75 + $25);
- one card payment from the joint account sometimes covers several bills;
- refunds, and bills that went on a personal card by mistake.

The Reconcile page takes a Citi CSV export, matches every line it can, suggests the tricky combinations for a person to confirm, and makes the leftovers easy to resolve by hand.

The approved clickable prototype is at `.superpowers/brainstorm/41296-1792912819/content/reconcile-v5.html` (local only, not committed).

## Goals

- **Page and file:** one **Reconcile** nav link and one page, CSV only.
- **No saved state:** every visit starts fresh, and the CSV is **never stored**, not on the server and not in the browser.
- **Statement format:** parse the Citi export as it is today: header `Status,Date,Description,Debit,Credit`, dates as MM/DD/YYYY, charges positive in Debit, credits negative in Credit, and quoted descriptions that may contain commas.
- **What gets compared:** shared-card bills dated within the file's date range, plus a **±5 day** window *(builder's call)*.
  - Bills marked "Paid with different card" are left out.
- **Three kinds of statement line:**
  - **Charge:** a Debit.
  - **Payment:** a Credit whose description starts with `ONLINE PAYMENT`.
  - **Refund:** any other Credit.
- **Automatic exact matches:**
  - a charge to a bill with the same amount, closest date first, each used at most once;
  - a refund line to a recorded refund with the same amount whose date is within the window;
  - a payment to one bill whose card was paid within the window and whose card amount (after any credit) equals the payment.
- **Suggestions the person confirms,** never applied automatically:
  - **Split charges:** 2–4 unmatched charges from the same store (by a normalized store name), within the window, that add up exactly to one unmatched bill.
  - **Combined payments:** one payment equal to the card amounts of 2–6 unmatched card-paid bills paid within the window.
  - Each suggestion has **Confirm** and **Not this**.
- **Leftovers, side by side:** unmatched statement lines on the left, unmatched bills on the right.
  - **Drag** lines onto a bill, or click lines and then click the bill.
  - A bill lists the lines on it as chips, each with **×** to send it back, and shows "$X of $Y · $Z to go". It turns green when the pieces add up exactly.
  - **Undo** steps back through drops and removals.
- **Matched list:** a collapsed "Matched (N)" section lists every pairing, automatic, confirmed or manual. **× Unmatch** sends both sides back to the leftovers.
- **Actions that change data,** only when a button is pressed:
  - **Record refund:** shown when a refund line is paired with a bill. It opens the existing Record Refund window with the amount and date filled in.
  - **Mark paid with different card:** shown on a leftover bill with no Citi line. It uses the existing endpoint.
  - **Add as new bill:** shown on a leftover charge. It creates a bill with the store text as the name, the amount and the line's date.
  - **Ignore:** shown on a leftover line. It hides the line for this visit only and changes no data.
- **Summary bar:**
  - lines matched automatically;
  - items that still need you;
  - statement total (charges minus refunds, payments excluded);
  - app total (shared-card bill amounts in range minus recorded refunds in range);
  - **Off by**: the gap between the leftover statement lines and the leftover bills, green at $0.00.

## Non-goals

- A manual check-off tab (the user dropped it).
- Saving any reconciliation result, or marking bills "reconciled".
- Other banks' or cards' CSV formats.
- Matching that spans more than one CSV.

## Anti-goals

- Applying any combination match or changing data without an explicit click.
- Sending or persisting the file. Parsing happens **in the browser**. The server only supplies bills and refunds for the date range.

## Constraints

- Nuxt 4, Nuxt UI 4.12, the existing APIs, Vitest. No new dependencies; the CSV parsing is hand-written.
- The matching logic is pure and lives in `shared/utils/`, with unit tests that use cases shaped like the provided file: the Costco split, the Amazon split, the 9/09 combined payment, and the Costco refund.
- It reuses the existing Record Refund window, the paid-with endpoint and bill creation.
- Native drag and drop, plus a click-to-select fallback that works with the keyboard.

## Open to the builder

- How the store name is normalized:
  - drop prefixes like `WWW`, `SPI*`, `DD *`, `SQ *`;
  - keep the leading words;
  - collapse store numbers.
- How suggestions are ranked when several exist.
- The exact layout, following the prototype and the app's existing styles.
- Whether Add as new bill uses the Bills page quick-add path or the API directly.

## Decisions from the builder check (all *builder's calls*)

1. **Two sections: charges, and card payments.**
   - **"Charges & refunds"** holds the charge-to-bill matching, the drag-and-drop leftovers, Undo, and the main **Off by** (charges and refunds only).
   - **"Card payments"**, a second section below, matches `ONLINE PAYMENT` lines to card-paid bills: exact single matches, then combined-payment suggestions.
     - For a leftover payment, you tick bills from a checklist of unmatched card-paid bills until they add up exactly ("$X of $Y"). It has no drag and no Undo; unticking does the same job.
     - It has its own "Payments off by".
     - A card-paid bill with no payment line, or a payment with no bills, stays listed there.
   - A bill can be matched once in each section.
2. **Refund lines are not dropped onto bills.** A leftover refund line gets **Record refund on…**, a select listing every shared-card bill in range (matched or not) that still has a refundable amount.
   - Choosing a bill opens the existing Record Refund window with the amount and date filled in.
   - Once saved, the page matches again and that line pairs with the new refund automatically.
   - Until then it counts as unresolved in Off by.
3. **`POST /api/bills` accepts an optional `addedOn`** (an ISO date, not in the future) so Add as new bill keeps the statement date. The Bills page keeps sending no date.
4. **New read-only endpoint `GET /api/reconcile?from=YYYY-MM-DD&to=YYYY-MM-DD`.** It returns:
   - shared-card bills added within the range ±5 days, or card-paid within the range ±5 days;
   - refunds with `refundedOn` within the range ±5 days.
   It never receives the CSV.
5. **Mark paid with different card** opens a small menu with each household member, the same choice as in the edit window.
6. **Pending lines are included**, marked with a "Pending" badge.
