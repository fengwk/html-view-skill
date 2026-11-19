# Offline map assets

`world.geojson` (242 features) and `us-states.geojson` (50 features) are copied from the verified Natural Earth data bundle. Both are GeoJSON FeatureCollections containing Polygon/MultiPolygon geometries. The choropleth renderer uses each bundled feature's exact `properties.id` as its join key; it does not infer a key from the feature name. Hosts load these files as needed and inject the parsed collections as `ctx.assets.world` / `ctx.assets['us-states']`. The default projection is equirectangular; a host may select Mercator by injecting `ctx.assets.projection: 'mercator'`. Core map code never reads files or performs network requests.

## License, provenance, and display condition

These political boundaries are for neutral geographic visualization only. They are not a statement, recognition, endorsement, or position on sovereignty or border delimitation; representations and omissions follow the source data and scale. Hosts must keep the rendered source/disclaimer visible. Public-domain status concerns copyright permission only and does not imply political-display approval or regional compliance. China-specific maps are intentionally not included. See [`METADATA.md`](METADATA.md) for full display conditions and source visibility requirements.

The complete source `LICENSE.md` is retained alongside the data. Natural Earth states its map data is public domain and that use/redistribution is permitted. Suggested attribution: “Made with Natural Earth.” The bundled source also contains upstream credits/disclaimers; see the complete license text.

## Region code directory

The world layer's `properties.id` values are the exact identifiers in this asset, not a claim that every feature has an ISO code. Source `properties.code_source` counts are: `ISO_A3` 234, `ISO_A3_EH` 2, and `ADM0_A3` 6. The non-`ISO_A3` entries are:

| Exact `id` | Feature name | Source |
| --- | --- | --- |
| `SOL` | Somaliland | `ADM0_A3` |
| `NOR` | Norway | `ISO_A3_EH` |
| `KOS` | Kosovo | `ADM0_A3` |
| `FRA` | France | `ISO_A3_EH` |
| `CYN` | Northern Cyprus | `ADM0_A3` |
| `IOA` | Indian Ocean Territories | `ADM0_A3` |
| `ATC` | Ashmore and Cartier Islands | `ADM0_A3` |
| `KAS` | Siachen Glacier | `ADM0_A3` |

All other world ids are the dataset's `ISO_A3` values. The states layer contains exactly 50 features and its exact `properties.id` values are `US-AK`, `US-AL`, `US-AR`, `US-AZ`, `US-CA`, `US-CO`, `US-CT`, `US-DE`, `US-FL`, `US-GA`, `US-HI`, `US-IA`, `US-ID`, `US-IL`, `US-IN`, `US-KS`, `US-KY`, `US-LA`, `US-MA`, `US-MD`, `US-ME`, `US-MI`, `US-MN`, `US-MO`, `US-MS`, `US-MT`, `US-NC`, `US-ND`, `US-NE`, `US-NH`, `US-NJ`, `US-NM`, `US-NV`, `US-NY`, `US-OH`, `US-OK`, `US-OR`, `US-PA`, `US-RI`, `US-SC`, `US-SD`, `US-TN`, `US-TX`, `US-UT`, `US-VA`, `US-VT`, `US-WA`, `US-WI`, `US-WV`, `US-WY`. This source does not include Washington, D.C.

Names in this directory are descriptive only; joins must use the exact `id` property. Do not derive codes from names.
