import { redirect } from "next/navigation";

/** Render the users screen independently of its route adapter. */
export async function PublicProfileScreen(props: {
  params: { userid: string };
}): Promise<never> {
  const params = props.params;
  return redirect(`/userid/${params.userid}`);
}
