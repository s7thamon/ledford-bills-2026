# Nuxt UI Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine the existing Ledford Bills interface toward the Nuxt UI dashboard benchmark without changing its layout.

**Architecture:** Keep the existing Nuxt pages and server behavior. Put shared visual decisions in Nuxt/UI configuration, then make narrow header and dashboard markup changes that reuse built-in Nuxt UI components and the existing split utility.

**Tech Stack:** Nuxt 4, Vue 3, Nuxt UI 4.12, Tailwind CSS 4, Vitest

**Spec:** `docs/superpowers/specs/2026-10-24-nuxt-ui-refinement-design.md`

## Global Constraints

- No sidebar or page-layout replacement.
- Primary `sky`, neutral `mist`, Figtree, and Lucide.
- Default first visit to light with light/dark/system choices.
- No API, database, route, or dependency changes.
- Preserve authorization, payment rules, live updates, and split arithmetic.

## Review Focus

- A saved dark/system choice must survive navigation and reload instead of being reset to light.
- The dashboard must not steal focus after the user intentionally focuses another control during hydration.
- Mobile header controls must stay reachable without overflowing the viewport.
- Table rows must retain keyboard focus and selection behavior after visual overrides.
- Custom split inputs must remain editable as partial decimal strings while recalculating the other share.

---

### Task 1: Global theme foundation

**Files:**
- Modify: `nuxt.config.ts`
- Modify: `app/app.config.ts`
- Modify: `app/assets/css/main.css`

**Interfaces:**
- Produces: global Figtree loading, light-first color mode, and shared Nuxt UI surface/table tokens.
- Consumes: existing `@nuxt/ui` module dependencies; no new package.

- [ ] **Step 1: Verify the existing shared split tests before visual changes**

Run: `npm test -- test/shared.test.ts`

Expected: all existing money, split, date, and rule tests pass.

- [ ] **Step 2: Configure existing Nuxt module dependencies**

Set `colorMode.preference` and `colorMode.fallback` to `light`. Configure Nuxt Fonts to resolve Figtree weights 400, 500, 600, and 700 from Google using the installed `@nuxt/fonts` dependency.

- [ ] **Step 3: Add the shared Nuxt UI treatment**

Keep `sky` and `mist`; add minimal table slot classes for a bordered default surface, subtle elevated header, and compact dashboard spacing. Add only global CSS tokens that cannot live in component config.

- [ ] **Step 4: Verify configuration and generated types**

Run: `npm run typecheck`

Expected: exit 0 with no TypeScript errors.

- [ ] **Step 5: Commit the theme foundation**

Commit: `feat: refine Nuxt UI theme foundation`

### Task 2: Header look and theme flow

**Files:**
- Modify: `app/layouts/default.vue`

**Interfaces:**
- Consumes: Nuxt color-mode integration from Task 1 and the existing `nav`, `adminMode`, `connected`, and `userMenu` state.
- Produces: visible brand label and right-aligned search/theme/user flow without changing routes.

- [ ] **Step 1: Refine the existing `UHeader` markup**

Show “Ledford Bills” beside `AppLogo`, preserve navigation order on the left, and use Nuxt UI's built-in color-mode selector on the right. Keep mobile header navigation and search available through the current modal body.

- [ ] **Step 2: Reduce utility-control prominence**

Keep admin mode and connection state available with accessible labels, but visually subordinate them to search, theme, and user identity.

- [ ] **Step 3: Verify header compilation**

Run: `npm run typecheck`

Expected: exit 0 with no component prop or menu-item errors.

- [ ] **Step 4: Commit the header refinement**

Commit: `feat: refine top navigation controls`

### Task 3: Dashboard and split micro-flow polish

**Files:**
- Modify: `app/pages/index.vue`
- Modify: `app/components/SplitFields.vue`

**Interfaces:**
- Consumes: `splitAmounts(totalCents, userIds, locked?)` and existing create/pay/edit actions.
- Produces: dashboard-style summary/table visuals, preserved name → amount → Enter path, and clearer real-time split guidance.

- [ ] **Step 1: Refine dashboard surfaces without moving sections**

Keep the month/header form, three-stat grid, filter controls, and table in their current order. Apply the shared surface language and add Lucide cues to summary cards and payment states.

- [ ] **Step 2: Preserve keyboard-first creation**

Keep `autofocus` on the bill-name input, amount immediately after it in DOM order, and the existing form submit on Enter. Do not add custom keyboard handlers.

- [ ] **Step 3: Clarify split behavior without changing arithmetic**

Keep recalculation in `SplitFields.lock()` and amount-driven re-splitting in bill/recurring edit modals. Update helper copy so immediate recalculation and intentional round-up are explicit.

- [ ] **Step 4: Verify split behavior and full application**

Run: `npm test -- test/shared.test.ts && npm run typecheck && npm run build`

Expected: all tests pass; typecheck and production build exit 0.

- [ ] **Step 5: Commit dashboard polish**

Commit: `feat: polish bill dashboard flow`

### Task 4: Browser acceptance pass

**Files:**
- Modify only files from Tasks 1–3 if browser evidence exposes a defect.

**Interfaces:**
- Consumes: completed theme, header, and dashboard changes.
- Produces: verified desktop/mobile and light/dark interaction evidence.

- [ ] **Step 1: Start the existing local app and sign in with seeded development data**

Run: `npm run dev`

Expected: local Nuxt URL serves successfully.

- [ ] **Step 2: Exercise the named flows in the browser**

Verify Bills → Reimbursements navigation, search/user alignment, light/dark/system selection, name autofocus, Tab to amount, Enter submit, bill edit amount re-split, manual share re-split, table payment actions, and narrow viewport behavior.

- [ ] **Step 3: Run the final clean gate**

Run: `npm test && npm run typecheck && npm run build`

Expected: all tests pass; typecheck and build exit 0.

- [ ] **Step 4: Commit browser-found corrections, if any**

Commit only fixes required by browser acceptance; skip this commit when no source changes were needed.

