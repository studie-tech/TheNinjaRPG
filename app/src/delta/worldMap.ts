export const getMoveStructureUserUpdate = ({
  userVillageId,
  structureVillageId,
  structureId,
  inputLongitude,
  inputLatitude,
}: {
  userVillageId: string | null;
  structureVillageId: string;
  structureId: string;
  inputLongitude: number;
  inputLatitude: number;
}) => ({
  userPatch: {},
  userDelta:
    userVillageId === structureVillageId
      ? {
          village: {
            id: structureVillageId,
            structures: {
              update: [
                {
                  id: structureId,
                  longitude: inputLongitude,
                  latitude: inputLatitude,
                },
              ],
            },
          },
        }
      : {},
});
