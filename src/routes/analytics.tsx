import { createFileRoute, redirect } from "@tanstack/react-router";

// Old address, kept working after the navigation change (fix 21).
export const Route = createFileRoute("/analytics")({
  beforeLoad: () => {
    throw redirect({ to: "/reports", search: { tab: "loss-summary" }, replace: true });
  },
});
