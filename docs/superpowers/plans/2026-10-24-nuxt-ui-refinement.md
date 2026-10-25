# Nuxt UI Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Ledford Bills legible, comfortable, and consistent with the Nuxt UI Dashboard look (approved v3 mockup), add a light/dark/system toggle, left-align the nav, and restore the old bill-name autocomplete behavior.

**Architecture:** Shared visual decisions live in global config (`nuxt.config.ts`, `app/app.config.ts` `ui` slots, `app/assets/css/main.css` tokens), so pages inherit them. Bill tab filtering, counts and suggestion filtering are pure functions in `shared/utils/` with unit tests. Pages change markup only. No API, DB, or dependency changes.

**Tech Stack:** Nuxt 4, Vue 3, Nuxt UI 4.12, Tailwind CSS 4, Vitest

**Spec:** `docs/superpowers/specs/2026-10-24-nuxt-ui-refinement-design.md`
**Visual reference:** `.superpowers/brainstorm/94604-1792885294/content/bills-redesign-v3.html`. Open it in a browser and match its radii, spacing, depth, and status styles.

## Global Constraints

- Primary `sky`, neutral `mist`, Figtree 400/500/600/700, Lucide icons.
- First visit renders light; light/dark/system selectable and persisted.
- Desktop (1440px) is the target. Narrow viewport: no clipped controls, tables may scroll horizontally.
- No API, database, auth, or dependency changes. No sidebar.
- Keep authorization, payment rules, `splitAmounts` arithmetic, live updates, and the keyboard path (name autofocus, Tab to amount, Enter submits).
- Shadows ≤8% opacity. Every light-mode tint, shadow, and gradient has a `.dark` counterpart.
- Table cell text must not use the muted color. The bill name is semibold and highlighted.

## Review Focus

- A saved dark/system choice must survive reload instead of being reset to light (Task 1 browser step).
- Autocomplete Enter with no matches must submit the form; after Escape, Enter must submit a name that contains a suggestion ("Ren" vs "Rent") (Task 4 browser step).
- An empty month and an empty tab must show the table's empty state with a 0 badge, not an error (Task 3 unit test `tabCounts([])`, Task 4 browser step).
- Bill IDs in the selection must be pruned when switching tabs, so bulk actions don't act on hidden rows (Task 4 browser step).
- Partial decimal input in split fields ("12.") must stay editable while the other share recalculates (Task 7 browser step).

---

### Task 1: Global theme foundation

**Files:**
- Modify: `nuxt.config.ts`
- Modify: `app/app.config.ts`
- Modify: `app/assets/css/main.css`

**Interfaces:**
- Produces: global radius, depth, background, and table/card styling that every page inherits; `colorMode` light default. Later tasks rely on these CSS utility classes from `main.css`: `.surface-card` (rounded-2xl bordered card with the soft two-layer shadow, dark variant) and `.icon-tile` (44px rounded-xl sky gradient tile).

- [ ] **Step 1: Baseline the tests**

Run: `npm test -- test/shared.test.ts`
Expected: PASS.

- [ ] **Step 2: Configure color mode in `nuxt.config.ts`**

Add `colorMode: { preference: 'light', fallback: 'light' }`.

- [ ] **Step 3: Add global tokens to `main.css`**

- Set `--ui-radius: 0.625rem` in `:root`, so `rounded-lg` lands around 10px and `rounded-2xl` around 16px+.
- Add a body background with a faint sky gradient at the top (`light`: sky-50 to bg over about 220px; `.dark`: sky-950 at low opacity over mist-900).
- Define `.surface-card` and `.icon-tile` per the Interfaces block, each with a `.dark` variant (shadow replaced by `ring-1 ring-white/5`).

- [ ] **Step 4: Add `ui` slot overrides in `app/app.config.ts`**

