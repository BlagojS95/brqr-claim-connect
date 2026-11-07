import { setResponseStatus } from "@tanstack/react-start/server";
import type { z } from "zod";
import { HttpError, statusForError, validationMessage } from "@/lib/http-errors";

// TanStack Start answers a server function that throws with HTTP 200 unless
// the status is set on the response. These set it and throw; the message is
// what the browser's err.message (and so the toast) shows.

export function httpError(status: number, message: string): never {
  setResponseStatus(status);
  throw new HttpError(status, message);
}

// Function declarations (not arrow consts) so TypeScript narrows after a call.
export function unauthorized(message = "Unauthorized"): never {
  return httpError(401, message);
}

export function forbidden(message = "Forbidden"): never {
  return httpError(403, message);
}

export function unprocessable(message: string): never {
  return httpError(422, message);
}

// For .inputValidator(): a schema failure is a 422 with the schema's messages.
export function parseInput<S extends z.ZodTypeAny>(schema: S) {
  return (input: unknown): z.output<S> => {
    const result = schema.safeParse(input);
    if (result.success) return result.data;
    return unprocessable(validationMessage(result.error));
  };
}

// Sets the status for an error a server function is about to return:
// HttpError keeps its own, anything unexpected becomes 500.
export function setErrorStatus(error: unknown): void {
  setResponseStatus(statusForError(error));
}
