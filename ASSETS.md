# Asset provenance

Updated September 11, 2026. The current game renders original boats, harbors, islands, reefs and landmarks from `src/drift-art.ts`. Kenney model packs remain in the repository as earlier source material; the current renderer loads none of them.

## Original Drift work

The cutter, lighter, barge, fittings, freight, harbor structures and Outer Reaches scenery are authored geometry. The locally rendered original music score and method are in `scripts/compose-harbor.py`. Generated sailcloth, its exact prompt and music provenance are described in [the Drift art credits](public/assets/drift/README.md). Fonts and their notices are kept with their local asset files. The interface now uses published Game-icons.net and Lucide assets. The pointer uses the native system cursor. See the icon credits below.

## Published game and interface icons

All 51 interface symbols use selected published artwork: 32 game/resource/nautical icons by Delapouite and Lorc from [Game-icons.net](https://game-icons.net/), and 19 standard controls from [Lucide](https://lucide.dev/). Timber uses Wood Pile, kelp Algae, plates Metal Plate, fuel Jerrycan and repair kits Toolbox.

The shared sprite removes square backgrounds from game icons and applies existing interface colors; source geometry is preserved. Exact icon mappings, author credits, pinned download URLs, source hashes and the CC BY 3.0 / ISC / MIT notices are in [icon-sources](public/assets/drift/icon-sources/README.md). Credits are also reachable in the game's Settings. The same published Sailboat icon supplies wallet metadata. These icons are distinct from the original world geometry and the network marks below.

## Network identity

Network marks are third-party brand assets, separate from the original game art and the Kenney CC0 licenses. They identify the actual payment and inventory networks alongside text labels. No endorsement is claimed. Downloaded September 11, 2026.

| Asset | Official source | Local file |
|---|---|---|
| Creditcoin token symbol, unmodified `CTC.svg` from Token Symbol.zip | [Creditcoin brand kit](https://docs.creditcoin.org/brand-kit) | `public/assets/drift/chains/creditcoin.svg` |
| Ethereum black diamond, unmodified PNG | [Ethereum assets](https://ethereum.org/assets/) | `public/assets/drift/chains/ethereum.png` |
| Sailboat icon for wallet metadata | Delapouite / Game-icons.net, CC BY 3.0 | `public/assets/drift/chains/drift-wallet.svg` |

The Ethereum PNG was downloaded from the asset page’s black-diamond image link. Original download archives are retained outside the public repository.

## Retained Kenney source packs

Downloaded from Kenney’s official pages on September 9, 2026. The original included notices permit personal, educational and commercial use under [CC0](https://creativecommons.org/publicdomain/zero/1.0/).

| Collection | Version | Official source | Local license |
|---|---|---|---|
| Kenney Pirate Kit | 2.1 | [Pirate Kit](https://kenney.nl/assets/pirate-kit) | `public/assets/pirate/License.txt` |
| Kenney Fantasy Town Kit | 2.0 | [Fantasy Town Kit](https://kenney.nl/assets/fantasy-town-kit) | `public/assets/town/License.txt` |

Creator: [Kenney](https://kenney.nl). `asset-manifest.json` preserves filename, size and SHA-256 hashes for the extracted source models/textures. Included licenses and the manifest preserve provenance; download archives and kit previews are retained outside the public repository. The archive previews are references, not game textures. No commercial-game screenshots or models are shipped as game assets.
