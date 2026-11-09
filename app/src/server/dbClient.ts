import {
  type Cast,
  Client,
  type Config,
  type Transaction,
} from "@planetscale/database";
import { escapeId, escape as escapeValue, type SqlValue } from "sql-escaper";

/**
 * Keep Drizzle's parameterized calls at the boundary to the SQL-only HTTP driver: values
 * are bound with `sql-escaper` in UTC on the client and its transaction objects, keeping
 * Drizzle's result modes and transaction handling. Construct every Drizzle client through
 * this factory; `tests/server/dbClient.test.ts` covers the integration.
 */
export const createPlanetScaleClient = (config: Config) => {
  const client = new Client(config);
  const transaction = client.transaction.bind(client);
  bindParameters(client);
  client.transaction = <T>(callback: (tx: Transaction) => Promise<T>) =>
    transaction((tx) => callback(bindParameters(tx)));
  return client;
};

// Drizzle's stable PlanetScale adapter still passes (sql, params, options). Adapt
// only these client instances; the driver's own BEGIN/COMMIT/ROLLBACK use (sql, options).
const bindParameters = <T extends Pick<Client, "execute">>(client: T) => {
  const execute = client.execute.bind(client);
  return Object.assign(client, {
    execute: (
      query: string,
      paramsOrOptions?: SqlValue[] | ExecuteOptions,
      options?: ExecuteOptions,
    ) => {
      const hasParameters = Array.isArray(paramsOrOptions);
      const statement = hasParameters
        ? formatParameters(query, paramsOrOptions)
        : query;
      const settings = hasParameters ? options : paramsOrOptions;
      return settings?.as === "array"
        ? execute(statement, { ...settings, as: "array" })
        : execute(statement, { ...settings, as: "object" });
    },
  });
};

// The library formatter does not recognize double-quoted SQL. Scan quoted text,
// identifiers and comments here, and keep value/identifier escaping in sql-escaper.
// MySQL executable comments and optimizer hints retain the formatter's SQL treatment.
const sqlTokens =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: MySQL recognizes ASCII control characters after --.
  /'(?:\\[\s\S]|''|[^'\\])*(?:'|$)|"(?:\\[\s\S]|""|[^"\\])*(?:"|$)|`(?:``|[^`])*(?:`|$)|--(?=[\x00-\x20]|$)[^\r\n]*|#[^\r\n]*|\/\*(?![!+])[\s\S]*?(?:\*\/|$)|\?+/g;

const formatParameters = (query: string, parameters: SqlValue[]) => {
  let index = 0;
  return query.replace(sqlTokens, (token) => {
    if (token[0] !== "?" || token.length > 2 || index >= parameters.length) {
      return token;
    }
    const value = parameters[index++];
    return token.length === 2 ? escapeId(value) : escapeValue(value, true, "Z");
  });
};

type ExecuteOptions = { as?: "array" | "object"; cast?: Cast };
