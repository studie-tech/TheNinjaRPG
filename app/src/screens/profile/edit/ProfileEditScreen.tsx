import { redirect } from "next/navigation";

/** Render the profile edit screen independently of its route adapter. */
export function ProfileEditScreen(): never {
  return redirect("/profile?tab=edit");
}
