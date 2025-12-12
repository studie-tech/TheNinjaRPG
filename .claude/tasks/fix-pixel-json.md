# Fix pixel JSON parse crash

## Goal
Prevent the third-party pixel script from requesting `/` and trying to `JSON.parse` the HTML response, which currently throws `SyntaxError: Unexpected token '<'` in production.

## Plan
1. **Locate pixel integration**  
   - Search the codebase (likely `app/src/app/layout.tsx`, `_document`, or analytics utilities) for the snippet or config that loads `ads/pixel.js`.
   - Identify how the script is configured (data attributes, inline config, env vars) and what endpoint it expects to call.

2. **Understand and reproduce the bad request**  
   - Trace how the script derives the URL it fetches (is it hardcoded to `/`, missing query param, or falling back to default?).
   - Verify whether we control the config (e.g., via JSON embedded in the page). If possible, reproduce locally (console log or stub) to confirm.

3. **Implement fix**  
   - Update the pixel config so it requests the proper JSON endpoint (or disable the JSON parse when HTML is returned). Options: point to a JSON config route we own, guard response type before parsing, or bypass loading entirely if config missing.
   - Keep third-party requirements (async load, GDPR) intact.

4. **Validate**  
   - Run the local dev server (if feasible) or unit tests touching the integration.
   - Manually ensure the script no longer fetches `/` for JSON, and there are no console errors.

## Open Questions
- Is the pixel script hosted locally (e.g., `public/ads/pixel.js`) or injected via GTM? Need to confirm while investigating.