- `table`: `td` uses `text-default py-3.5 px-5`; `th` uses `text-toned font-semibold bg-elevated/40 py-3 px-5`; the root has no outer border, because the card wraps it.
- `button`: default rounding unchanged; pills are applied per use with `rounded-full`.
- `badge`: `rounded-full`.
- `card`: root uses `surface-card`.
- `header`: root is translucent `bg-default/80 backdrop-blur` with a hairline shadow.

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm run dev`, then open `/` and `/reimbursements`.
Expected:
- Typecheck exits 0.
- Table text is visibly darker.
- Corners are rounder.
- Switching to dark through the browser devtools (`document.documentElement.classList`) shows no light halos.

Then, in DevTools, set localStorage `nuxt-color-mode` to `dark` and reload.
Expected: still dark.

- [ ] **Step 6: Commit**

```bash
git add nuxt.config.ts app/app.config.ts app/assets/css/main.css
git commit -m "feat: global theme foundation for comfortable dashboard look"
```

### Task 2: Header

**Files:**
- Modify: `app/layouts/default.vue`

**Interfaces:**
- Consumes: Task 1 header styling; existing `nav`, `adminMode`, `connected`, `userMenu`.

- [ ] **Step 1: Restructure `UHeader`**

- `#left`: `AppLogo` + visible "Ledford Bills" text (`font-bold`), then `<UNavigationMenu :items="nav" variant="link" />`, hidden below `lg`.
- Default slot: empty.
- Nav links are pills (`ui.link: 'rounded-full px-3'`).
- Remove the `sr-only` title span.

- [ ] **Step 2: Right-side controls**

- Order: search (pill `UInput`, `rounded-full`, trailing `UKbd` showing `⌘K`), `<UColorModeButton />` or `UColorModeSelect`, so all three of light/dark/system are reachable; then the admin toggle (unchanged), then the avatar menu.
- Use `defineShortcuts({ meta_k: () => searchInput focus })`.
- Move the live-connection dot onto the avatar using `UChip` (`color` success or warning, keep the tooltip text).

- [ ] **Step 3: Verify**

Run: `npm run typecheck`, then check the browser at 1440px and 400px.
Expected:
- At 1440px, nav sits left beside the name.
- ⌘K focuses search.
- The theme control cycles or selects light/dark/system.
- At 400px, the modal menu still has search and nav, with no overflow.

- [ ] **Step 4: Commit**

```bash
git add app/layouts/default.vue
git commit -m "feat: left-aligned nav, theme toggle, and search shortcut in header"
```

### Task 3: Bill view helpers (pure, tested)

**Files:**
- Create: `shared/utils/bill-view.ts`
- Test: `test/shared.test.ts`

**Interfaces:**
- Consumes: `BillLike`, `allParticipantsPaid`, `canMarkCardPaid` from `shared/utils/rules.ts`.
- Produces:
  - `export type BillTab = 'all' | 'mine' | 'card' | 'ready'`
  - `export const BILL_TABS: BillTab[]`
  - `export function isBillTab(v: unknown): v is BillTab`
  - `export function billInTab(bill: BillLike, tab: BillTab, userId: number): boolean`:
    - `mine` means the user has an unpaid participant row.
    - `card` means `!cardPaidAt`.
    - `ready` means `canMarkCardPaid`.
  - `export function tabCounts(bills: BillLike[], userId: number): Record<BillTab, number>`
  - `export function readyForCardCents(bills: BillLike[]): number`, the sum of `amountCents` where `canMarkCardPaid`.
  - `export function filterSuggestions(names: string[], query: string, limit = 10): string[]`: case-insensitive substring match on the trimmed query, keeping input order. An empty query returns the first `limit`.

- [ ] **Step 1: Write failing tests in `test/shared.test.ts`**

Add `import { billInTab, filterSuggestions, isBillTab, readyForCardCents, tabCounts } from '../shared/utils/bill-view'`.

