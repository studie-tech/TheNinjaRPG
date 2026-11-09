import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parse } from "@babel/parser";

const source = join(import.meta.dirname, "../../src");
const cacheFields = new Set([
  "userPatch",
  "userDelta",
  "userExpected",
  "userNotifications",
]);
type SyntaxNode = { type: string; [key: string]: unknown };

const visit = (
  value: unknown,
  inspect: (node: SyntaxNode, parents: SyntaxNode[]) => void,
  parents: SyntaxNode[] = [],
) => {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((child) => visit(child, inspect, parents));
    return;
  }
  const node = value as SyntaxNode;
  if (!node.type) return;
  inspect(node, parents);
  for (const [key, child] of Object.entries(node))
    if (!["loc", "start", "end", "comments", "tokens"].includes(key))
      visit(child, inspect, [...parents, node]);
};

const inspectFile = (
  file: string,
  inspect: (node: SyntaxNode, parents: SyntaxNode[]) => void,
) =>
  visit(
    parse(readFileSync(file, "utf8"), {
      sourceType: "module",
      plugins: ["typescript"],
    }),
    inspect,
  );

describe("feature delta boundary", () => {
  it("keeps router cache calculations in delta modules while allowing response forwarding and schemas", () => {
    const violations: string[] = [];
    const directory = join(source, "server/api/routers");
    for (const name of readdirSync(directory).filter((name) => name.endsWith(".ts"))) {
      inspectFile(join(directory, name), (node, parents) => {
        if (
          parents.some(
            (parent) =>
              parent.type === "CallExpression" &&
              (parent.callee as SyntaxNode)?.type === "MemberExpression" &&
              ((parent.callee as SyntaxNode).property as SyntaxNode)?.name === "output",
          )
        )
          return;
        if (
          node.type === "VariableDeclarator" &&
          cacheFields.has(String((node.id as SyntaxNode)?.name))
        ) {
          const initial = node.init as SyntaxNode | undefined;
          if (
            initial &&
            ![
              "CallExpression",
              "AwaitExpression",
              "Identifier",
              "MemberExpression",
              "OptionalMemberExpression",
            ].includes(initial.type)
          )
            violations.push(
              `${name}: ${String((node.id as SyntaxNode).name)} initializer (${initial.type})`,
            );
        }
        if (
          node.type !== "ObjectProperty" ||
          !cacheFields.has(String((node.key as SyntaxNode)?.name))
        )
          return;
        const value = node.value as SyntaxNode;
        if (
          ["Identifier", "MemberExpression", "OptionalMemberExpression"].includes(
            value.type,
          )
        )
          return;
        violations.push(
          `${name}: ${String((node.key as SyntaxNode).name)} (${value.type})`,
        );
      });
    }
    expect(violations).toEqual([]);
  });

  it("keeps database operations and runtime router dependencies out of delta modules", () => {
    const violations: string[] = [];
    const directory = join(source, "deltas");
    for (const name of readdirSync(directory).filter((name) => name.endsWith(".ts"))) {
      const file = join(directory, name);
      inspectFile(file, (node) => {
        if (
          node.type === "ImportDeclaration" &&
          node.importKind !== "type" &&
          /^(?:@\/queries\/|@\/(?:routers\/|server\/api\/routers\/)|@\/server\/db$|@\/drizzle\/schema$|drizzle-orm(?:\/|$))/.test(
            String((node.source as SyntaxNode)?.value),
          ) &&
          (node.specifiers as SyntaxNode[]).some(
            (specifier) => specifier.importKind !== "type",
          )
        )
          violations.push(`${relative(source, file)}: runtime database/router import`);
        if (
          node.type === "CallExpression" &&
          (node.callee as SyntaxNode)?.type === "MemberExpression"
        ) {
          const callee = node.callee as SyntaxNode;
          const receiver = callee.object as SyntaxNode;
          if (
            receiver.type === "Identifier" &&
            ["drizzle", "client", "db", "tx", "drizzleDB"].includes(
              String(receiver.name),
            )
          )
            violations.push(`${relative(source, file)}: database call`);
        }
      });
    }
    expect(violations).toEqual([]);
  });
});
