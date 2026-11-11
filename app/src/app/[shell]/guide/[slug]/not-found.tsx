import NotFoundPage from "@/components/layout/NotFoundPage";

/** A guide link that no longer matches a published guide. */
export default function GuideNotFound() {
  return (
    <NotFoundPage
      message="This guide does not exist. It may have been renamed or removed."
      defaultBackHref="/guide"
      links={[
        { href: "/guide", label: "Browse all guides" },
        { href: "/manual", label: "Open the manual" },
        { href: "/", label: "Return to the front page" },
      ]}
    />
  );
}
