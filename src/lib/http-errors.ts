import type { ZodError } from "zod";

// An error with the HTTP status a server function should answer with. Shared
// code (no server imports) can throw it; the global server-function middleware
// in src/start.ts turns it into the response status. Only the message reaches
// the browser, so keep it friendly.
export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export const unprocessableError = (message: string) => new HttpError(422, message);

// HttpError keeps its status; anything else is an unexpected failure.
export function statusForError(error: unknown): number {
  return error instanceof HttpError ? error.status : 500;
}

// "Write a note first; Policy is required" rather than Zod's JSON dump.
export function validationMessage(error: ZodError): string {
  const messages = [...new Set(error.issues.map((issue) => issue.message))];
  return messages.join("; ") || "Invalid input";
}
