# Refund Credits and Different-Card Bills Design

## Intent

Tim and Kelly each pay their share of a bill by moving money from a personal account into the joint RTP account. "Pay Card" means the joint account paid that line on the Citi card. When something they already paid for is returned, the store refunds the Citi card. Today the app has no record of that refund.

Real example: a Costco rug was bought, both shares and the card were paid, then it was returned and refunded to the card. A replacement rug was added and paid normally. At month end their totals didn't match the card, and there was no obvious way to "even out". Each of them had paid half of something they no longer had, and the refund sat on Citi as a credit that can't be withdrawn.

The fix is to treat a refund as a **credit that gets used up by a later bill**. You each deposit that much less for the next bill, and the joint account pays Citi that much less. The app records every adjustment where it happened, so nobody has to remember "I put $7.50 less in", and the Citi statement can be matched line by line, months later if needed.

Approved mockup: `.superpowers/brainstorm/29563-1792908215/content/refund-credits.html` (local reference, not committed).

A second, related case is folded in. Sometimes a bill is added and both shares are paid, but the purchase actually went on someone's **personal** card, not the shared Citi card. Today the person who paid moves the whole bill amount out of the joint account to cover their card. That part works fine and stays outside the app. But the bill then sits in "Ready for Card" forever, inflates the card totals, and has no matching Citi line.

## Goals

- Record a refund against the original bill: amount (partial allowed) and the date it hit the card.
- Turn the refund into credits: a **card credit** for the full amount, and a **credit for each person** split in the same proportion as the original bill's shares.
- Credits carry across months until used. Refunds often land in a different month from the purchase.
- When a new bill is added that is big enough to absorb a credit, a **popup** offers to apply it. Applying reduces each person's deposit and the card payment for that bill.
- Make every adjustment **visible on the table**, this month and in history:
  - On the refunded bill: "↩ Refunded −$X".
  - On the bill that used the credit: "◎ −$X credit", with per-person "Paid $10 + $150 credit" breakdowns.
  - Hovering either tag points to the other bill.
- A small "Credits available" note above the table while any credit is unused, opening a credits history: each refund, where it was used, and the remaining balance.

- Mark a bill **"Paid with different card"** and choose whose card it was. The Card column then shows a gray "Tim's card" tag instead of Pay Card, and the bill drops out of every card total, card tab and card email.

## Non-goals

- **Refunds for purchases never entered in the app.** The users called this human error. The workaround is to add the purchase as a bill, then record the refund.
- Card statement import or reconciliation (still deferred).
- **Emails.** Recording a refund and applying a credit send no email (the users asked for quiet). Live updates still refresh other open tabs.
- Withdrawing refund money from the joint account.
- Applying one credit across several bills, or several credits to one bill in one step.
- Tracking the joint-account withdrawal for a different-card bill (the users said this isn't needed).

## Anti-goals

- Anything that needs someone to remember an off-app adjustment. Every reduced deposit or card payment must be written on the bill it affected.
- Silent automatic application. A person always confirms in the popup.
- Rewriting the history of the refunded bill. Its original amount and payments stay intact. It is tagged, not edited.

## Constraints

- Nuxt 4, Nuxt UI 4.12, Drizzle/MySQL, existing services in `server/services/bills.ts`, live updates via the `bills` topic, Vitest. No new dependencies.
- Add a new Drizzle migration. Existing bill rules (`canEditBill`, `canMarkCardPaid`, payment authorization, admin mode) keep working.
- Money is integer cents.
- **Credit split:** in proportion to the original bill's stored participant shares, not `splitAmounts` (which rounds up). Use largest-remainder rounding so per-person credits add up **exactly** to the refund. A full refund of a bill whose stored shares add up to a cent more than the amount returns the refund amount, not the over-collected cent. *Builder's call.*

## Design

### Data

A **refund** belongs to one original bill and has:
- the amount,
- the date it hit the card,
- who recorded it,
- once applied: the bill it was applied to, and when.

Each refund has **per-person credit shares** (user and amount) that add up to the refund amount. The card credit equals the refund amount.

The builder chooses the table and column names, following the existing schema style.

### Recording a refund

- **Entry point:** a "Record Refund" item reached from the bill's "…" button (the edit modal, or a small menu, at the builder's discretion).
- **When it's offered:** only when the bill is no longer editable (`canEditBill` is false, meaning someone has paid). An unpaid bill should just have its amount edited instead. *Builder's call.*
- **Amount:** prefilled with the remaining refundable amount, which is the bill amount minus earlier refunds on it. It can be lowered for a partial refund. A bill can have several partial refunds up to its total.
- **Date:** defaults to today, editable.
- **Preview:** the card credit and each person's credit before saving.
- **Who can record:** any signed-in user, the same as adding bills.
- **Undo:**
  - An unapplied refund can be deleted.
  - An applied refund can be unapplied only while the bill it was applied to has no payments yet.
  - *Builder's call.*

### Applying a credit

