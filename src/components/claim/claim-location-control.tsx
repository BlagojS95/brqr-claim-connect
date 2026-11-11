import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { setClaimLocation } from "@/lib/client-users.functions";
import { fetchAgencyOverview } from "@/lib/overview.functions";
import { overviewQueryOptions } from "@/lib/query-keys";

const NO_LOCATION = "";

/**
 * The claim's location (fix 32). Agency admins and company-wide users get a
 * dropdown of the client's sites that saves on change; location users see the
 * name. The server checks who may change it again.
 */
export function ClaimLocationControl({
  claim,
  editable,
}: {
  claim: {
    id: string;
    client_id: string;
    location_id: string | null;
    location_name: string | null;
  };
  editable: boolean;
}) {
  const queryClient = useQueryClient();
  const saveLocation = useServerFn(setClaimLocation);
  const getOverview = useServerFn(fetchAgencyOverview);
  const { data: locations = [] } = useQuery({
    ...overviewQueryOptions("claims", getOverview),
    select: (o) => o.locations.filter((l) => l.client_id === claim.client_id),
    enabled: editable,
  });

  const save = useMutation({
    mutationFn: (locationId: string | null) =>
      saveLocation({ data: { claimId: claim.id, locationId } }),
    onSuccess: (_result, locationId) => {
      const name = locations.find((l) => l.id === locationId)?.name;
      toast.success(name ? `Claim moved to ${name}` : "Claim no longer tied to a location");
      // The claim page, the claims list and Insights all show it.
      queryClient.invalidateQueries();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't change the location"),
  });

  if (!editable || locations.length === 0) {
    return <span>{claim.location_name ?? "—"}</span>;
  }

  const current = claim.location_id ?? NO_LOCATION;
  return (
    <select
      aria-label="Location"
      value={save.isPending ? (save.variables ?? NO_LOCATION) : current}
      disabled={save.isPending}
      onChange={(e) => {
        const value = e.target.value;
        if (value !== current) save.mutate(value || null);
      }}
      className="h-10 w-full max-w-[14rem] rounded-md border border-input bg-background px-3 text-base md:h-9 md:text-sm disabled:opacity-60"
    >
      <option value={NO_LOCATION}>No specific location</option>
      {locations.map((l) => (
        <option key={l.id} value={l.id}>
          {l.name}
        </option>
      ))}
    </select>
  );
}
