import { createFileRoute, redirect } from "@tanstack/react-router";

// Old address, kept working after the navigation change (fix 21).
export const Route = createFileRoute("/dashboard")({
  beforeLoad: () => {
    throw redirect({ to: "/home", replace: true });
  },
});
