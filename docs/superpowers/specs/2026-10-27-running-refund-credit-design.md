# Running Refund Credit Design

## Intent

A refund on the shared Citi card never comes back to the joint checking account. It sits on Citi as a negative balance. The only way to use it is for the joint account to pay Citi less on later shared-card bills, while Tim and Kelly each deposit that much less.

Today (see `2026-10-25-refund-credits-design.md`) a refund becomes one credit that a single later bill must absorb whole: the bill must be at least the card credit and each share at least that person's credit. A $3,000 refund ($1,500 each) therefore waits for a $3,000+ bill, which may never come. The only bill that size is usually the mortgage, which is paid directly from the joint account and never touches Citi, so applying the credit there would be wrong. Today nothing stops that.

This change turns refunds into a **running credit**: each later shared-card bill takes a **bite** until the credit is used up, with a visible counter showing what's left. It also closes the Paid Directly gap and replaces the "paid with personal card" option with an admin delete that spells out exactly how to settle the money by hand.

Approved mockup: `.superpowers/brainstorm/77320-1793081094/content/running-credit.html` (local reference, not committed). It shows the counter and history, the confirm popup, and the admin delete confirmation.

## Goals

- A refund credit is used up across as many later shared-card bills as it takes, never needing one bill big enough for all of it.
- Accurate to the cent: on every bill, the card reduction equals the sum of the deposit reductions, and each person's reduction comes out of their own share of the credit, so uneven splits stay uneven all the way through.
- A running counter of what's left, and a history of every bite.
- Only bills that actually go on Citi can take a bite. Check bills, Paid Directly bills (the mortgage), and the refund's own source bill never do.
- An admin-only delete of a paid bill (the "it actually went on my personal card" mistake) with a confirmation that spells out exactly what each person adds and what to withdraw, and returns any bite to the credit.
- Remove the "paid with personal card" option entirely. It was never used.

## Non-goals

- Moving money. The app never transfers anything; people do it by hand and the app records or instructs.
- Emails for any of this. Live updates still refresh other open tabs.
- Automatic bites without confirmation (see anti-goals).
- Recurring-bill generation taking bites by itself. Nobody is there to confirm. Those bills can take a bite later from the credits history.
- Admin delete for other mistakes (a duplicate bill, a wrong amount). The confirmation is worded for the personal-card case only.

## Anti-goals

- Anything that leaves an adjustment only in someone's memory. Every reduced deposit or card payment is written on the bill it affected; every by-hand settlement is spelled out on screen at the moment it's needed.
- Silent application. A person always confirms a bite.
- Card and deposit reductions that differ, even by a cent. That makes the joint account drift.
- A bite on any bill that doesn't go on Citi.
- Rewriting the refunded bill. Its amount and payments stay intact; it's tagged.

## Constraints

- Nuxt 4, Nuxt UI 4.12, Drizzle/MySQL, Vitest, existing services (`server/services/bills.ts`, `server/services/refunds.ts`, `shared/utils/credits.ts`, `shared/utils/rules.ts`). No new dependencies. Money is integer cents.
- New Drizzle migration(s). Existing applied credits must carry over unchanged.
- Admin mode is the existing per-session toggle (`session.adminMode`, set by `server/api/admin-mode.put.ts`).
- Paid Directly is the Settings name list (`getDirectPayNames()`, case-insensitive name match); it is not a column on the bill.
- Reconcile already uses `cardDue` (bill amount minus credit) to match card payments. It must keep working with bites.

## Design

### Words used here

