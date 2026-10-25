# Nuxt UI Refinement Design

## Intent

Ledford Bills is a household bills tracker for two people (Tim and Kelly) who share a joint bank account and a credit card. Bills are paid on the card; each person pays their share (an even split by default, adjustable per bill), and once both have paid, the card payment for that bill can be made. Recurring bills, personal reimbursements, and email notifications are part of the app.

The rebuilt Nuxt app drifted from its design reference and is harder to read than it should be. The table text is uniformly muted gray, payment states and actions are tiny and low-contrast, the header navigation is centered, there is no theme toggle, and the bill-name autocomplete from the old Flux app (`ledford-bills-flux_old`) feels missing. The goal is a legible, comfortable, modern interface that follows the Nuxt UI Dashboard template's visual language (Sky primary, Mist neutral, Figtree, Lucide) without adopting its sidebar layout.

Both users work at a computer about 99% of the time. Desktop is the design target.

## Goals

- **Legibility first.** Bill names, amounts, and payment states read at a glance; nothing important uses the muted text color.
- **Comfortable, not flat, not boxy.** Generous spacing, rounded corners, and subtle depth (soft shadows, faint gradients), kept tasteful. Approved visual reference: `.superpowers/brainstorm/94604-1792885294/content/bills-redesign-v3.html` (the user confirmed v3 "feels comfortable now").
- **Header:** brand (logo + "Ledford Bills") and navigation on the left; search, theme toggle, admin toggle, and user menu on the right.
- **Light/dark/system toggle**, light by default on first visit, choice persisted.
- **Bill-name autocomplete** behaves like the old app (see below).
- **One cohesive system** across Bills, Recurring, Reimbursements, Search, and Settings.

## Non-goals

- Card reconciliation (manual check-off and CSV matching). Designed in brainstorming, then deferred by the user to a later project.
- Sidebar layout or dashboard-shell replacement.
- A dedicated phone layout. Phone width must stay usable (no clipped controls, tables scroll horizontally) but is not designed for.
- Database, API, or auth changes. No new dependencies.
- Login/verify/password screens beyond inheriting the global theme.

## Anti-goals

- Decoration that hurts legibility: heavy shadows, saturated gradients behind text, low-contrast "elegant" gray text.
- Cramming: the user explicitly rejected the squished, boxy v2.
- Dark mode as an afterthought: every shadow, tint, and gradient needs a dark counterpart that doesn't turn into muddy halos.

## Constraints

- Nuxt 4, Nuxt UI 4.12, Tailwind 4. Reuse Nuxt UI components and its bundled `@nuxt/fonts` and `@nuxtjs/color-mode` modules.
- Keep existing authorization, payment rules, split arithmetic (`splitAmounts`), live updates, and keyboard-first bill entry (focus name on load, Tab to amount, Enter submits).
- Prefer global theme configuration (`app.config.ts` `ui` slots, `--ui-radius`, CSS tokens in `main.css`) over per-page class overrides, so every page inherits the look.

## Design

### Global visual system

- Colors: primary `sky`, neutral `mist` (unchanged). Figtree 400/500/600/700 already loads; keep it.
- Corner rounding: raise `--ui-radius` so cards and the page frame land around 16px and inputs/buttons around 10–12px (v3). Nav links, header search, filter tabs, and inline row actions (Pay, Pay card) are full pills.
- Depth (v2/v3):
  - The header is slightly translucent with a backdrop blur and a hairline shadow.
  - The page background has a faint sky-to-white gradient at the top.
  - Cards and the table card get a soft two-layer shadow at ≤8% opacity.
  - Stat icon tiles and primary buttons get a light gradient with a top highlight.
- Spacing (v3): roomier page padding and gaps between sections; table cells roughly `py-3.5 px-5`; taller header.
- Table text: cell text uses the default text color, not muted. The primary column (bill name) is `font-semibold` with the highlighted color. Dates stay a quieter tone but darker than today's muted. Header row has a faint background.

### Header

- Left: logo + visible "Ledford Bills" text, then the navigation (Bills, History ▾, Recurring, Reimbursements), using the `UHeader` left slot rather than the default, centered slot.
- Right: pill search input with a ⌘K hint (keyboard shortcut focuses it), color-mode toggle (light/dark/system), admin-mode toggle (unchanged behavior), avatar menu. The live-connection dot moves into the avatar (small status indicator) or the menu.
- Mobile keeps the existing modal menu with search and vertical nav.

