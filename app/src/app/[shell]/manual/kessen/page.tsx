import { redirect } from "next/navigation";

export default function ManualKessen() {
  redirect("/kessen?tab=rules");
}
