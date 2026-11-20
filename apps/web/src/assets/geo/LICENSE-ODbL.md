# dz-wilayas.json: source, licence and changes

`dz-wilayas.json` is a simplified adaptation of the **geoBoundaries gbOpen** release for Algeria (ADM1),
which is derived from **OpenStreetMap** (Wambacher boundaries extract).

- Original: https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/DZA/ADM1/geoBoundaries-DZA-ADM1.geojson
- Licence of the original: **Open Data Commons Open Database License (ODbL) 1.0**, https://opendatacommons.org/licenses/odbl/1-0/
- Attribution: **© OpenStreetMap contributors**, boundaries via geoBoundaries (William & Mary geoLab).

Changes made (2026-11-20): geometry simplified to 4 % of the vertices with mapshaper (`-simplify 4% keep-shapes`,
coordinates rounded to 0.001 degree), every property removed except `code` (the two-digit wilaya code taken from
`shapeISO`). The recipe is in `docs/geo-data.md`.

This adapted file is distributed with the application under the same ODbL 1.0 terms; the attribution above is
displayed on every map. Share-alike applies to this file as a database: if you redistribute it or a further
adaptation, keep this notice and offer it under ODbL.
