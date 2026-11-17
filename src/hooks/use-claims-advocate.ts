import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { fetchClaimsAdvocate } from "@/lib/claims-advocate.functions";
import { hasAdvocateInfo, type ClaimsAdvocateInfo } from "@/lib/claims-advocate";
import { queryKeys } from "@/lib/query-keys";

// Fix 59: the Help block's data. Only for client logins (and agency staff
// viewing as a client, whose role is "client" then).
/** The advocate for the signed-in client, or null for staff / nothing set up. */
export function useClaimsAdvocate(): ClaimsAdvocateInfo | null {
  const { role, clientId } = useAuth();
  const getAdvocate = useServerFn(fetchClaimsAdvocate);
  const enabled = role === "client" && !!clientId;
  const { data } = useQuery({
    queryKey: queryKeys.claimsAdvocate(clientId ?? ""),
    queryFn: () => getAdvocate({ data: { clientId: clientId! } }),
    enabled,
    staleTime: 10 * 60_000,
  });
  return enabled && hasAdvocateInfo(data) ? data! : null;
}
