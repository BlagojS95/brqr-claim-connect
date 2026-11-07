import { createFileRoute } from "@tanstack/react-router";
import { ClaimForm } from "@/components/claim-form";

export const Route = createFileRoute("/_app/claims/notice")({
  head: () => ({ meta: [{ title: "Incident Notice Only | BRQR Claims Portal" }] }),
  component: () => <ClaimForm isNotice={true} />,
});
