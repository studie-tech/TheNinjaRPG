import { useLocalStorage } from "@/hooks/localstorage";
import { safeLocalStorageGetItem } from "@/utils/storage";

/** Browser-stored auto-attack settings; their keys hold saved player preferences. */
export const AUTO_ATTACK_SETTINGS = {
  minLevel: { key: "autoAttackMinLevel", default: 1, min: 1, max: 100 },
  delay: { key: "autoAttackDelay", default: 5, min: 1, max: 60 },
} as const;

/** Whether ANBU auto attack is on, kept in sync across every mounted reader. */
export const useAutoAttackMode = () =>
  useLocalStorage<boolean>("autoAttackMode", false);

/** Read a setting straight from storage, so a run sees a value saved in the same tick. */
export const readAutoAttackSetting = (
  setting: (typeof AUTO_ATTACK_SETTINGS)[keyof typeof AUTO_ATTACK_SETTINGS],
) => parseInt(safeLocalStorageGetItem(setting.key) || String(setting.default), 10);
