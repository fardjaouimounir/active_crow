# Geographic data and map conventions (Prompt 17B)

## Boundary data

| Item | Value |
| --- | --- |
| Dataset | geoBoundaries **gbOpen**, Algeria (`DZA`), ADM1 |
| Release used | `https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/DZA/ADM1/geoBoundaries-DZA-ADM1.geojson` |
| Boundary ID | `DZA-ADM1-43142294` (year represented 2017, source data updated 2023-01-19, build 2023-12-12) |
| Original source | OpenStreetMap, Wambacher (`wambachers-osm.website/boundaries`) |
| **Licence** | **Open Data Commons Open Database License 1.0 (ODbL)**, © OpenStreetMap contributors |
| Downloaded | 2026-11-20 |
| Polygons | **48** (wilayas 01–48; the dataset predates the 2019–2021 creation of wilayas 49–69) |

The brief expected CC BY 4.0; the API record of this release says ODbL 1.0 (it is derived from OpenStreetMap),
so ODbL is what applies. ODbL needs attribution (shown on every map, see below) and share-alike for adapted
*databases*. The simplified file is itself shipped to browsers, so it is an adapted database: it lives with
`apps/web/src/assets/geo/LICENSE-ODbL.md` (source, changes, licence) and stays under ODbL. The other open geoBoundaries release
(`gbHumanitarian`, CC BY 3.0 IGO, UNHCR/GAUL 2020) also has 48 polygons, so it would not help with 69 wilayas.
No open dataset with all 69 wilayas was found; **no boundary is invented**.

### Processing (one time, `npx` only)

```
npx mapshaper geoBoundaries-DZA-ADM1.geojson \
  -simplify 4% keep-shapes \
  -each 'code=shapeISO.slice(3)' -filter-fields code \
  -o apps/web/src/assets/geo/dz-wilayas.json format=geojson precision=0.001
```

Result: `apps/web/src/assets/geo/dz-wilayas.json`, 48 features, property `code` only (`"01"`–`"48"`), ~160 KB
(~48 KB gzip; it is only loaded by the route chunks that draw a map). Names are **not** taken from the file: Arabic and English names come from our `wilayas` table,
matched by code, never by string.

## 69 wilayas on 48 polygons

`packages/shared/src/wilayaPolygons.js` (`WILAYA_POLYGON`, `POLYGON_WILAYAS`) maps each wilaya id to a polygon code.
Wilayas 1–48 own their polygon. The 21 newer wilayas are drawn inside the wilaya they were carved out of; the
choropleth tooltip lists them (“Includes: …”) and clicking the polygon filters by all of them.

| New wilaya | Polygon | New wilaya | Polygon |
| --- | --- | --- | --- |
| 49 Timimoun | 01 Adrar | 60 Barika | 05 Batna |
| 50 Bordj Badji Mokhtar | 01 Adrar | 61 El Kantara | 07 Biskra |
| 51 Ouled Djellal | 07 Biskra | 62 Bir El Ater | 12 Tébessa |
| 52 Béni Abbès | 08 Béchar | 63 El Aricha | 13 Tlemcen |
| 53 In Salah | 11 Tamanrasset | 64 Ksar Chellala | 14 Tiaret |
| 54 In Guezzam | 11 Tamanrasset | 65 Aïn Ouessara | 17 Djelfa |
| 55 Touggourt | 30 Ouargla | 66 Messaad | 17 Djelfa |
| 56 Djanet | 33 Illizi | 67 Ksar El Boukhari | 26 Médéa |
| 57 El M'Ghair | 39 El Oued | 68 Bou Saâda | 28 M'Sila |
| 58 El Meniaa | 47 Ghardaïa | 69 El Abiodh Sidi Cheikh | 32 El Bayadh |
| 59 Aflou | 03 Laghouat | | |

A test (`reporting/__tests__/geo.test.js`) checks that all 69 seeded wilaya ids map to a polygon that exists in
the committed file. The mapping follows the administrative parent of each new wilaya (a judgement of this
project, not part of the dataset): review it with the client's geography before printing it in a contract.

Polygon values are computed on the server from the raw per-wilaya totals (so shares such as conversion are
recomputed, not averaged).

## Colour scales (from tokens, never hard-coded)

* Sequential: **5 quantile classes** of the positive values shown (breaks at the 20/40/60/80th percentile,
  equal breaks collapse, so a few distinct values give fewer classes); zero or missing = "no data" fill.
  Tokens `--scale-1…5` (dark: near-black green to spring; light: pale green to a darker green).
* Change vs previous period: diverging 5 steps from the largest absolute change (|change| < 10 % of it = neutral,
  < 50 % = step 1, otherwise step 2). Tokens `--div-neg-2…--div-pos-2`.
* The token test checks that the scale steps are monotonic in lightness in both themes.

## Basemap and attribution

* Engine: MapLibre GL JS, lazy-loaded (`import('maplibre-gl')` inside `MapView`), never part of `/field`.
* Basemap: OpenFreeMap, keyless. Dark theme `https://tiles.openfreemap.org/styles/dark`, light
  `https://tiles.openfreemap.org/styles/positron`.
* If the style does not load in 8 s, or four tiles fail, the map switches to a plain background with the same
  choropleth layers and shows “The basemap could not be loaded”. Without WebGL an SVG map is used (keyboard
  operable; also the print snapshot).
* Attribution on every map: the style's own (OpenFreeMap, © OpenMapTiles, data © OpenStreetMap) plus
  “Boundaries © OpenStreetMap contributors (ODbL), via geoBoundaries”. The SVG maps print the boundary line.

### Content-Security-Policy additions (Prompt 16, Caddy)

```
connect-src  'self' https://tiles.openfreemap.org;
img-src      'self' data: blob: https://tiles.openfreemap.org;
worker-src   'self' blob:;
child-src    'self' blob:;
```

(`connect-src` covers the style JSON, TileJSON, vector tiles, glyphs and sprite JSON; `img-src` the sprite PNG and
the raster shaded-relief tiles; MapLibre runs its tile workers from a `blob:` URL.)

## Privacy

Maps show stores (and, in the attendance drawer, the single check-in point already visible there). They never
show a person's position or trail. Client endpoints return sales, buyers, conversion and gift distribution only,
and stores by name and wilaya; store coordinates are returned to the client so the pin can be placed on the
store map (they are a business location, not a person).
