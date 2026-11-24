import { JutsuDetailScreen } from "@/screens/manual/jutsu/JutsuDetailScreen";

type Props = { params: Promise<{ jutsuid: string }> };

export { generateMetadata } from "@/screens/manual/jutsu/JutsuDetailScreen.metadata";

export default async function JutsuDetail(props: Props) {
  return <JutsuDetailScreen params={await props.params} />;
}
