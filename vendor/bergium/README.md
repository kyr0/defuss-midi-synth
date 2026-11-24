# bergium (vendored)

The demo page's visualizer: `src/` is `packages/bergium/src` of https://github.com/kyr0/bergium at commit `a8c646f8ce728d7c9d5aa9a4b9946b9237d4fa05` (2026-08-02), copied unchanged. bergium-core is not published to npm, so the demo bundles this copy (`scripts/build.mjs` writes `docs/visualizer.js` from `demo/visualizer.ts`). It is not part of the npm package.

Licences: bergium is MIT (`LICENSE`, `PREAMBLE.txt`). Its Milkdrop pipeline derives from Butterchurn (MIT, `LICENSE.butterchurn.txt`), its Geiss pipeline from Ryan Geiss's Geiss source (BSD-3-Clause, `LICENSE.geiss.txt`); `THIRD_PARTY_NOTICES.md` and `provenance.md` are bergium's own records. The BSD licence's third clause forbids using Ryan Geiss's name to endorse a derived product: the page names the pipeline after the effect it reproduces and claims no endorsement.
