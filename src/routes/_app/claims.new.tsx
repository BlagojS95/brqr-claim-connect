import { createFileRoute } from "@tanstack/react-router";
import { ClaimForm } from "@/components/claim-form";

export const Route = createFileRoute("/_app/claims/new")({
  head: () => ({ meta: [{ title: "Report New Claim | BRQR Claims Portal" }] }),
  component: () => <ClaimForm isNotice={false} />,
});
