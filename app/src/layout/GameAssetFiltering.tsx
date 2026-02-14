import { api } from "@/app/_trpc/client";
import { GameAssetTypes } from "@/drizzle/constants";
import {
  buildFilter,
  ContentFiltering,
  defineFilteringSchema,
  toOptions,
  useContentFiltering,
} from "@/layout/ContentFiltering";

interface GameAssetFilteringProps {
  state: GameAssetFilteringState;
}

const makeGameAssetSchema = (folderOptions: { value: string; label: string }[]) =>
  defineFilteringSchema({
    fields: [
      { id: "name", label: "Name", type: "text", defaultValue: "" },
      {
        id: "type",
        label: "Type",
        type: "single-select",
        defaultValue: "ALL",
        includeNone: true,
        emptyValues: ["ALL"],
        noneOption: { value: "ALL", label: "All" },
        options: toOptions(GameAssetTypes.filter((type) => type !== "ANIMATION")),
      },
      {
        id: "folder",
        label: "Folder",
        type: "single-select",
        defaultValue: "None",
        includeNone: true,
        emptyValues: ["None"],
        noneOption: { value: "None", label: "All" },
        options: folderOptions,
      },
    ] as const,
  });

const GameAssetFiltering: React.FC<GameAssetFilteringProps> = (props) => {
  // Fetch folders with counts to populate dropdown
  const { data: folders } = api.gameAsset.getAllFolders.useQuery(undefined);
  const folderOptions = (folders ?? [])
    .filter((f) => f.folder && f.folder.length > 0)
    .map((f) => ({ value: f.folder, label: `${f.folder} (${f.count})` }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <ContentFiltering
      schema={makeGameAssetSchema(folderOptions)}
      state={props.state.cf}
      triggerButtonId="filter-assets"
    />
  );
};

export default GameAssetFiltering;

export const getFilter = (state: GameAssetFilteringState) =>
  // Build with an empty options list; options don't affect filter shape
  buildFilter(state.cf, makeGameAssetSchema([]));

export const useFiltering = () => {
  // Initialize with empty folder options; will be replaced at render time
  const cf = useContentFiltering(makeGameAssetSchema([]));
  return {
    ...cf.values,
    cf,
    setName: cf.setters.name,
    setType: cf.setters.type,
    setFolder: cf.setters.folder,
  };
};

export type GameAssetFilteringState = ReturnType<typeof useFiltering>;