```ts
describe('bill view', () => {
  const p = (userId: number, paid: boolean) => ({ userId, amountCents: 500, paidAt: paid ? '2026-10-01' : null })
  const bills = [
    { amountCents: 1000, cardPaidAt: null, participants: [p(1, false), p(2, true)] },
    { amountCents: 2000, cardPaidAt: null, participants: [p(1, true), p(2, true)] },
    { amountCents: 3000, cardPaidAt: '2026-10-02', participants: [p(1, true), p(2, true)] }
  ]
  it('counts tabs', () => {
    expect(tabCounts(bills, 1)).toEqual({ all: 3, mine: 1, card: 2, ready: 1 })
    expect(tabCounts(bills, 2)).toEqual({ all: 3, mine: 0, card: 2, ready: 1 })
    expect(tabCounts([], 1)).toEqual({ all: 0, mine: 0, card: 0, ready: 0 })
  })
  it('filters by tab', () => {
    expect(bills.filter(b => billInTab(b, 'ready', 1))).toEqual([bills[1]])
    expect(isBillTab('ready')).toBe(true)
    expect(isBillTab('nope')).toBe(false)
  })
  it('sums ready-for-card', () => {
    expect(readyForCardCents(bills)).toBe(2000)
  })
  it('filters suggestions keeping order', () => {
    const names = ['Rent', 'Food Lion', 'Current', 'Netflix']
    expect(filterSuggestions(names, 'ren')).toEqual(['Rent', 'Current'])
    expect(filterSuggestions(names, '  FOOD ')).toEqual(['Food Lion'])
    expect(filterSuggestions(names, '')).toEqual(names)
    expect(filterSuggestions(Array.from({ length: 15 }, (_, i) => `n${i}`), 'n')).toHaveLength(10)
    expect(filterSuggestions(names, 'zzz')).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- test/shared.test.ts`
Expected: FAIL. The imports aren't defined.

