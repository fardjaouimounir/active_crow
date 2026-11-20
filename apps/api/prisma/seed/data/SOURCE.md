# Source of the reference data

`wilayas.json` (69 rows) and `communes.json` (1,541 rows) implement Algeria's administrative
divisions after **Law 26-06 (Journal Officiel n° 25 of 5 April 2026)**.

|                      |                                                                                                                                                                                                                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source               | [`geoalgeria`](https://www.npmjs.com/package/geoalgeria) **2.4.1** (npm, published 2026-10-30), repository https://github.com/yasserstudio/geoalgeria. Its metadata states it is "updated for the 2026 reform (Law 26-06, JO No. 25, April 5, 2026)".                                    |
| Files used           | `data/wilayas.json`, `data/communes_w1_w23.json`, `data/communes_w24_w48.json`, `data/communes_w49_w69.json`                                                                                                                                                                             |
| Fields kept          | Wilayas: `code` → `id`, `name_ar` → `nameAr`, `name_en` → `nameEn`. Communes: `code_commune` (zero-padded to 4 digits) → `code`, `wilaya_code` → `wilayaId`, `name_ar` → `nameAr`, `name_fr` → `nameEn` (Latin-script official name; the dataset has no separate English commune names). |
| Fields dropped       | Coordinates, OpenStreetMap relation ids, Wikidata ids, postal codes, dairas, Algérie Poste data.                                                                                                                                                                                         |
| Retrieved            | 2026-11-20, `npm pack geoalgeria@2.4.1 --ignore-scripts`; it is **not** a dependency of this project.                                                                                                                                                                                    |
| Checks at extraction | 69 wilayas with codes 1–69; 1,541 unique commune codes; every wilaya's `communes_count` matches the number of its communes. 108 communes belong to a 2026 wilaya while keeping their historical code prefix, which is why `communes.code` is stored separately from `wilaya_id`.         |

## Licence

geoalgeria uses mixed terms per part. The part used here — "the compilation of wilayas, dairas,
communes, their bilingual names, postal codes and administrative codes" — is under the **MIT
License**, which permits redistribution with the copyright notice below. The parts under other
terms (ODbL 1.0 OpenStreetMap-derived coordinates, boundaries and OSM/Wikidata ids; Algérie Poste
data) were **not** copied.

```
MIT License

Copyright (c) 2025-2026 Yasser's studio (https://yasser.studio)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
