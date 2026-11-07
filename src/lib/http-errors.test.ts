import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { fromJSON, toJSONAsync } from "seroval";
import { defaultSerovalPlugins } from "@tanstack/router-core/ssr/client";

const { setResponseStatus } = vi.hoisted(() => ({ setResponseStatus: vi.fn() }));
vi.mock("@tanstack/react-start/server", () => ({ setResponseStatus }));

import { HttpError, statusForError, validationMessage } from "./http-errors";
import {
  forbidden,
  parseInput,
  setErrorStatus,
  unauthorized,
  unprocessable,
} from "./http-errors.server";

beforeEach(() => setResponseStatus.mockClear());

function caught(fn: () => unknown): HttpError {
  try {
    fn();
  } catch (err) {
    return err as HttpError;
  }
  throw new Error("expected a throw");
}

describe("http error helpers", () => {
  it.each([
    [
      "unauthorized",
      () => unauthorized("Unauthorized: Invalid token"),
      401,
      "Unauthorized: Invalid token",
    ],
    [
      "forbidden",
      () => forbidden("Unauthorized: agency_admin role required"),
      403,
      "Unauthorized: agency_admin role required",
    ],
    ["unprocessable", () => unprocessable("Write a note first"), 422, "Write a note first"],
  ])("%s sets the response status and throws with the message", (_name, fn, status, message) => {
    const err = caught(fn);
    expect(setResponseStatus).toHaveBeenCalledWith(status);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(status);
    expect(err.message).toBe(message);
  });

  it("setErrorStatus keeps an HttpError's status and uses 500 for anything else", () => {
    setErrorStatus(new HttpError(422, "bad"));
    expect(setResponseStatus).toHaveBeenLastCalledWith(422);
    setErrorStatus(new Error("database down"));
    expect(setResponseStatus).toHaveBeenLastCalledWith(500);
    expect(statusForError("not even an error")).toBe(500);
  });
});

describe("parseInput", () => {
  const Schema = z.object({
    claimId: z.string().uuid("Invalid claim"),
    body: z.string().trim().min(1, "Write a note first"),
  });

  it("returns the parsed data when valid", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(parseInput(Schema)({ claimId: id, body: "  hi " })).toEqual({ claimId: id, body: "hi" });
    expect(setResponseStatus).not.toHaveBeenCalled();
  });

  it("answers 422 with the schema's messages when invalid", () => {
    const err = caught(() => parseInput(Schema)({ claimId: "nope", body: "" }));
    expect(setResponseStatus).toHaveBeenCalledWith(422);
    expect(err.status).toBe(422);
    expect(err.message).toBe("Invalid claim; Write a note first");
  });

  it("validationMessage drops duplicate messages", () => {
    const result = z.array(z.number({ invalid_type_error: "Numbers only" })).safeParse(["a", "b"]);
    expect(result.success).toBe(false);
    if (!result.success) expect(validationMessage(result.error)).toBe("Numbers only");
  });
});

// The server function response is serialized with TanStack Start's seroval
// plugins; the browser gets back an Error whose message is what toasts show.
describe("serialization to the browser", () => {
  it("keeps the error message", async () => {
    const payload = {
      result: undefined,
      error: new HttpError(403, "Unauthorized: agency_admin role required"),
      context: {},
    };
    const json = await toJSONAsync(payload, { plugins: defaultSerovalPlugins });
    const back = fromJSON(JSON.parse(JSON.stringify(json)), {
      plugins: defaultSerovalPlugins,
    }) as typeof payload;
    expect(back.error).toBeInstanceOf(Error);
    expect(back.error.message).toBe("Unauthorized: agency_admin role required");
  });
});
