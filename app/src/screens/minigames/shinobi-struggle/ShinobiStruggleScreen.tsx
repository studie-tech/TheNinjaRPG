import { Suspense } from "react";
import { ShinobiStruggleRoute } from "./ShinobiStruggleClient";

export function ShinobiStruggleScreen() {
  return (
    <Suspense fallback={<p role="status">Loading Shinobi Struggle…</p>}>
      <ShinobiStruggleRoute />
    </Suspense>
  );
}
