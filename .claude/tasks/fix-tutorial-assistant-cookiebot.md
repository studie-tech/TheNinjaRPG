## Fix TutorialAssistant MutationObserver / Cookiebot Crash

### Context
- Sentry shows `TypeError: Cannot read properties of null (reading 'parentNode')` when Cookiebot's `calcFadeState` runs.
- `TutorialAssistant` registers extremely broad `MutationObserver`s on `document.body` (two separate effects). Every DOM change, including Cookiebot's animations, causes us to re-read highlight targets immediately.
- Cookiebot temporarily detaches nodes and expects to own the animation timing; our observers fire mid-mutation and force synchronous layout work, triggering the `parentNode` access on an element that was just detached.

### Plan
1. **Map Highlight Update Triggers**
   - Re-read `TutorialAssistant` to confirm everywhere `updateHighlightPosition` and `updateGameMenuHighlight` are called.
   - Document which triggers are still needed after removing the global `MutationObserver`.

2. **Replace Global MutationObservers with Local Scheduling**
   - Remove both `MutationObserver` instances that currently observe `document.body`.
   - Introduce `scheduleHighlightUpdate` helpers that debounce calls via a shared `requestAnimationFrame` ref, so scroll/resize/interval triggers do not spam layout work.
   - Ensure we re-run the scheduler whenever sidebar open state changes or tutorial step changes so new DOM insertions are still detected (interval already polls every 250 ms).

3. **Add Optional Targeted Observers (if necessary)**
   - If highlight targets live inside the right sidebar, piggyback on `rightSideBarRef` by wiring a `ResizeObserver` limited to that subtree. This keeps updates responsive for sidebar content without touching third-party overlays.
   - Guard observer lifecycle carefully to avoid leaks.

4. **Validation**
   - Rely on unit/lint coverage for `TutorialAssistant.tsx`; ensure type checks pass.
   - Manually reason through scenarios: regular tutorial step, sidebar tutorial, Cookiebot dialog open.

Once this plan is approved, I will implement the changes in `app/src/layout/TutorialAssistant.tsx`, run linting if necessary, and summarize the verification steps.
