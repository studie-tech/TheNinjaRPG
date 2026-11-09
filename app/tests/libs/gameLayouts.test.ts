import { describe, expect, it } from "bun:test";
import { runInNewContext } from "node:vm";
import {
  GAME_LAYOUTS,
  getGameLayoutScript,
  getWelcomeLayout,
  toGameLayoutId,
  type GameLayoutId,
} from "@/libs/gameLayouts";
import { storedValueToLayout } from "@/libs/layoutPreference";

describe("unified game layout identity", () => {
  it.each([...GAME_LAYOUTS])(
    "restores $name from either preference representation",
    ({ id }) => {
      expect(toGameLayoutId(id)).toBe(id);
      expect(storedValueToLayout(JSON.stringify(id))).toBe(id);
      expect(getWelcomeLayout(id)).toBe(id);
    },
  );

  it.each([null, undefined, "themed", "unknown", '{"id":"pixel"}'])(
    "rejects invalid or incomplete choices %j",
    (value) => {
      expect(toGameLayoutId(value)).toBeUndefined();
      expect(getWelcomeLayout(value)).toBe("default");
    },
  );
});

describe("layout before first paint", () => {
  const run = (id: GameLayoutId, readStorage: () => string | null = () => null) => {
    const attributes: Record<string, string> = {};
    const classes = new Set<string>();
    runInNewContext(getGameLayoutScript(id), {
      localStorage: { getItem: readStorage },
      document: {
        documentElement: {
          setAttribute: (name: string, value: string) => {
            attributes[name] = value;
          },
          classList: {
            toggle: (name: string, enabled: boolean) => {
              if (enabled) classes.add(name);
              else classes.delete(name);
            },
          },
        },
      },
    });
    return {
      id: attributes["data-game-layout"],
      frame: attributes["data-game-frame"],
      dark: classes.has("dark"),
    };
  };

  it.each([...GAME_LAYOUTS])(
    "paints $name with its document's identity and color scheme",
    (layout) => {
      expect(run(layout.id)).toEqual({
        id: layout.id,
        frame: layout.frame,
        dark: layout.tone === "dark",
      });
    },
  );

  it("honors Classic's saved color mode without changing layout identity", () => {
    expect(run("default", () => "dark")).toEqual({
      id: "default",
      frame: "classic",
      dark: true,
    });
  });

  it.each([...GAME_LAYOUTS])("keeps $name usable when storage is blocked", (layout) => {
    expect(
      run(layout.id, () => {
        throw new Error("Storage blocked");
      }).id,
    ).toBe(layout.id);
  });
});
