# Dashboard visual review

## Before and after

| Area | Before | After |
| --- | --- | --- |
| Attendance | The showcase changed the campaign row to active without writing the activation to its history. Check-ins used the current campaign state and could be verified, while the expected-slot calculation used the historical state for each day. | Showcase activation goes through the lifecycle service at the simulated start. The regression checks the effective morning rule, all seven work days, the assignment dates and the daily active status with `expectedCheckpoints()`. It then posts and verifies a check-in through the attendance API. The one-store calculation is 1 verified ÷ 2 expected = 50%. |
| Interactive map | The lazy loader read a default export from MapLibre 6 and reported initialization errors as missing WebGL. | Named exports load with a same-origin Vite worker. The SVG fallback is used when WebGL 2 is unavailable. Initialization and basemap failures have separate handling, with diagnostic messages in development. |
| Choropleth | The map started at national scale and interpolated several ranges even when only a few values existed. | The map fits data-bearing wilayas with padding and offers a Whole country control. Small sets use discrete values in the legend. Larger sets use rounded percentile breaks. A fresh showcase includes stores in the north, High Plateaus and south across at least eight wilayas. |
| Filters | Multi-select list boxes and separate date fields consumed several rows. | Primary filters and the date range share a compact toolbar. Searchable choices, removable chips, a calendar with presets, More filters and Reset update the existing URL parameters. Controls and chips wrap on narrow screens. |
| Store rankings | The top and bottom tables repeated stores when the set was small. | Up to 20 stores appear once in a single sales-ranked table. Larger results retain the top and bottom tens. |
| Arabic charts | The date and hour axes reversed with the surrounding RTL layout. | Dates and hours increase from left to right. The surrounding Arabic interface remains RTL. |
| Scroll behavior | In the full-page screenshot, the top bar and sidebar appeared partway down the page. | In Chrome and Edge at roughly 1,350 px of document scroll, both elements remained at viewport y=0. The live behavior did not reproduce the screenshot issue. |

## UI UX Pro Max dashboard review

- **Filter interaction and reflow** · The dashboard uses one set of controls at every width. The chip collection wraps, search gives immediate results with an empty state, Escape returns focus to the filter button, and the calendar uses one day in the tab order with arrow-key navigation. Client uses a single choice to match the `clientId` URL parameter.
- **Geographic data** · The color scale has numeric labels and visible wilaya boundaries. The existing ranked list and View table control give users a text path to the same wilaya values.
- **Chronological reading order** · Chrome and Edge showed the Arabic chart dates 11‑16, 11‑18 and 11‑20 at increasing x positions. The 390 px viewport had no document overflow with the Wilaya popover open.
- **Sticky navigation** · The live Chrome and Edge checks kept the top bar and sidebar in place through a long scroll. The review used the production web build, simulated reporting responses and a headless WebGL context.
- **Worker delivery** · The map worker returned HTTP 200 under a same-origin worker CSP in both browsers. [MapLibre worker configuration](https://maplibre.org/maplibre-gl-js/docs/API/functions/setWorkerUrl/)

The seed's existing-data path repairs missing activation history when rerun. The additional store geography is generated on fresh showcase runs.

A disposable showcase run reported 78.1% attendance across eight wilayas. Demo Point de Vente 1 returned 72.7%, which matched 8 verified ÷ 11 expected. The run also exposed a session expiry when simulated fieldwork advanced beyond the real login time. The seed now renews access through the login service when needed, and records its example rejection before verifying the rest of that day's attendance.

`npm run verify` passed all 1,297 tests against the isolated PostgreSQL test database. The production web build passed.
