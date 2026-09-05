# InferPool submission assets

> 地址脱敏说明：`demo.example.com` 为占位域名，不是实际部署或验收地址；本文历史验证记录指向清理前的真实地址。

Original artwork and separate unedited interface captures prepared on 2026-09-05. The generated artwork uses the existing InferPool dark palette and `#b6f86a` accent, without third-party logos, downloaded icons or invented metrics. Real browser screenshots retain the interface and its indicators; their provenance is documented below. No asset includes credentials or personal login details.

| File | Use | Format |
| --- | --- | --- |
| `inferpool-logo.svg` | Original geometric **IP** monogram for submission forms, slide covers, or project branding | Scalable vector, transparent background |
| `inferpool-logo.png` | Ready-to-upload logo, intended for a dark background | 512 × 512 RGBA; transparent background |
| `inferpool-project-overview.svg` | Editable-by-generator project explanation artwork | 1600 × 900 vector; lettering converted to paths |
| `inferpool-project-overview.png` | Ready-to-upload project preview or presentation cover | 1600 × 900 PNG; opaque dark background |
| `inferpool-public-market.jpg` | Public `https://demo.example.com` guest marketplace with one live seller A; suggested current cover | 1713 × 1452 unedited browser capture |
| `inferpool-market-live.jpg` | Actual local Web connected to the Monad-testnet Router, two online sellers and four-part prices | 1713 × 1452 unedited browser capture |
| `inferpool-bill-live.jpg` | Actual confirmed historical bill, usage, release amount and chain links | 1713 × 1108 unedited browser capture |
| `build_assets.py` | Reproducible vector source: geometry, layout, labels, and text outlines | Python |
| `render_assets.cjs` | SVG-to-PNG renderer, without browser automation | Node.js |

The overview is **an original explanatory diagram, not a running product screenshot**. It explicitly says “Project overview · Not a product screenshot.” The two `*-live.jpg` files are separate real interface screenshots. No demo recording has been produced. The overview makes no claim about a public deployment, benchmark, throughput, or seller count.

## Real interface captures

The two `*-live.jpg` browser captures were taken on 2026-09-05 (Asia/Shanghai) from `http://127.0.0.1:3000/`, connected to the existing Monad Testnet Router and two seller processes. They are local UI evidence, **not proof of a public deployment**. The browser's development and extension indicators remain visible. No displayed values were edited, and no new paid request was made to create these screenshots.

The market capture shows two online offers, `9.928253 dUSD` available escrow and `4.904913 dUSD` remaining grant at capture time. The bill capture selects the already verified request `69a28714-618a-4d8b-99c5-620cba33e728`: actual charge `0.016580 dUSD`, release `0.083420`, input 54 and output 187. Its chain evidence is preserved in [`inferpool-smoke-market-monad.json`](../../contracts/deployments/inferpool-smoke-market-monad.json). These test assets have no cash value. The files contain no bearer tokens, API keys or personal login details.

The separate `inferpool-public-market.jpg` was captured on 2026-09-05 from the actual public origin `https://demo.example.com` and opened with `view_image` by the root agent. It is the original full-page CUA JPEG, 1713 × 1452, with no pixel edits. It shows a guest marketplace with one online seller A; balance and authorization are dashes because the browser is not logged in, and no bill is shown. It contains no credentials. This is public-page evidence, not proof of a new public-origin inference or settlement. The Para login modal also opened and was closed without logging in or signing.

For the MOJO form, use the public market screenshot as the current first screenshot/cover and the historical bill screenshot as the second, clearly identifying the bill's localhost origin. The local two-seller market and overview may be supporting images; do not present the earlier two-seller image as current public availability. The generator commands below reproduce the original vector assets only and do not modify the real captures.

The diagram represents the implemented scope: buyers use Web/API, the Router matches and routes requests and meters simulated usage, independent seller processes stream mock responses, and Monad Testnet contracts manage budget escrow and settlement. **Mock inference · Real testnet settlement** means testnet transactions; it does not imply real model execution or assets with cash value. Current evidence and limitations remain in [`docs/progress.md`](../../docs/progress.md).

## Reproduce

From the repository root, using the existing local Python `fontTools` and Node `sharp` installations:

```sh
python3 artifacts/submission/build_assets.py
node artifacts/submission/render_assets.cjs
```

The generator defaults to macOS Arial regular/bold fonts. On another system, specify installed font files before generating:

```sh
INFERPOOL_FONT_REGULAR=/path/to/regular.ttf \
INFERPOOL_FONT_BOLD=/path/to/bold.ttf \
python3 artifacts/submission/build_assets.py
```

Different source fonts change the lettering and may require checking the layout. The generated SVG contains text outlines, so the submitted SVG/PNG does not depend on the recipient having those fonts. No font files are included. The logo uses original geometry and does not use a font.

The PNG renderer resolves `sharp` from the installed project dependencies. If needed, `INFERPOOL_SHARP_MODULE` can point to an existing compatible installation; no package is installed by these scripts. Both scripts write only beside themselves in this directory.

## Checks performed

- Both final PNG files opened with `view_image` and visually inspected: readable English lettering, no clipping or overlaps.
- Logo dimensions: **512 × 512**; alpha range **0–255**, confirming transparent and opaque pixels.
- Preview dimensions: **1600 × 900**; alpha is **255** throughout, confirming an opaque background.
- Both SVG files parsed as XML; no external image/font resources are embedded or fetched.
- Root agent saved and visually checked all three original JPEG captures; the public market capture is separate from the earlier localhost market/bill captures.

These are asset checks, not additional application or blockchain acceptance tests.
