import { redirect } from "next/navigation";

/** Route direct companion links into the profile's pet tab while preserving the selected pet. */
export async function PetProfileScreen({
  searchParams,
}: {
  searchParams: { petId?: string | string[] };
}): Promise<never> {
  const { petId } = searchParams;
  const selectedPetId = Array.isArray(petId) ? petId[0] : petId;
  const query = new URLSearchParams({ tab: "pet" });
  if (selectedPetId) query.set("petId", selectedPetId);
  return redirect(`/profile?${query.toString()}`);
}