### Theme

- `colorMode` preference and fallback set to `light` so a first visit is light; a later choice (dark or system) persists across reloads and navigation.

### Bills page

- Month header with prev/next, quick-add form (name autocomplete, amount, New) on the same row, as today.
- Three bordered stat cards with icon tiles: Total this month, {Me} still owes, Card unpaid. The card stat also shows the amount ready to pay now (bills where everyone has paid but the card hasn't).
- The table sits inside a card. Above it, a tab bar replaces the "Filter by" pills: **All**, **{Me} unpaid**, **Card unpaid**, **Ready for card**. Each tab ends in a small rounded count badge (the user asked for "little [2] style numbers"). The active tab badge is sky-tinted.
- Status cells:
  - Paid shows as "✓ Paid" in a soft green pill.
  - My unpaid share is a solid primary **Pay** pill button.
  - The other person unpaid shows "Waiting" in a soft yellow pill, or a **Mark paid** action in admin mode, as today.
  - The card column shows **Pay card** (outline pill) only when everyone has paid, "✓ Paid" when done, and an em dash otherwise (replacing the repeated "Not Fully Paid").
- Data: fetch the whole month once (existing `/api/bills?month=`, no filter params). Tabs, counts, and "ready to pay" are computed in the browser. The active tab lives in the URL query (`?tab=mine|card|ready`), so it survives reload. The old combined "my unpaid AND card unpaid" view goes away. It was redundant anyway, because a bill I haven't paid can't have its card paid. *Builder's call.*
- Stats always reflect the whole month regardless of tab. Selection mode stays exactly as today: selected rows switch the first two cards to "Selected total" and "Selected unpaid for {Me}", and those cards copy the amount on click. *Builder's call.*
- Existing behavior stays: row selection with bulk actions, inline rename/amount edit, sorting by Added/Amount/Each, edit modal, custom-split indicator.

### Bill-name autocomplete

Old app behavior (`ledford-bills-flux_old/resources/views/pages/⚡bills.blade.php`, around lines 103 and 865):
- Suggestions are bill names used more than once, ordered by use count, then by name. The server already returns this list from `/api/bills/suggestions`.
- Filtering is a plain case-insensitive substring match that keeps that order.
- Show the top 10.
- The list opens on focus, and so on page load because the field is autofocused. The first match is highlighted when it opens.
- Arrow keys move the highlight.
- While the list is open and anything matches, Enter picks the highlighted match, or the first match if none is highlighted. With no matches, Enter submits the form.
- Escape closes the list, so a new name that contains an existing one ("Ren" vs "Rent") can then be submitted with Enter.
- Picking a suggestion only fills the name. Tab still moves to amount.
- Typing a new name is always allowed.

*Builder's call:* match the old app exactly, since the request was to restore its behavior.

The current `UInputMenu` must be configured or replaced (still a Nuxt UI component) so it keeps that order rather than fuzzy re-ranking. It should look like a text field, not a dropdown: no trailing chevron.

### Split fields

The user's lag complaint came from the old Livewire app round-tripping each keystroke. The new `SplitFields` already recalculates in the browser. Keep it, and confirm in the browser that typing in one share updates the other instantly without rewriting the field being typed in.

### Other pages

- **Recurring:** table in a card, same text and status treatment (type badge, Active switch).
- **Reimbursements:** table in a card. The "Show completed" switch becomes tabs: Open [n] / Completed [n].
- **Search:** chart and table each in a card.
- **Settings:** sections in cards.

### Dark mode

Every token above has a dark counterpart: shadows become subtle borders or low-opacity black, the gradient becomes a faint sky tint on the Mist-900 background, and the status pills use dark-friendly soft variants. Verify contrast in both modes.

## Acceptance

- Nav is left-aligned beside the visible app name; search, theme, admin, and user controls are on the right.
- First visit renders light; light, dark, and system are selectable and persist across reload.
- Table names, amounts, and statuses are visibly darker and heavier than today in both themes.
- Bills page matches v3: rounded, roomy, subtle depth, tab filters with count badges, clear Pay / Waiting / ✓ Paid / Pay card states.
- Autocomplete matches the old behavior above.
- Keyboard path on Bills: name focused on load, Tab to amount, Enter submits.
- Split recalculation is instant in the edit modal.
- All pages share the system. Phone width has no clipped controls.
- `npm test`, `npm run typecheck`, `npm run build` pass. Browser check in light and dark at 1440px plus one narrow viewport.
