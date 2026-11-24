import { GuideArticleScreen } from "@/screens/guide/GuideArticleScreen";

type Props = { params: Promise<{ slug: string }> };

export { generateMetadata } from "@/screens/guide/GuideArticleScreen.metadata";

export default async function GuideArticlePage(props: Props) {
  return <GuideArticleScreen params={await props.params} />;
}