- **When the popup appears:** after a new bill is created through the Bills page quick-add (not recurring generation, since nobody is there to answer). The app looks for the **oldest unused refund** that the new bill can fully absorb:
  - the bill amount is at least the card credit, and
  - each person's new share is at least their credit.
- **What the popup shows** (mockup section 2):
  - which refund the credit comes from,
  - the credit applied,
  - what each person deposits,
  - what the joint account pays Citi.
- **Apply Credit** links the refund to the new bill. **Not now** leaves the credit unused for a later bill.
- **Applying later:** a credit that was skipped can also be applied from the credits history to any unpaid bill that can absorb it.
- **One credit per bill.** A bill can carry at most one applied credit, ever. A second partial refund goes to another bill. This keeps "one place to look" and makes the tag show a single source. *Builder's call.*
- **$0 shares:** if applying makes someone's amount due $0, their share is marked paid automatically at that moment, shown as "Paid $0 + $X credit". Normal card-ready rules (and the existing Card Ready email) then apply as usual. *Builder's call.*

### Changing a bill that carries a credit

- **Editing:** if its amount or split is edited while unpaid, the credit is **removed and goes back to unused** (the edit modal says so before saving). The popup logic can then offer it again. This never blocks the edit. *Builder's call.*
- **Deleting:** the credit returns to unused. The refund's link to the applied bill uses `on delete set null`. Deleting the *original* refunded bill is already impossible once it's paid (`canDeleteBill`), so refunds cascade with it only in theory. *Builder's call.*

### Effect on payments

For a bill with an applied credit:
- **Each person's amount due** is their share minus their credit. The Pay button shows the reduced amount. Paying records the share as paid, and the status shows the breakdown "Paid $10 + $150 credit".
- **The card amount due** is the bill amount minus the card credit. "Pay Card" works as today, and the status shows "Paid $20 + $300 credit".
- **Totals use the reduced amounts:** "You Still Owe", the other person's amount, "Card Unpaid", "ready to pay", tab counts, the totals footer, and bulk pay. Those totals are what actually moves between accounts.
- **Total This Month** stays the sum of bill amounts (spending added), unaffected by refunds. *Builder's call.*

### Paid with different card

- **Where:** an option on the bill, from the same "…" entry point. Pick a person, "Paid with Tim's card" or "Paid with Kelly's card". It can be cleared again (back to the shared card).
- **When:** available on any bill, paid or not. People's shares stay payable as normal, because the share still goes into the joint account and the cardholder takes it out themselves.
- **Effect:**
  - The Card column shows a soft gray "Tim's card" tag instead of Pay Card, Paid or the dash. The tag's instant tooltip, opening above, reads "Paid with Tim's personal card; not on the shared Citi card".
  - The bill counts in **no** card figure: Card Unpaid, ready to pay, the Card Unpaid and Ready for Card tabs and counts, bulk "Pay Selected Card", "Pay Card for All", the totals footer card math, or the Card Ready email.
  - It still counts in Total This Month and in each person's owed amounts.
- **Interaction with refunds:**
  - Refunds can't be recorded on a different-card bill, because the money goes back to a personal card, not Citi.
  - Credits can't be applied to one, because a Citi credit can't reduce a personal-card charge.
  - The popup skips such bills.
  - *Builder's call.*
- **Data:** a nullable "paid with card of user" on the bill. Exact shape is the builder's call.

### Table and history

- **Tags:**
  - Refunded bill: a red "↩ Refunded −$X" tag next to the name, and its Amount and Each struck through when fully refunded. A partial refund shows the tag only.
  - Bill using a credit: a purple "◎ −$X credit" tag.
- **Tag tooltips** are instant, open above, and name the other bill and the date. Clicking a tag goes to that bill's month.
- **"Credits available" note:** shown above the table when unused credits exist, e.g. "Credits available · You $150 · Kelly $150 · Card $300". It opens the credits history, which lists every refund with its source bill, date, amount, status (unused, or applied to which bill), and the apply and undo actions.
- **Search:** results show the same tags.

### Colors

Purple for credit, red for refunded, both as soft badges matching the existing status pills, with readable dark-mode variants. Exact shades are the builder's call.

## Acceptance

- Rug scenario end to end:
  1. Record a $300 refund on the paid rug, which creates $300 card credit and $150 each.
  2. Add a $320 replacement, and the popup offers the credit.
  3. Apply it. Pay buttons show $10 each, Pay Card shows $20, and after paying, the statuses show the breakdowns.
  4. The October rug shows "Refunded −$300", and the November replacement shows "−$300 credit". The tooltips link them.
- A partial refund on a bill with an unequal custom split creates proportional credits that add up exactly.
- A credit stays unused after "Not now" and shows in the Credits note until applied.
- No emails are sent for refund actions. Other open tabs update live.
- Marking a fully paid bill "Paid with different card → Tim" removes it from Ready for Card and from every card total, shows the "Tim's card" tag, and sends no Card Ready email. Clearing the option restores it.
- Unit tests cover the credit split, the "can absorb" check, and the reduced amounts due. Service tests cover recording, applying, undo rules and authorization.
