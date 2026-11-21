# Prompt 17C — screenshots

Viewport screenshots (not full page) of the running app against the **showcase agency** data
(`npm run seed:showcase`). One file per view × language × theme:

`<view>-<en|ar>-<dark|light>.png`

| View | Role | Route |
| --- | --- | --- |
| `dashboard-director` | Director | `/app/dashboard` |
| `dashboard-supervisor` | Supervisor | `/app/dashboard` |
| `campaign-overview` | Director | `/app/campaigns/<id>` |
| `campaign-field-tab` | Director | `/app/campaigns/<id>?tab=field` |
| `attendance-queue` | Director | `/app/attendance` |
| `announcements` | Director | `/app/announcements` |
| `campaigns-list` | Director | `/app/campaigns` |
| `portal-campaign` | Client | `/portal/campaigns/<id>` |
| `field-today` | Animateur (390×844) | `/field` |

## How they were taken

`scripts/shot.sh <outDir> name=email@/path,lang,theme,WxH[,scrollY] …` drives headless Chrome over the
DevTools protocol (no extra dependency, see `scripts/screens.mjs`). It signs in with the showcase
accounts (password = `DEMO_PASSWORD`), sets the language and theme, and captures the viewport.
`SCREENS_TIME_OFFSET_HOURS` shifts the page clock so relative times ("12 min ago") read naturally
when the data was generated for a later time of day than it is now.

## Showcase accounts (password = `DEMO_PASSWORD`)

| Role | Email |
| --- | --- |
| Director | `director@showcase.test` |
| General manager | `gm@showcase.test` |
| Regional managers | `regional.centre@showcase.test`, `regional.est@showcase.test` |
| Supervisors | `supervisor.alger@`, `supervisor.oran@`, `supervisor.est@`, `supervisor.sud@showcase.test` |
| Clients | `client.nedjma@showcase.test`, `client.nour@showcase.test` |
| Animateur | `amina.benali@showcase.test` (and 27 more, see `apps/api/prisma/seed/showcaseData.js`) |

## UI UX Pro Max review (checklist applied to every view)

- **Accessibility** — every icon-only control has an accessible name; status is icon + text + tone,
  never colour alone; charts have a text alternative (data table or labelled `img`); focus is
  visible and the scroll container keeps focused controls clear of the sticky bars
  (`scroll-padding-top`); the keyboard queue ignores keystrokes typed in fields and dialogs.
- **Touch and targets** — filter chips, buttons and row actions are ≥ 24 px (chips 32 px); row
  actions that appear on hover are always visible on touch devices (`hover: none`).
- **Layout** — one scroll container (the main column); the top bar and sidebar never move; tabs do
  not wrap (they scroll sideways on narrow screens); no horizontal page scroll at 390 px.
- **Hierarchy** — three surface levels; section titles and hairlines instead of a card around
  everything; one primary button per view (in the review queue only the focused card's Accept is
  primary).
- **Typography and numbers** — tabular figures; thin-space thousands (`1 500 000 DA`, `1 500 000 دج`;
  in Arabic a no-break space so the digit groups stay one number inside right-to-left text);
  percentages with one decimal; `—` when there is no figure.
- **Motion** — 150 ms transitions for tabs, drawers and dialogs; disabled by `prefers-reduced-motion`.
- **RTL** — logical properties only, mirrored arrows, charts keep time left-to-right.
