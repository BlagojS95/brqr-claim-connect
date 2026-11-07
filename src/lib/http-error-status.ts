import { createMiddleware } from "@tanstack/react-start";
import { isNotFound, isRedirect } from "@tanstack/react-router";
import { setErrorStatus } from "@/lib/http-errors.server";

// Registered globally in src/start.ts so every server function that throws
// answers with a real status: an HttpError's own (401/403/422), otherwise 500.
// Redirects and notFound() keep TanStack's handling. Kept apart from
// http-errors.server.ts because start.ts is also bundled for the browser,
// where only this .server() body is stripped.
export const httpErrorStatus = createMiddleware({ type: "function" }).server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (!isRedirect(error) && !isNotFound(error)) setErrorStatus(error);
    throw error;
  }
});
