// Plain-language error text (fix 60). Raw server and database messages
// ("JWT expired", "permission denied for table claims", "Failed to fetch")
// mean nothing to a client, so pages show one of these instead.

export const ERROR_TEXT = {
  offline: "We couldn't reach ClaimsQR. Check your internet connection and try again.",
  session: "Your session has ended. Sign in again to continue.",
  access: "You don't have access to this. If you think you should, contact your agency.",
  generic: "Something went wrong on our side. Please try again in a moment.",
} as const;

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "";
}

/** One plain sentence for any thrown value. */
export function plainErrorMessage(error: unknown): string {
  const message = messageOf(error);
  if (/failed to fetch|networkerror|network request failed|load failed/i.test(message)) {
    return ERROR_TEXT.offline;
  }
  if (
    /agency_admin role required|forbidden|permission denied|row-level security|read-only/i.test(
      message,
    )
  ) {
    return ERROR_TEXT.access;
  }
  if (
    /unauthori[sz]ed|jwt|invalid token|no authorization|session.*(expired|missing)/i.test(message)
  ) {
    return ERROR_TEXT.session;
  }
  return ERROR_TEXT.generic;
}
