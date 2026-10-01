# theme02 — repository instructions for coding agents

`cod-astro/theme02` is the second swappable storefront theme for CodFlow
(Astro, Cloudflare Workers, AR/FR/EN) — the sharp red/gold "Vintadz-style"
COD identity. It is a **theme layer, not a platform package**: engine logic
lives in the CodFlow platform (see `cod-server`). Read the root `AGENTS.md`
too — this file only overrides what differs here.

## Layout

- `src/core/` — platform-owned engine. **Do not modify.** All HTTP calls go
  through `src/core/api/client.ts`; Astro action/middleware proxies at
  `src/actions/index.ts` and `src/middleware.ts` re-export from here.
- `src/theme/` — the swappable theme layer: components, layouts, styles,
  config, content (AR/FR/EN string packs). This is where customization lands.
  - `src/theme/config/form.ts` (`ORDER_FORM`) — single switchboard for the
    product-page checkout UI; toggle there instead of editing components.
  - `src/theme/config/store.ts` (`DEFAULT_CONFIG`) — theme02 identity
    fallbacks (`themeId: "theme02"`, red/gold palette, Readex Pro).
  - theme02's display face is `--font-head` (IBM Plex Sans Arabic, static in
    `global.css`); body face comes from the store config (`Readex Pro`).
- `public/`, `scripts/` — static assets and repo-owned validator scripts.
- The showcase page is the **product page** (`/products/[slug]`) — bordered
  details card (title + discount pill + price + order form + summary),
  gallery with arrows + thumbnails, description below, mobile sticky CTA.

## Commands

This package is part of the root npm workspace. Install at the repo root
(`npm ci`), then run inside this directory:

```sh
npm run dev         # astro dev :4321 (expects cod-server on :8787)
npm run build       # astro build
npm test            # vitest --run (unit/property tests)
npx astro check     # typecheck + diagnostics
npm run validate    # string + style validators, then build
```

There is no `typecheck` script; `npx astro check` is the typecheck for this
package. CI runs `astro check` + `npm test` for theme02 (plus typecheck +
tests for cod-server, cod-client-astro, and the legacy cod-client).

## Boundaries

- Keep engine logic out of the theme. Changes that belong in the platform
  (API shape, validation, order flow) go in `cod-server` / `cod-shared`, not
  here.
- Never modify `src/core/` — the core is versioned with the platform and
  breakage there breaks orders.
- All user-facing text needs AR/FR/EN translations and must keep RTL working.
- The theme stays swappable: a new theme is a new folder, not edits to core.

## Conventions & traps

- **No hardcoded user-facing strings** — add content keys to the language packs.
- **No hardcoded design tokens** (colors, radii, fonts) in component styles.
  See `THEME_GUIDE.md`.
- The `"overrides": { "vite": "^8.2.2" }` pin lives in the **root**
  `package.json` (npm ignores overrides inside workspace members) and is
  load-bearing: it keeps a single Vite major across astro/vitest/plugins.
  Removing it reintroduces a dev-server boot crash; bump it together with
  astro's Vite major. `npm ls vite` must show one version.
- `COD_SERVER_URL` is never set in `wrangler.jsonc` — `npm run deploy`
  (scripts/deploy.mjs) injects it at deploy time from the repo-root `.env`
  and refuses a localhost value without `--force-local`. Local dev reads it
  from this package's `.dev.vars`. Real secrets go in `.dev.vars` (gitignored)
  or `wrangler secret put` — never in `wrangler.jsonc`.
- `MEDIA_DOMAIN` is optional; unset, the image optimizer passes URLs through
  unchanged.