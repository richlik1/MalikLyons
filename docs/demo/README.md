# Widget + API demo (local, demo data)

Recorded by `app/scripts/demo-widget-flow.mjs` against the local stack:

1. `01` A demo store on a different address (`http://localhost:4000`) with the 2-line TrendSet install.
2. `02`, `03` The shopper clicks "See it on you". TrendSet opens with an anonymous session: consent, photo, pick, generate.
3. `04` The store owner's API keys panel with install snippets.
4. `06` A real `POST /api/v1/try-ons` call with a secret key, then `GET /api/v1/usage` (`api-transcript.txt`).
5. `05` The developer docs page.
6. `trendset-widget-demo.mp4` Screen recording of steps 1–2.

The garments and shopper figure are drawn illustrations. The try-on image is the FASHN contract stub
("STUB OUTPUT — Not AI"); a real FASHN key replaces it.
