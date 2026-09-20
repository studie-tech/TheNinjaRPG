import { redirect } from "next/navigation";

export default async function PublicProfile(props: {
  params: Promise<{ userid: string }>;
}) {
  const params = await props.params;
  redirect(`/userid/${params.userid}`);
}