- **Refund:** money a store put back on Citi, recorded against the original bill. Unchanged: amount, date, who recorded it, and per-person **refund shares** that add up exactly to the amount (largest-remainder split of the original bill's stored shares, as today).
- **Credit left** on a refund: per person, their refund share minus everything already bitten from it. Card credit left = sum of the people's credit left. This is the invariant that keeps card and deposits equal.
- **Bite:** the part of the running credit one bill uses. Recorded per refund, per person: "bill B took $X of Tim's credit from refund R". The bill's card reduction is the sum of all its per-person bite amounts.

### How a bite is sized

For a shared-card bill with shares `s_i`:

1. Walk unused refunds oldest first (by refunded date, then id).
2. For each person, take `min(their credit left on this refund, what's still uncovered of their share)`. Move to the next refund if a person's share is still not covered and credit remains elsewhere. A single bite can span two (or more) refunds, recorded as separate pieces under each refund.
3. Card reduction = sum of all pieces.
4. **Penny cap:** shares can add up to a cent more than the bill amount (equal split rounds up). The card reduction must never exceed the bill amount. If the pieces would add to more than the bill amount, trim the excess from the piece(s) of the person whose share was rounded up, so pieces sum to at most the bill amount. That person then deposits the cent. *Builder's call on the exact tie rule; it must be deterministic and tested.*
5. Each person deposits `share − their pieces`. The joint account pays Citi `bill amount − card reduction`.

Example from the mockup, near the end of a credit: $90 left (Tim $45, Kelly $45), new $200 bill ($100/$100). Bite $45 each, card reduction $90, deposits $55 each, Citi $110, credit left $0.

A bill takes a bite **once**. If it already has a bite (even a partial one because the credit ran low), it can't take more until the bite is removed. *Builder's call.*

### Which bills can take a bite

All of these must hold:
- Goes on Citi: not Check (`paidByCheck` false) and its name is not on the Paid Directly list.
- Not the source bill of the refund being bitten from. (If walking refunds would bite from a bill's own refund, skip that refund for that bill.)
- No real money paid yet: no share marked paid and card not paid. Same as today's apply rule.
- No existing bite.

### Confirm popup (after quick-add)

Unchanged trigger: after a bill is created through the Bills page quick-add, if credit is left and the new bill qualifies (Paid Directly names are checked here too), show the popup (mockup section 2):
- Title "Use Refund Credit?".
- Which refund(s) it comes from and the credit left before this bill. When it uses all that's left, say so ("This bill can use all of it"); otherwise show "Credit left after".
- Bill amount, credit used, each person's deposit with the math (`$100.00 − $45.00`), what the joint pays Citi, credit left after.
- An amber note: "**Paying this bill by check?** Choose Not Now. Credit only works on bills that go on the Citi card."
- Buttons: **Not Now** and **Use $X Credit**.
- Shares fully covered by the bite are marked paid automatically, as today ("Paid $0 + $X credit"), and the existing card-ready logic runs.

### Running counter and credits history

- The "Credits available" button above the bills table becomes **"◎ Credit left · You $A · Kelly $B · Card $C"** while any credit is left, and "Refund history" otherwise (as today).
- The credits history (mockup section 1) lists each refund with: source bill and dates, total, **$ left of $ total**, a progress bar, and a table of bites: bill name and date (links to that bill's month), Tim's piece, Kelly's piece, card piece, credit left after that bite.
- **One "Use on a bill" control at the top of the history** (not one per refund) while any credit is left: it picks any qualifying bill **this month** and takes a bite sized as above, walking refunds oldest first like the popup. The apply endpoint becomes bill-level rather than per refund. *My call, from the builder check.*
- Per bite row: **Remove** while that bill still has no real money paid and card not paid. Removing a bite removes all its pieces for that bill (across refunds), unmarks shares that were auto-paid because the bite covered them, and the credit becomes available again.
- **Delete** a refund only when nothing has been bitten from it.

### Bills table and search

- Bill with a bite: purple "◎ −$X credit" tag, X = card reduction. Tooltip names every source refund and date. Clicking goes to the source bill's month (first source if several).
- Refunded bill: red "↩ Refunded −$X" tag, unchanged.
- Pay buttons, Pay Card / Pay Account amount, "Paid $10 + $150 credit" breakdowns, You Still Owe, Card Unpaid, ready-to-pay, totals footer, bulk pay: all keep using `shareDue` and `cardDue` with the bill's total credit. Total This Month stays the sum of bill amounts.
- Search page shows the same tags.

### Changing a bill that has a bite

- **Editing amount or split** while no real money is paid: the bite is removed and goes back to the credit (today's behavior and edit-modal warning, reworded for "credit" rather than one refund). The popup isn't re-offered automatically; it can be applied from history. *Builder's call: re-offering is fine too.*
- **Switching to Check** while no real money is paid and card not paid: allowed. The bite is removed and returns to the credit, auto-paid shares are unmarked. Today this switch is blocked whenever a credit exists; that block is replaced.
- **Switching to Check after someone deposited real money:** blocked, with a message: "Someone already paid this bill with the credit taken off. Delete it (admin) and add it again as a check." *My call; rare.*
- **Bill name renamed onto the Paid Directly list,** or a name added to the list later: existing bites stay. *Builder's call.*

### Paid Directly

Treat Paid Directly bills like Check bills for everything credit-related:
- No "Record Refund" on them (server and UI).
- Never take a bite: popup skips them, history doesn't list them as targets, the server rejects them.
- No existing refunds or applied credits involve Paid Directly bills (confirmed), so the migration needs no special handling for them.
- This needs the direct-pay names in `recordRefund`, the bite service, `BillEditModal`'s `refundable`, `CreditsModal`'s targets and the quick-add popup check. How to share that check is the builder's call.

### Admin delete of a paid bill

For the mistake where a bill was entered as shared-card but actually went on someone's personal card, and the money was (or will be) settled by hand.

- **Who and when:** only in admin mode. Allowed when shares are paid (any or all). Blocked when the card was paid (Pay Card clicked); the joint account really did pay Citi then. Unpaid bills keep the normal delete for everyone, unchanged.
- **Shared-card bills only.** Not Check bills and not Paid Directly bills: the "withdraw to the card it went on" settlement only makes sense for a bill that was supposed to be on Citi. *My call, from the builder check.*
- **Refunds recorded on this bill:** unused ones are deleted with it. If anything was bitten from them, the delete is blocked with a message to remove those bites first.
- **The confirmation** (mockup section 3), titled "Delete {name}? · ${amount}", subtitle "Do this only after the money is settled by hand.":
  - **Shared account received** = sum of deposits actually made: for each person whose share is marked paid, `share − their bite`. Listed per person ("Tim deposited $75.00", or "Tim · not paid").
  - **Credit covered** = card reduction (bite total), shown only when there is a bite.
  - **To settle it,** numbered:
    - each person who still owes something, "{Name} adds **$X** to the shared account", where X = their full share minus what they deposited (so: their bite if they paid; their full share if they didn't);
    - last step, "Withdraw **${bill amount}** to the card it went on."
    - With no bite and both paid, the only step is the withdraw.
  - **Returned credit,** only when there is a bite: "Deleting returns **$X** to the {refund name} credit (Tim $a · Kelly $b)". Name each refund if the bite spanned more than one.
  - Buttons: **Cancel** and **It's Settled · Delete** (red).
- Worked examples that must render exactly:
  - $200 bill, bite $25/$25, both deposited $75: received $150; Tim adds $25, Kelly adds $25, withdraw $200; returns $50 (Tim $25 · Kelly $25).
  - Same bill, only Kelly deposited: received $75; Tim adds $100, Kelly adds $25, withdraw $200; returns $50.
  - $200 bill, no bite, both deposited $100: received $200; withdraw $200.
- Penny case: when shares add to a cent over the bill amount, the adds can total one cent more than the withdraw. That cent stays in the joint account, same as normal bills today. *Builder's call to leave as is.*
- On delete, bites are removed (credit returns) and the bill row is deleted, in one transaction.

### Removing "paid with personal card"

Never used, so remove it outright:
- Drop `bills.paid_with_card_of` in a migration.
- With only two choices left, the **Paid With select in the edit modal becomes a single "Paid by check" toggle** with a small check icon (requested in review). Off = shared card (default), on = check. Same enable/disable rules as the switch to Check above. The endpoint body becomes just `{ check: boolean }`. Icon choice (e.g. a Lucide banknote or receipt icon) is the builder's call.
- Remove the "Tim's card" tag, its tooltip, and every `paidWithCardOf` reference: `rules.ts` (`onSharedCard`), `bills.ts` (DTO, columns, `unpaidByMonth`, `setPaidWithCard`, reconcile queries), `server/api/bills/[id]/card.put.ts` body, `BillEditModal`, `index.vue`, `search.vue`, `CreditsModal`, and the tests.

### Data

- Replace "a refund is applied to one bill" (`refunds.applied_to_bill_id`, `applied_at`, the `refunds_applied_unique` index) with a **bite pieces** table: refund, bill (cascade on delete of either), user, amount, created at. Unique on (refund, bill, user). Names follow the existing schema style; builder's call.
- Migrate each existing applied refund into pieces (one per refund share, on its applied bill), then drop the old columns.
- `BillDto.credit` stays a `CreditLike` (`amountCents` = card reduction, `shares` = per-person totals) plus a list of sources (refund id, source bill name/added on, refunded on, amount). `shareDue` and `cardDue` keep working unchanged. `RefundDto` gains credit left (per person and card) and its bites.
- Taking a bite must be safe against two people applying at once: compute and insert in one transaction with row locks on the refunds involved (or an equivalent check that credit left never goes negative).

## Acceptance

- $3,000 refund, $1,500 each. Add a $212.48 bill: popup offers the full bill as a bite; after confirming, both shares show "Paid $0 + $106.24 credit", card due $0, counter shows $2,787.52 left (You $1,393.76 · Kelly $1,393.76).
- A bill when $90 is left ($45/$45) on a $200 bill: deposits $55 each, Citi $110, credit used up, counter changes to "Refund history".
- A bite spanning two refunds records pieces under each and the history shows both.
- Uneven refund split (e.g., Tim $300, Kelly $0): later equal-split bills bite only Tim's share.
- Penny cap: $59.99 bill split $30.00/$30.00 fully covered: card reduction is $59.99, not $60.00, and someone deposits $0.01.
- A Check bill, a Paid Directly bill (mortgage), and the refund's own source bill never take a bite and are never offered.
- No "Record Refund" on Check or Paid Directly bills.
- Switching an unpaid bill with a bite to Check returns the bite. After a real deposit, the switch is blocked with the delete-and-re-add message.
- Admin delete confirmation renders the three worked examples exactly; delete returns the bite; delete is refused when the card is paid or when the bill's own refund has been bitten.
- Existing applied credits look and behave the same after migration.
- No "personal card" option or tag anywhere; the column is gone.
- No emails; other tabs update live.
- Unit tests: bite sizing (oldest first, spanning, uneven, penny cap, never exceeding credit left), delete settlement numbers. Service tests: bite, remove, delete rules, Paid Directly and Check exclusions, concurrency guard, admin-only delete, migration of existing credits.
