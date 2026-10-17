# Headless auth for plain HTTP routes (non-tRPC)

The call-endpoint broker only reaches tRPC procedures. Next.js API routes that call Clerk's
`auth()` directly (`/api/chat/*`, etc.) need a real Clerk session — which can be minted without a
browser by doing what clerk-js does internally against the dev instance's Frontend API
(resolve the FAPI host from this environment's Clerk instance/publishable key):

```js
// FAPI is this environment's https://<instance>.clerk.accounts.dev
// 1. dev-browser token (dev instances only)
const { token: dbJwt } = await (await fetch(`${FAPI}/v1/dev_browser`, { method: "POST" })).json();
// 2. consume the broker's signInToken as a ticket sign-in
const signIn = await (await fetch(`${FAPI}/v1/client/sign_ins?__clerk_db_jwt=${dbJwt}`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ strategy: "ticket", ticket: signInToken }),
})).json();
const sessionId = signIn.client.last_active_session_id;
// 3. mint a session JWT (~60 s validity — mint right before each burst of calls)
const { jwt } = await (await fetch(`${FAPI}/v1/client/sessions/${sessionId}/tokens?__clerk_db_jwt=${dbJwt}`, {
  method: "POST",
})).json();
// 4. the Next server accepts it as a Bearer token
await fetch(`http://127.0.0.1:${PORT}/api/chat/support`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
  body: JSON.stringify({ messages: [...] }),
});
```

Chat routes expect the `useChat` wire shape: `{ messages: [{ id, role, parts: [{ type: "text",
text }] }] }` — UIMessages with `parts`, not ModelMessages with `content`.

