/**
 * How the battle's action icons are laid out. Both layouts hide names only when the
 * small-icon setting is enabled; battle focus keeps its icons in a denser grid.
 */
export const battleActionGrid = ({
  focus,
  small,
}: {
  focus: boolean;
  small: boolean;
}) => {
  if (focus) {
    return {
      grid: small
        ? "grid grid-cols-[repeat(auto-fill,minmax(52px,1fr))] gap-1"
        : "grid grid-cols-[repeat(auto-fill,minmax(76px,1fr))] gap-1",
      aspect: "aspect-square",
      labels: !small,
    };
  }
  return small
    ? {
        grid: "grid grid-cols-7 md:grid-cols-9 gap-1",
        aspect: "aspect-square",
        labels: false,
      }
    : {
        grid: "grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))]",
        aspect: undefined,
        labels: true,
      };
};
