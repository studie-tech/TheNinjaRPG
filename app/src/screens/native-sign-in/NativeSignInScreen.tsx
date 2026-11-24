import { Suspense } from "react";
import NativeBrowserSignIn from "@/components/native/NativeBrowserSignIn";

/** Render the native-sign-in screen independently of its route adapter. */
export function NativeSignInScreen() {
  return (
    <Suspense>
      <NativeBrowserSignIn />
    </Suspense>
  );
}
