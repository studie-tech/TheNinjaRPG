import { BloodlineDetailScreen } from "@/screens/manual/bloodline/BloodlineDetailScreen";

type Props = { params: Promise<{ bloodlineid: string }> };

export { generateMetadata } from "@/screens/manual/bloodline/BloodlineDetailScreen.metadata";

export default async function BloodlineDetail(props: Props) {
  return <BloodlineDetailScreen params={await props.params} />;
}
