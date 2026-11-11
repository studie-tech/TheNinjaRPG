import NotFoundPage from "@/components/layout/NotFoundPage";

/** A profile link whose player no longer exists under that name. */
export default function PlayerNotFound() {
  return (
    <NotFoundPage
      message="This player could not be found. They may have changed their name or left the game."
      defaultBackHref="/users"
      links={[
        { href: "/users", label: "Browse players" },
        { href: "/", label: "Return to the front page" },
      ]}
    />
  );
}
