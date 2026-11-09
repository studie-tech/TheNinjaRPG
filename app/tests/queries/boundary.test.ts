import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse } from "@babel/parser";

/** Application source directory whose database statement boundary is checked. */
const sourceRoot = join(import.meta.dirname, "../../src");
/** Statement and builder methods that must stay inside the query layer. */
const queryMethods = new Set([
  "$count",
  "with",
  "for",
  "select",
  "selectDistinct",
  "selectDistinctOn",
  "insert",
  "$with",
  "where",
  "innerJoin",
  "leftJoin",
  "rightJoin",
  "fullJoin",
  "onDuplicateKeyUpdate",
  "$dynamic",
]);
/** Known database receiver names used to distinguish writes from ordinary collection methods. */
const databaseNames = new Set([
  "drizzle",
  "drizzleDB",
  "client",
  "database",
  "db",
  "tx",
  "transaction",
]);

/** Enumerate source files recursively so boundary checks cover nested features and route handlers. */
const filesIn = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? filesIn(path)
      : /\.[cm]?[jt]sx?$/.test(entry.name)
        ? [path]
        : [];
  });

/** Inspect syntax rather than comments, SQL text, whitespace or method-looking strings. */
const databaseCalls = (source: string) => {
  const tree = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
  const calls: string[] = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const node = value as SyntaxNode;
    if (node.type === "CallExpression" || node.type === "OptionalCallExpression") {
      const callee = node.callee as SyntaxNode | undefined;
      if (
        callee?.type === "MemberExpression" ||
        callee?.type === "OptionalMemberExpression"
      ) {
        const name = propertyName(callee);
        const receiver = callee.object as SyntaxNode;
        const isDatabase =
          (receiver.type === "Identifier" &&
            databaseNames.has(String(receiver.name))) ||
          ((receiver.type === "MemberExpression" ||
            receiver.type === "OptionalMemberExpression") &&
            propertyName(receiver) === "drizzle");
        const relation = receiver.object as SyntaxNode | undefined;
        const isRelationalQuery =
          (name === "findFirst" || name === "findMany") &&
          (relation?.type === "MemberExpression" ||
            relation?.type === "OptionalMemberExpression") &&
          propertyName(relation) === "query";
        const isTextSelection =
          name === "select" &&
          ["current", "currentTarget"].includes(propertyName(receiver)) &&
          (node.arguments as unknown[]).length === 0;
        if (
          !isTextSelection &&
          (queryMethods.has(name) ||
            isRelationalQuery ||
            (isDatabase && ["update", "delete", "execute"].includes(name)))
        )
          calls.push(name);
      }
    }
    for (const [key, child] of Object.entries(node)) {
      if (!["loc", "start", "end", "extra", "comments", "tokens"].includes(key))
        visit(child);
    }
  };
  visit(tree);
  return calls;
};

/** Read a member name from dot or literal bracket syntax for the boundary detector. */
const propertyName = (node: SyntaxNode) => {
  const property = node.property as SyntaxNode | undefined;
  return String(property?.name ?? property?.value ?? "");
};

describe("database query boundary", () => {
  // Parsing the whole application needs a separate budget when CI shards share the CPU.
  it("keeps statement definitions and query builder continuations in queries/", () => {
    const violations = filesIn(sourceRoot)
      .filter((file) => !relative(sourceRoot, file).startsWith("queries/"))
      .flatMap((file) => {
        const calls = databaseCalls(readFileSync(file, "utf8"));
        return calls.length
          ? [`${relative(sourceRoot, file)}: ${calls.join(", ")}`]
          : [];
      });
    expect(violations).toEqual([]);
  }, 20_000);

  it("covers the installed adapter's database entry points", () => {
    const { program } = parse(
      readFileSync(
        join(sourceRoot, "../node_modules/drizzle-orm/mysql-core/db.d.ts"),
        "utf8",
      ),
      {
        sourceType: "module",
        plugins: ["typescript"],
      },
    );
    let declaration: Extract<
      (typeof program.body)[number],
      { type: "ClassDeclaration" }
    > | null = null;
    for (const node of program.body) {
      const candidate =
        node.type === "ExportNamedDeclaration" ? node.declaration : node;
      if (
        candidate?.type === "ClassDeclaration" &&
        candidate.id?.name === "MySqlDatabase"
      ) {
        declaration = candidate;
        break;
      }
    }
    if (declaration?.type !== "ClassDeclaration")
      throw new Error("MySqlDatabase declaration not found");
    const entryPoints = declaration.body.body.flatMap((member) => {
      if (
        (member.type === "TSDeclareMethod" || member.type === "ClassMethod") &&
        member.key.type === "Identifier" &&
        !["constructor", "transaction"].includes(member.key.name)
      )
        return [member.key.name];
      return [];
    });
    expect(entryPoints.length).toBeGreaterThan(5);
    for (const method of entryPoints)
      expect(databaseCalls(`client.${method}()`)).toContain(method);
  });

  it("recognizes reads, writes, subqueries, aliases, bracket access and split builders", () => {
    for (const source of [
      "ctx.drizzle.query.userData.findFirst({})",
      "other.query.userData.findMany({})",
      "drizzleDB.update(userData).set({})",
      "tx.delete(userItem)",
      "client.execute(statement)",
      "client.$count(userData)",
      "builder.for('update')",
      "connection['select']().from(userData)",
      "builder.where(condition)",
      "builder.innerJoin(userData, condition)",
    ])
      expect(databaseCalls(source).length).toBeGreaterThan(0);
  });

  it("allows transaction orchestration and ordinary collection operations", () => {
    expect(
      databaseCalls(`
      client.transaction(async tx => fetchUser(tx, id));
      entries.delete(id);
      new Map().delete(id);
      createHash('sha256').update(value);
      textareaRef.current?.select();
      event.currentTarget.select();
      const example = 'client.select().from(userData)';
      // ctx.drizzle.query.userData.findMany({})
    `),
    ).toEqual([]);
  });

  it("keeps the query layer independent of router implementations at runtime", () => {
    const violations = filesIn(join(sourceRoot, "queries")).flatMap((file) => {
      const { program } = parse(readFileSync(file, "utf8"), {
        sourceType: "module",
        plugins: ["typescript"],
      });
      return program.body.flatMap((node) => {
        if (
          node.type !== "ImportDeclaration" ||
          node.importKind === "type" ||
          !/^@\/(?:routers\/|server\/api\/routers\/)/.test(node.source.value)
        )
          return [];
        const hasRuntimeImport = node.specifiers.some(
          (specifier) =>
            specifier.type !== "ImportSpecifier" || specifier.importKind !== "type",
        );
        return hasRuntimeImport
          ? [`${relative(sourceRoot, file)}: ${node.source.value}`]
          : [];
      });
    });
    expect(violations).toEqual([]);
  });
});

/** Minimal syntax-node shape used when walking parser nodes without depending on every node variant. */
type SyntaxNode = { type?: string; [key: string]: unknown };