- [ ] **Step 3: Implement `shared/utils/bill-view.ts` per the Interfaces block**

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- test/shared.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/utils/bill-view.ts test/shared.test.ts
git commit -m "feat: bill tab and suggestion helpers"
```

### Task 4: Bills page

**Files:**
- Modify: `app/pages/index.vue`

**Interfaces:**
- Consumes: Task 3 helpers (auto-imported from `shared/utils`); Task 1 `.surface-card`, `.icon-tile`.

- [ ] **Step 1: Data and tabs**

- Fetch `/api/bills` with only `{ month }`.
- `tab = computed(() => isBillTab(route.query.tab) ? route.query.tab : 'all')`, with `setTab(t)` doing `router.replace` with `tab: t === 'all' ? undefined : t`.
- Remove the `userUnpaid`/`cardUnpaid` query handling.
- `rows` sorts the bills already filtered by `billInTab`.
- Prune `selected` to visible rows when `tab` changes.

- [ ] **Step 2: Tab bar inside the table card**

- Wrap the tab bar and `UTable` in one `div.surface-card overflow-hidden`.
- Use `UTabs` with `:content="false"`, `variant="pill"`, and items `[{ label: 'All', value: 'all', badge: counts.all }, { label: \`${myName} unpaid\`, value: 'mine', ... }, { label: 'Card unpaid', value: 'card' }, { label: 'Ready for card', value: 'ready' }]`.
- Badges are small, `rounded-full`, neutral soft; the active one is primary soft.
- Bulk-selection actions sit on the right of the tab bar.

- [ ] **Step 3: Stat cards**

- Use three `.surface-card` blocks with an `.icon-tile` each: `i-lucide-sigma` for Total this month, `i-lucide-user-round` for {Me} still owes, `i-lucide-credit-card` for Card unpaid.
- Stats always use the whole month (`bills`, not `rows`), and the selection mode and copy-on-click stay as today.
- Under the card-unpaid value or label, add `"{formatMoney(readyForCardCents(bills))} ready to pay"` in primary text.

- [ ] **Step 4: Status cells**

- Paid: `UBadge color="success" variant="soft" icon="i-lucide-check"` showing "Paid".
- My unpaid share: `UButton size="sm" class="rounded-full"` (solid primary) labeled "Pay".
- Other person unpaid: in admin mode, the existing "Mark paid" button (`rounded-full`); otherwise `UBadge color="warning" variant="soft"` showing "Waiting".
- Card column:
  - Done: the Paid badge.
  - `canMarkCardPaid`: `UButton variant="outline" size="sm" class="rounded-full"` labeled "Pay card".
  - Otherwise: `<span class="text-dimmed">—</span>`.
- Name cell: `font-semibold text-highlighted`.
- Date cell: `text-toned`.
- Column headers: "Each" (was "Each/Split"), "{First}" (was "{First} Paid"), "Card".

- [ ] **Step 5: Autocomplete**

- Keep `UInputMenu`, now with `v-model:search-term`, `ignore-filter`, `:items="filterSuggestions(suggestions, searchTerm)"`, `:trailing-icon="false"` (or an empty `trailing` slot), `open-on-focus`, and `create-item` off.
- Keep `form.name` in sync with the search term so free text submits.
- Enter behavior per the spec:
  - While the list is open and has matches, Enter selects the highlighted match, or the first match.
  - With no matches, or after Escape, Enter submits the form.
- If `UInputMenu` can't meet this, switch to a `UInput` plus a `UPopover` listbox with the same keys. Keep `aria-label="Bill name"` and `autofocus`.

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npm test -- test/shared.test.ts`, then check in the browser (dev user `tim@example.com` / `DevPassword123`, sign-in code from Mailpit at `http://localhost:8025`).

Expected:
- **Visual:**
  - The page matches v3.
  - Tab badges show counts, and an empty tab shows 0 and the empty message.
  - `?tab=ready` survives reload.
- **Selection:** select a row, then switch to a tab that hides it. Bulk actions disappear.
- **Autocomplete and keyboard:**
  - Type "re" and Rent is highlighted. Enter fills "Rent", and Tab moves to the amount.
  - Type "Ren", press Escape, then Enter: a "Ren" bill is created (after entering an amount).
  - With "zzz" + amount, Enter submits.
- **Other behavior:** Pay, Pay card, Mark paid in admin mode, inline edit and sorting still work.

- [ ] **Step 7: Commit**

```bash
git add app/pages/index.vue
git commit -m "feat: comfortable bills dashboard with tab filters and clear payment states"
```

### Task 5: Reimbursements tabs

**Files:**
- Modify: `app/pages/reimbursements.vue`

**Interfaces:**
- Consumes: existing `/api/reimbursements?resolved=&page=&sort=&dir=` returning `{ items, total, pageSize }`; Task 1 `.surface-card`.

- [ ] **Step 1: Replace the "Show completed" switch with tabs**

- Use `UTabs` `:content="false"` `variant="pill"` with Open [n] / Completed [n].
- The active tab drives `resolved`, as the switch did.
- The other tab's count comes from a second `useFetch('/api/reimbursements', { key: 'reimbursements-other', query: { resolved: !resolved, page: 1 } })` reading `.total`. Refresh both after any action.

- [ ] **Step 2: Wrap the tabs and table in `.surface-card overflow-hidden`; make the name cell `font-semibold text-highlighted`**

- [ ] **Step 3: Verify**

Run: `npm run typecheck`, then check the browser.
Expected:
- The counts match the rows.
- Mark Sent / Confirm Received update both counts.
- Pagination still works.

- [ ] **Step 4: Commit**

```bash
git add app/pages/reimbursements.vue
git commit -m "feat: reimbursements open/completed tabs with counts"
```

### Task 6: Recurring, Search, Settings consistency

**Files:**
- Modify: `app/pages/recurring.vue`, `app/pages/search.vue`, `app/pages/settings.vue`

**Interfaces:**
- Consumes: Task 1 `.surface-card`.

- [ ] **Step 1: Apply the system to each page**

- **Recurring:** table in `.surface-card overflow-hidden`; name cell `font-semibold text-highlighted`; day cell `text-toned`.
- **Search:**
  - The chart container's `rounded-lg bg-elevated/60` becomes `.surface-card p-5`.
  - The table goes in `.surface-card overflow-hidden`.
  - Status badges use `icon` like Bills: Settled `success` + check, Card due `primary`, Unpaid `warning`.
- **Settings:** each section in `UCard`, which inherits `surface-card`.

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm run build`, then check each page in light and dark.
Expected: exit 0, and the pages look consistent with Bills.

- [ ] **Step 3: Commit**

```bash
git add app/pages/recurring.vue app/pages/search.vue app/pages/settings.vue
git commit -m "feat: apply dashboard surfaces to recurring, search, and settings"
```

### Task 7: Browser acceptance

**Files:**
- Modify only files from Tasks 1–6 if the browser checks expose a defect.

- [ ] **Step 1: Full gate**

Run: `npm test && npm run typecheck && npm run build`
Expected: all pass, exit 0.

- [ ] **Step 2: Walk the spec's Acceptance list in the browser**

Check light and dark at 1440px, and light at 400px.

Split fields check: open the Edit modal on an unpaid bill and type "12." into Tim's share.
Expected:
- The field keeps "12.".
- Kelly's share updates on each keystroke with no lag.
- The total helper text stays correct.

- [ ] **Step 3: Commit fixes, if any**

```bash
git commit -am "fix: browser acceptance corrections"
```
