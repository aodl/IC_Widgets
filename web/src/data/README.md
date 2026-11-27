# Bundled cartography and flags

The basemap uses Natural Earth 1:50m Admin 0 map units, layer version 5.1.1 at repository tag `v5.1.2`. The map uses the dataset's cartographic units and the `ISO_A2_EH` rendering key. Several units may share a rendering key. Blank keys stay unshaded. Hong Kong and the Isle of Man are separate retained polygons. Represented map units below three CSS pixels get a small cartographic square. Node markers still use their exact registered coordinates. [Pinned source](https://github.com/nvkelso/natural-earth-vector/tree/v5.1.2/50m_cultural) · [Natural Earth public-domain terms](https://www.naturalearthdata.com/about/terms-of-use/)

Flag icons come from the 4×3 two-letter assets in flag-icons `v7.2.3` under the MIT license. The packed atlas excludes organization and placeholder flags (`eu`, `un`, `xx`). The browser decodes it from the JavaScript bundle. Markdown uses regional-indicator characters alongside readable names, so a platform without emoji flag support still shows the name and recorded token. [Pinned flag source](https://github.com/lipis/flag-icons/releases/tag/v7.2.3) · [Bundled MIT notice](FLAG-ICONS-LICENSE.txt)

English country and territory names come from native `Intl.DisplayNames`. A recognized short name is used if it has at least four characters. The explicit `UK → GB` display alias and case normalization never modify a recorded grouping key. Unmatched labels keep their original spelling. When two recorded groups resolve to the same rendering key, the affected geometry stays neutral and both groups remain individually visible. Missing country evidence suppresses all directional shading. Boundaries describe the cartography. Subnet assignments and counts come from accepted replicated evidence.

## Rebuild the packed assets

This is a development-only regeneration procedure. Ordinary application builds consume the two checked-in JavaScript modules and do not fetch from either provider.

Save the pinned Natural Earth `ne_50m_admin_0_map_units` files as `units.shp`, `units.shx`, and `units.dbf` and the pinned [flag archive](https://codeload.github.com/lipis/flag-icons/tar.gz/refs/tags/v7.2.3) as `flags.tar.gz` in a scratch directory. Verify SHA-256 before processing.

| Input | SHA-256 |
| --- | --- |
| `units.shp` | `6516849ff791927f0d5f5e1cdc003267d10d1ba50497e143e712071584c5efc3` |
| `units.shx` | `d0b3186537fac38941a5f43d19e8752cdee21c405164aa054f7e0e12f1a98569` |
| `units.dbf` | `8bb233952390170d0995aebaa2b73b3536c4b25e357a0f56e25178192857741d` |
| `flags.tar.gz` | `501c7ff41a4c9919614feb9546531e081b614a57e944e03b85e7ea02f03ce084` |

Run Mapshaper `0.6.113` against the input. It simplifies shared boundaries together with planar Douglas–Peucker, keeps small features, and quantizes to 0.005°. The packer drops duplicate closing coordinates, then encodes longitude/latitude deltas as variable-length integers. The renderer closes rings and uses even-odd fills.

```bash
npx --yes mapshaper@0.6.113 -i units.shp encoding=utf8 \
  -filter-fields ISO_A2,ISO_A2_EH,GU_A3,ADM0_A3,NAME \
  -simplify dp interval=0.045 planar keep-shapes \
  -o format=geojson precision=0.005 units.json
```

From the repository root with development-only CairoSVG `2.8.2` and Pillow `11.3.0` installed, run `python3 scripts/build-country-assets.py <units.json> <flags.tar.gz>`. CairoSVG rasterizes each flag to 24×18 pixels. Pillow packs them into one PNG whose bytes are embedded in JavaScript.

| Bundled module | SHA-256 |
| --- | --- |
| `map-units.js` | `0802f6626049481df5dd071621065a3441e0fb64c694ea1daccb4a46a8921f9a` |
| `flag-atlas.js` | `90bacf3d2cec86663005ac8787fbdf57ca7b17f1507b416f973492ff9f0b7156` |

The production `app.js` built with the same principal grew from 372,310 to 513,546 bytes. With `gzip -n` it grew from 127,645 to 260,575 bytes. The measurements include the bundled flag atlas, country geometry and presentation code. Both builds ship a single JavaScript asset.
