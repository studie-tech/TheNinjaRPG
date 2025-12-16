# Fix forum thread ZodError crash

## Context
- Forum thread page (`app/src/app/forum/[boardid]/[threadid]/page.tsx`) instantiates a `react-hook-form` form that destructures `formState.errors` directly.
- With `reactCompiler` enabled globally, that destructuring path leads the compiler to emit `Object.assign` calls that try to mutate getter-only `message` properties coming from `react-hook-form`/Zod, resulting in `TypeError: Cannot set property message...` when validation runs.
- Other parts of the app (e.g. board list) rely on the same schema without issues because they keep the `useForm` instance intact and access `form.formState.errors` lazily.

## Plan & Reasoning
1. **Audit current form usage**
   - Re-read the thread page component and confirm exactly which helpers from `useForm` are required (handleSubmit, setValue, reset, control, errors) and how `errors` is consumed by `RichInput`.
   - Comparing with the board list implementation helps verify that avoiding destructuring is viable.
   - *Reasoning:* precise inventory prevents missing dependencies when refactoring to a single form object.

2. **Refactor to a named `useForm` instance**
   - Replace the destructuring assignment with `const commentForm = useForm<MutateCommentSchema>({ resolver: zodResolver(mutateCommentSchema) });`.
   - Update all usages (`handleSubmit`, `setValue`, `reset`, `control`) to read from `commentForm`.
   - Derive `errors` via `const { errors } = commentForm.formState;` right before rendering rather than via destructuring in the hook result.
   - *Reasoning:* Keeping the proxy objects inside the form instance avoids the compiler attempting to clone/accessorize them, which prevents the getter-only `message` mutation path.

3. **Validate behavior**
   - Ensure the effect that pre-fills `object_id` uses `commentForm.setValue` and that the submit handler still references `commentForm.handleSubmit`.
   - Manually reason through the render tree (and optionally run targeted unit tests if available) to confirm no regressions for showing validation errors or posting comments.
   - *Reasoning:* guarantees parity with previous behavior while eliminating the crash pathway.

4. **Regression considerations**
   - Double-check that no other files still destructure `formState.errors` in a way that could reproduce the bug; document potential follow-up if needed.
   - *Reasoning:* surfaces any remaining hotspots for future cleanup.

## Tasks
- [ ] Inspect current thread comment form usage and dependencies.
- [ ] Refactor to a single `commentForm` object and update references.
- [ ] Re-review render logic to ensure errors still flow to `RichInput` and submission/reset logic is intact.
- [ ] Spot-check for similar destructuring patterns for possible follow-up.
