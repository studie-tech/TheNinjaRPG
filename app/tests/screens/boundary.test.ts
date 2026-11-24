import { expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "@babel/parser";

const sourceRoot = join(import.meta.dirname, "../../src");
const routeRoot = join(sourceRoot, "app");
const pages = readdirSync(routeRoot, { recursive: true })
  .map(String)
  .filter((file) => /(^|\/)page\.[jt]sx?$/.test(file));

it.each(pages)("%s delegates its UI to a screen", (file) => {
  const source = readFileSync(join(routeRoot, file), "utf8");
  const ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
  const imports = ast.program.body.filter((node) => node.type === "ImportDeclaration");
  const screenImport = imports.find((node) =>
    node.source.value.startsWith("@/screens/"),
  );
  expect(screenImport, file).toBeDefined();
  const entry = ast.program.body.find(
    (node) => node.type === "ExportDefaultDeclaration",
  );
  expect(entry?.type).toBe("ExportDefaultDeclaration");
  if (entry?.type !== "ExportDefaultDeclaration") return;
  expect(entry.declaration.type).toBe("FunctionDeclaration");
  if (entry.declaration.type !== "FunctionDeclaration") return;
  // Route adapters resolve framework props and render one screen, without game UI or hooks.
  expect(entry.declaration.body.body).toHaveLength(1);
  const statement = entry.declaration.body.body[0];
  expect(statement?.type).toBe("ReturnStatement");
  if (statement?.type !== "ReturnStatement") return;
  expect(statement.argument?.type).toBe("JSXElement");
  if (statement.argument?.type !== "JSXElement") return;
  const tag = statement.argument.openingElement.name;
  expect(tag.type).toBe("JSXIdentifier");
  if (tag.type !== "JSXIdentifier") return;
  expect(screenImport?.specifiers.map((binding) => binding.local.name)).toContain(
    tag.name,
  );
  expect(
    imports.every(
      (node) =>
        node.source.value.startsWith("@/screens/") || node.source.value === "react",
    ),
  ).toBe(true);
});

it("screens do not import route implementations or read dynamic route parameters", () => {
  const root = join(sourceRoot, "screens");
  for (const file of readdirSync(root, { recursive: true })
    .map(String)
    .filter((file) => /\.[jt]sx?$/.test(file))) {
    const source = readFileSync(join(root, file), "utf8");
    expect(source, file).not.toContain("@/app/[shell]");
    expect(source, file).not.toMatch(/\buseParams\s*[(<]/);
  }
});
