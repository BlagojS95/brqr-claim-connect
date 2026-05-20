import { createFileRoute } from "@tanstack/react-router";
import { ClaimForm } from "@/components/claim-form";

export const Route = createFileRoute("/_app/claims/notice")({
  component: () => <ClaimForm isNotice={true} />,
});
