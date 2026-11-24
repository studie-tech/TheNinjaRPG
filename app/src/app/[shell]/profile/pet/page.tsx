import { PetProfileScreen } from "@/screens/profile/pet/PetProfileScreen";

export default async function PetProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ petId?: string | string[] }>;
}) {
  return <PetProfileScreen searchParams={await searchParams} />;
}
