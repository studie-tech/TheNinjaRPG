import { redirect } from "next/navigation";

/** Render the profile recruit screen independently of its route adapter. */
export function ProfileRecruitScreen(): never {
  return redirect("/profile?tab=sharing");
}
