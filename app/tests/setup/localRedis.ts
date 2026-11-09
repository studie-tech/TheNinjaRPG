import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { delimiter, join } from "node:path";
import { Redis } from "@upstash/redis";

const which = (name: string) =>
  process.env.PATH?.split(delimiter)
    .map((directory) => join(directory, name))
    .find(existsSync);
const binary = which("redis-server");
const cli = which("redis-cli");
export const hasLocalRedis = Boolean(binary && cli);

/** Run production Upstash commands/Lua against a disposable real Redis, never the env's service. */
export const startLocalRedis = async (name: string) => {
  if (!binary || !cli) throw new Error("redis-server and redis-cli are required");
  const socket = `/tmp/tnr-${name}-${process.pid}.sock`;
  const processHandle: ChildProcess = spawn(
    binary,
    ["--port", "0", "--unixsocket", socket, "--save", "", "--appendonly", "no"],
    { stdio: "ignore" },
  );
  let server: Server | undefined;
  const close = () => {
    server?.closeAllConnections();
    server?.close();
    processHandle.kill();
  };
  try {
    const deadline = Date.now() + 3000;
    while (!existsSync(socket) && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 20));
    if (!existsSync(socket)) throw new Error("Isolated Redis did not start");
    server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        try {
          const args = JSON.parse(body) as unknown[];
          const raw: unknown = JSON.parse(
            execFileSync(cli, ["-s", socket, "--json", ...args.map(String)], {
              encoding: "utf8",
            }),
          );
          const encode = (value: unknown): unknown =>
            typeof value === "string"
              ? Buffer.from(value).toString("base64")
              : Array.isArray(value)
                ? value.map(encode)
                : value;
          const result =
            request.headers["upstash-encoding"] === "base64" && raw !== "OK"
              ? encode(raw)
              : raw;
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ result }));
        } catch {
          response.writeHead(500, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "Local Redis command failed" }));
        }
      });
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    return {
      redis: new Redis({
        url: `http://127.0.0.1:${port}`,
        token: "local-test-only",
        enableAutoPipelining: false,
      }),
      close,
    };
  } catch (error) {
    close();
    throw error;
  }
};
