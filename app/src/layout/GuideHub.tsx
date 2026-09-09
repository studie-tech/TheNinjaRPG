"use client";

import { FilePlus, Pencil, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  GUIDE_CATEGORY_LABELS,
  GUIDE_HUB_CATEGORY_ORDER,
  type GuideCategory,
  IMG_MANUAL_COMBAT,
} from "@/drizzle/constants";
import type { GuideArticle } from "@/drizzle/schema";
import ContentBox from "@/layout/ContentBox";
import Image from "@/layout/Image";
import NavTabs from "@/layout/NavTabs";
import { showMutationToast } from "@/libs/toast";
import { canChangeContent } from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";

interface GuideHubProps {
  articles: GuideArticle[];
}

const ALL_TAB = "All";

export const GuideHub: React.FC<GuideHubProps> = ({ articles }) => {
  const { data: userData } = useUserData();
  const router = useRouter();
  const isStaff = Boolean(userData && canChangeContent(userData.role));
  const [category, setCategory] = useState<string>(ALL_TAB);
  const [search, setSearch] = useState("");

  const { mutate: create, isPending } = api.guide.create.useMutation({
    onSuccess: (data) => {
      showMutationToast(data);
      if (data.success) {
        router.push(`/guide/edit/${data.message}`);
      }
    },
  });

  const { data: staffArticles } = api.guide.getAll.useQuery(
    { includeDrafts: true },
    { enabled: isStaff },
  );
  const catalog = staffArticles ?? articles;
  const featured = catalog.find((article) => article.slug === "getting-started");
  const tabs = [
    ALL_TAB,
    ...GUIDE_HUB_CATEGORY_ORDER.map((key) => GUIDE_CATEGORY_LABELS[key]),
  ];

  const selectedCategory = GUIDE_HUB_CATEGORY_ORDER.find(
    (key) => GUIDE_CATEGORY_LABELS[key] === category,
  );

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return catalog.filter((article) => {
      if (selectedCategory && article.category !== selectedCategory) return false;
      if (!query) return true;
      return (
        article.title.toLowerCase().includes(query) ||
        (article.excerpt ?? "").toLowerCase().includes(query) ||
        article.slug.includes(query)
      );
    });
  }, [catalog, search, selectedCategory]);

  const grouped = useMemo(() => {
    const groups = new Map<GuideCategory, GuideArticle[]>();
    for (const article of visible) {
      const list = groups.get(article.category) ?? [];
      list.push(article);
      groups.set(article.category, list);
    }
    return GUIDE_HUB_CATEGORY_ORDER.filter((key) => groups.has(key)).map((key) => ({
      key,
      label: GUIDE_CATEGORY_LABELS[key],
      articles: groups.get(key) ?? [],
    }));
  }, [visible]);

  return (
    <>
      <ContentBox
        title="TheNinja-RPG Guide"
        subtitle="How to play the ninja browser game in Seichi"
        topRightContent={
          isStaff ? (
            <Button id="create-guide" disabled={isPending} onClick={() => create()}>
              <FilePlus className="mr-2 h-5 w-5" />
              New
            </Button>
          ) : undefined
        }
      >
        <p>
          Official first-party guides for TheNinja-RPG: getting started, combat,
          farming, bloodlines, villages and ranks. Look up jutsu, items and bloodline
          stats in the{" "}
          <Link
            href="/manual"
            className="font-bold text-orange-500 hover:text-orange-700"
          >
            game data encyclopedia
          </Link>
          .
        </p>
        {featured && (
          <Link
            href={`/guide/${featured.slug}`}
            className="group mt-4 flex items-center gap-3 rounded-lg border p-3 transition-colors hover:border-orange-500 hover:bg-orange-500/5"
          >
            <Image
              src={featured.image || IMG_MANUAL_COMBAT}
              alt={featured.title}
              width={320}
              height={160}
              className="h-[88px] w-36 shrink-0 rounded-md border object-cover"
            />
            <div className="min-w-0">
              <p className="font-bold text-xs uppercase tracking-wide text-muted-foreground">
                Start here
              </p>
              <p className="mt-1 font-bold leading-tight group-hover:text-orange-600">
                {featured.title}
              </p>
              <p className="mt-1 line-clamp-2 text-sm">
                {featured.excerpt ??
                  "Start here if you are new to TheNinja-RPG and the world of Seichi."}
              </p>
            </div>
          </Link>
        )}
        <div className="mt-4 flex flex-col gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-2.5 left-2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search the guide"
              className="pl-8"
              aria-label="Search the guide"
            />
          </div>
          <NavTabs
            id="guide-category"
            current={category}
            options={tabs}
            onChange={setCategory}
          />
        </div>
      </ContentBox>

      {grouped.map((group) => (
        <ContentBox
          key={group.key}
          title={group.label}
          subtitle={`${group.articles.length} article${group.articles.length === 1 ? "" : "s"}`}
          initialBreak={true}
          alreadyHasH1={true}
          id={group.key}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {group.articles.map((article) => (
              <GuideCard key={article.id} article={article} isStaff={isStaff} />
            ))}
          </div>
        </ContentBox>
      ))}

      {visible.length === 0 && (
        <ContentBox title="No matching guides" initialBreak={true} alreadyHasH1={true}>
          <p>Try another category or search term.</p>
        </ContentBox>
      )}
    </>
  );
};

const GuideCard: React.FC<{ article: GuideArticle; isStaff: boolean }> = ({
  article,
  isStaff,
}) => {
  return (
    <div className="flex gap-3 rounded-lg border p-3">
      <Link href={`/guide/${article.slug}`} className="flex min-w-0 grow gap-3">
        <Image
          src={article.image || IMG_MANUAL_COMBAT}
          alt={article.title}
          width={256}
          height={128}
          className="h-20 w-32 shrink-0 rounded-md border object-cover"
        />
        <div className="min-w-0">
          <p className="font-bold leading-tight">{article.title}</p>
          {article.excerpt && (
            <p className="mt-1 line-clamp-3 text-sm">{article.excerpt}</p>
          )}
          {!article.published && (
            <p className="mt-1 text-xs font-bold text-orange-500">Draft</p>
          )}
        </div>
      </Link>
      {isStaff && (
        <Link
          href={`/guide/edit/${article.id}`}
          className="shrink-0 self-start text-muted-foreground hover:text-orange-500"
          aria-label={`Edit ${article.title}`}
        >
          <Pencil className="h-4 w-4" />
        </Link>
      )}
    </div>
  );
};
