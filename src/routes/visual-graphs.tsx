import { createFileRoute, redirect } from "@tanstack/react-router";

// Old address, kept working after the navigation change (fix 21).
export const Route = createFileRoute("/visual-graphs")({
  beforeLoad: () => {
    throw redirect({ to: "/insights", replace: true });
  },
});
