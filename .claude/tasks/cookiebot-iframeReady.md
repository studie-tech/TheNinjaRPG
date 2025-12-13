# Fix Cookiebot iframeReady error

## Context
The Cookiebot declaration script (`cd.js`) is injected on `/consent`, but the global initializer (`uc.js`) is missing from the root layout. When `cd.js` executes, `window.CookieControl` is still undefined and accessing `CookieControl.Cookie.iframeReady` throws. We need to load `uc.js` globally (with the required attributes) so the Cookiebot namespace exists before any page-specific scripts run.

## Plan
1. **Audit current integration** – Double-check `app/src/app/layout.tsx` and any shared layout utilities to confirm the script is absent and capture the existing Cookiebot ID from `/consent`. This avoids duplicating work if a different layout already injects the script.
2. **Add global Cookiebot loader** – In `app/src/app/layout.tsx`, import `next/script` and render the Cookiebot `<Script>` tag (with `strategy="beforeInteractive"`, `data-cbid`, `data-blockingmode="auto"`, and `type="text/javascript"`). Co-locate the Cookiebot ID as a constant to keep it maintainable and reuse later if needed.
3. **Guard against SSR issues** – Ensure the script renders inside the `<body>` (Next.js will hoist it to `<head>` as needed) and that attributes pass through correctly. Confirm no strict mode or hydration warnings arise.
4. **Validation** – Run a targeted lint check (or rely on pre-commit hooks) and, if practical, start the dev server locally to confirm the homepage loads without the `iframeReady` TypeError and that the Cookiebot banner still appears when cookies are reset.
