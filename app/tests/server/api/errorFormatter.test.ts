import { describe, expect, it } from "bun:test";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter } from "@/server/api/trpc";

const { errorFormatter } = createTRPCRouter({})._def._config;

const shape = {
  message: "Failed query: select secret from UserData",
  code: -32603,
  data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
};

const format = (cause: unknown) =>
  errorFormatter({
    shape,
    error: new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause }),
    type: "mutation",
    path: "test",
    input: undefined,
    ctx: undefined,
  } as never) as unknown as { message: string; data: { zodError: unknown } };

const driverFailure = (body: unknown, name = "DatabaseError") =>
  Object.assign(new Error("Failed query"), {
    cause: Object.assign(new Error("driver"), { name, body }),
  });

describe("tRPC errorFormatter", () => {
  it("leaves errors without a driver cause alone", () => {
    expect(format(new Error("plain")).message).toBe(shape.message);
  });

  it("leaves other driver errors alone", () => {
    const failure = driverFailure({ message: "secret" }, "OtherError");
    expect(format(failure).message).toBe(shape.message);
  });

  it("leaves a driver error without a body alone", () => {
    expect(format(driverFailure(undefined)).message).toBe(shape.message);
  });

  it("serializes a driver body without a message instead of exposing the query", () => {
    expect(format(driverFailure({ code: "unknown" })).message).toBe(
      '{"code":"unknown"}',
    );
  });

  it("reports zod issues beside the message", () => {
    const invalid = z.string().safeParse(1).error;
    expect(format(invalid).data.zodError).toEqual(invalid?.issues);
    expect(format(new Error("plain")).data.zodError).toBeNull();
  });
});
