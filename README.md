# plugin-rsc cross-origin CSS cache reproduction

Reproduction for [vite-plugin-react #1464](https://github.com/vitejs/vite-plugin-react/issues/1464), testing the two runtime changes in [PR #1469](https://github.com/vitejs/vite-plugin-react/pull/1469).

Opening a **Next.js `<Link target="_blank" prefetch={false}>` in a new tab**, or following a plain `<a>` in the same tab, then lazy-importing a component fails after the same component's stylesheet was cached by SSR on the previous page. There is no application `fetch()` of CSS, no service worker, no `next/dynamic`, no private application code, and no manually inserted or removed stylesheet link.

## Run

Requires Node 26, npm, and free local ports 4173 and 4174.

```sh
npm ci
npx playwright install chromium
npm test
npm run test:fixed
```

`npm test` succeeds only if it observes the expected unpatched failure and the cold-cache controls succeed. `npm run test:fixed` succeeds only if all cold- and warm-cache scenarios work after applying precisely the two `crossOrigin: 'anonymous'` source additions from PR #1469. The patch is version/source guarded, applied only for the build, and then restored. No Vinext patch is applied. The installed dependency versions are pinned and the lockfile is included.

Verified on Node 26.8.2 and Playwright 1.63.0 Chromium on macOS:

| Scenario                                                                | plugin-rsc 0.5.34                     | With PR #1469 runtime changes |
| ----------------------------------------------------------------------- | ------------------------------------- | ----------------------------- |
| Fresh context, open `/second`, click Show card                          | Styled card renders                   | Styled card renders           |
| Fresh context, open `/third`, click Show card                           | Styled card renders                   | Styled card renders           |
| Open `/`, use Link to `/second` in a new tab, click Show card           | CSS CORS failure; page error boundary | Styled card renders           |
| Open `/`, use plain anchor to `/third` in the same tab, click Show card | CSS CORS failure; page error boundary | Styled card renders           |

The browser test uses a different fresh context for each row and leaves HTTP caching enabled. Service workers are blocked. In the new-tab case, both tabs belong to the same browser context. The test also asserts that each navigation makes a document request.

## Manual reproduction

```sh
npm start
```

1. Open `http://127.0.0.1:4173` in a fresh Chromium profile/incognito session. Keep DevTools **Disable cache unchecked** if DevTools is open.
2. The first page server-renders the shared card and its generated stylesheet.
3. Follow **Second page (new tab)**. This uses `<Link href="/second" target="_blank" prefetch={false}>` from `next/link`. The new tab initially has no card and no stylesheet link.
4. Click **Show card**. React.lazy imports the component; Vite generates the CSS link. Chromium reports missing `Access-Control-Allow-Origin` and Vinext displays its page error boundary.

To test the other variant, start in a separate fresh browser context, open the first page, and follow **Third page (same tab)**. This uses a plain `<a href="/third">`; then click **Show card**. Both destination pages share the same lazy loader.

Stop with Ctrl+C. Run `npm run start:fixed` and repeat in a fresh browser context to see the corrected behavior. A fresh context matters when switching builds: an already cached unpatched response can survive a code fix.

## Why existing-link deduplication does not prevent this

The first document renders `Card` through RSC/SSR. Its generated stylesheet link has no `crossorigin`, so the browser requests the CSS in `no-cors` mode without an Origin header.

The second document imports `Card` only after a button click using `React.lazy(() => import('../card'))`. Vite's dynamic-import preload helper finds no existing stylesheet link **in this new document** and creates one with anonymous CORS. The URL matches the first document's cached CSS exactly. The browser HTTP cache is shared across these documents, but their DOMs are separate. In the new-tab case the first tab remains open with its original stylesheet; that link cannot satisfy the new tab's stylesheet lookup.

With the fixture's asset-server policy below, Chromium reuses the response lacking ACAO and rejects the stylesheet. The visible error is `Unable to preload CSS for ...`. The test verifies both matching stylesheet URLs and that the asset server receives only one CSS request during the warm scenario; the second attempt does not reach it. It also verifies the actual rendered card color in the success cases.

## Asset-server condition and scope

The local asset server models the response behavior described in the original report:

- Both responses use `Cache-Control: public,max-age=3600,immutable`.
- Requests carrying Origin receive `Access-Control-Allow-Origin` and `Vary: Origin`.
- Requests without Origin receive neither header.

This conditional-header behavior is necessary to this reproduction; it is not a claim about all CDN configurations. Returning consistent CORS/cache-variation headers can also prevent this cache mismatch.

This example establishes a realistic framework-generated second CSS request. It does not establish that this exact navigation sequence caused the original ShipDash incident, or that same-document navigation with an existing stylesheet link fails. The earlier gist's explicit `fetch(link.href)` demonstrated the cache condition but did not supply this application trigger.

## Files

- `app/page.tsx`: renders the shared card on the server and offers both the new-tab Link and same-tab anchor.
- `app/second/page.tsx` and `app/third/page.tsx`: separate destinations sharing the same lazy loader.
- `app/second/loader.tsx`: click-triggered React.lazy import of that same card.
- `app/card.tsx` and `app/card.css`: shared component and stylesheet.
- `next.config.ts`: sends built assets to a second local origin.
- `reproduce.mjs`: production build, two local servers, and cleanup.
- `browser-checks.mjs`: cold/warm Chromium assertions without fetching CSS manually.
- `patch-rsc.mjs`: the two proposed upstream changes, with source restoration.
