# Nuxt UI Refinement Design

## Intent

Bring the existing household bills app back toward the official Nuxt UI dashboard look and interaction quality without changing its layout. The app remains a top-navigation, table-first tool for two people to add bills, track each transfer, pay the shared card, manage recurring items, and settle reimbursements.

## Goals

- Preserve the current page structure: top navigation, month controls, quick-add form, summary cards, filters, and tables.
- Use Sky as primary, Mist as neutral, Figtree as the loaded sans font, and Lucide icons.
- Default a first visit to light mode while offering light, dark, and system choices.
- Keep Bills through Reimbursements on the left of the header; keep search, theme, and user controls on the right.
- Match Nuxt UI's dashboard language: bordered default surfaces, restrained elevation, consistent radius and spacing, clear focus states, compact table hierarchy, and responsive behavior.
- Preserve keyboard-first bill entry: focus bill name on dashboard load, Tab to amount, Enter to submit.
- Preserve and clarify real-time split recalculation when the total or one person's share changes, including the intentional round-up rule.
- Make payment states and available actions easier to distinguish.

## Non-goals

- No sidebar, dashboard shell replacement, page reordering, new routes, database changes, API changes, or new dependency.
- No speculative reporting, budgeting, notification, or multi-household features.
- No redesign of authentication screens beyond inherited global theme changes.

## Constraints

- Reuse Nuxt UI 4.12 components and its installed `@nuxt/fonts` and `@nuxtjs/color-mode` module dependencies.
- Keep existing authorization, payment rules, split arithmetic, and live-update behavior unchanged.
- Keep layout usable on mobile and preserve accessible labels and visible keyboard focus.

## Approaches

1. CSS-only reskin: smallest diff, but would leave header controls, font loading, theme selection, focus flow, and table semantics inconsistent.
2. Existing layout plus Nuxt UI theme and micro-flow refinement: selected. It fixes the visual system and the named interactions while preserving product structure.
3. Replace the layout with the Nuxt UI dashboard shell: rejected because it introduces the sidebar/multi-column structure the user explicitly does not want.

## Design

Global Nuxt UI configuration owns the shared surface and table treatment so recurring, reimbursements, search, and bills remain cohesive without page-by-page wrappers. Nuxt Fonts explicitly resolves Figtree from the existing module dependency. Color mode defaults to light and persists the user's later choice.

The header keeps its present top-bar structure. The app name becomes visible beside the logo, navigation remains left-aligned, and search, the built-in light/dark/system selector, connection signal, and user menu remain right-aligned. Admin mode stays available without becoming the dominant visual control.

The dashboard keeps the current month header and quick-add form. The name input remains the initial focus target; DOM order preserves Tab to amount and Enter submission. Summary cards gain consistent bordered surfaces and Lucide cues. The existing table receives the shared dashboard table treatment, clearer hover/selection states, and concise payment labels.

`SplitFields` keeps using the tested `splitAmounts` utility on every input update. Its helper text will state that the other share recalculates immediately and that a one-cent round-up is intentional when needed.

## Acceptance

- Existing layout and routes remain recognizable and structurally unchanged.
- First visit renders light; light, dark, and system are selectable and persisted by Nuxt color mode.
- Figtree is resolved by Nuxt Fonts; Sky, Mist, and Lucide remain active.
- Dashboard keyboard path is name → amount → submit.
- Split changes remain real-time and the round-up explanation is visible.
- Bills, recurring, reimbursements, search, and settings inherit a cohesive visual system.
- Tests, typecheck, build, and browser checks pass in light and dark desktop views plus a narrow viewport.

