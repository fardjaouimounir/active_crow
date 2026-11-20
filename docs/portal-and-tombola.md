# Client portal and verifiable Tombola draw (Prompt 15)

## Client view rules

A client user (`role = client`) reads only the campaigns of their own company in status `assigned`,
`active`, `suspended`, `completed` or `closed` (`CLIENT_CAMPAIGN_STATUSES`, applied inside
`campaignWhere` for the `client` scope). Everything else answers 404.

Allowed for a client (the director and general manager use the same endpoints for the preview):
`/portal/campaigns…`, `GET /tombolas/:id`, `…/draw/verification`, `…/winners` (masked) and
`POST /tombolas/:id/draw`. Every other endpoint is 404 or 403 for a client (route-walk test).

The client view contains totals only: KPIs, by day, by wilaya, by store, by product, gift totals and the
campaign-wide stock reconciliation totals. It never contains a breakdown by Animateur or supervisor,
a staff name, a coordinate, a customer name or phone (winners show initials and a masked phone), or
internal notes. Photos and documents are served only when their file is `client_visible` and the
campaign is in the client scope. Attendance photos can never be shared.

## Draw algorithm `hmac-sha256-fisher-yates-v1`

`packages/shared/src/tombolaDraw.js`, pure, identical in the API and the browser.

1. **List**: valid entry numbers, ascending, no duplicates.
2. **Commitment** `entries_hash`: SHA-256 (hex) of `"<n>\n"` for each number. A database trigger computes
   it, with `eligible_count` and `committed_at`, in the same statement that closes registration (manual
   close or the expiry job), so it exists before any draw and cannot change afterwards. From then on
   entries cannot be inserted, edited or deleted (`tombola_entries_frozen`); voiding a sale that has
   entries in a closed Tombola answers 409 `TOMBOLA_ENTRIES_FROZEN`.
3. **Seed**: SHA-256 (hex) of `serverRandom (32 bytes) || UTF-8 clientNonce || UTF-8 entries_hash`.
4. **Random stream**: `HMAC-SHA256(key = seed bytes, message = counter as 8 bytes big-endian)` read as an
   unsigned 64-bit integer; an index in `[0, bound)` uses rejection sampling (no modulo bias).
5. **Shuffle**: partial Fisher–Yates for `winners + reserves` picks. Picks `1..winners` are the winners
   (rank 1…), the next ones the reserves in order. With fewer entries than `winners + reserves` the
   reserves are shortened; fewer entries than winners is refused (`NOT_ENOUGH_ENTRIES`).

`server_random` is generated with `crypto.randomBytes(32)`, never logged, stored with the draw and
published by the verification endpoint after the draw. The client may add its own `clientNonce`.

The draw transaction locks the Tombola row, recomputes the list and refuses (500, error logged) if it
differs from the commitment, inserts the draw and winners, then sets `drawn`. One draw per Tombola is
enforced by the unique `tombola_id`; a trigger also refuses a draw that does not match the commitment.

## Verifying a draw

- Portal or agency page: **Verify in browser** downloads `GET /tombolas/:id/draw/verification` and runs
  `verifyDraw` locally (✓ or ✗). **Download draw data** saves that JSON.
- Command line: `npm run tombola:verify -- draw.json` recomputes and prints the winners; exit code 1 on
  a mismatch.

## Winners and delivery (E-15)

Director and general manager can mark a winner `delivered` (optional date) or `unreachable` (reason
required). An unreachable winner (or promoted reserve) gives the rank to the first unused reserve
(`serves_rank`, audited); no reserve left ⇒ 422 `NO_RESERVE_LEFT` and the winner stays pending.
Delivered and unreachable are final (`WINNER_ALREADY_FINAL`). Full contacts are read only with
`?personal=true`, audited as `tombola.winners_personal_read`.

## Known limits

- Only the entry list is committed before the draw. `server_random` is generated at draw time, so the
  proof shows the algorithm was applied to the committed list and to the client phrase, not that the
  server random was drawn blindly. Publishing `SHA-256(server_random)` at close is a possible next step.
- Voiding a sale with entries in a closed Tombola is refused (`TOMBOLA_ENTRIES_FROZEN`): the committed
  list cannot change. A mistaken sale must be handled by the director before registration closes.
- Draws created before this migration have no server random and cannot be verified (development data).
- Verification (browser and CLI) also compares the entry list with the commitment shown in the portal.
