/**
 * How the battle's action icons are laid out. The small-icon setting applies in both the game
 * layout and battle focus; focus never shows labels, so its larger size only grows the icons.
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
      grid: `grid grid-cols-[repeat(auto-fill,minmax(${small ? "52px" : "76px"},1fr))] gap-1`,
      aspect: "aspect-square",
      labels: false,
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
