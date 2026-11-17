import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ListChecks } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { fetchAgencyStaff } from "@/lib/staff.functions";
import { staffName, type StaffMember } from "@/lib/staff";
import { fetchStaffQueue } from "@/lib/staff-queue.functions";
import {
  filterStaffQueue,
  parseStaffQueueSearch,
  sortStaffQueue,
  staffQueueClients,
  STAFF_QUEUE_REASONS,
  STAFF_QUEUE_REASON_LABELS,
  UNASSIGNED,
  type StaffQueueItem,
  type StaffQueueSearch,
} from "@/lib/staff-queue";
import { daysLabel } from "@/lib/waiting-on";
import { StatusBadge } from "@/components/status-badge";
import { ClaimQuickEditButton } from "@/components/staff/claim-quick-edit";
import { PastTargetBadge } from "@/components/staff/past-target-badge";
import { ResponseTargetsPanel } from "@/components/staff/response-targets-panel";
import { cn } from "@/lib/utils";

// Staff work queue (fix 52), the agency admins' landing page. Not nested under
// admin.tsx (the trailing underscore), so /admin keeps its own page.
export const Route = createFileRoute("/_app/admin_/queue")({
  // client, reason, assignee and sort live in the URL, like /claims.
  validateSearch: parseStaffQueueSearch,
  head: () => ({ meta: [{ title: "Work Queue | ClaimsQR" }] }),
  component: StaffQueuePage,
});

const STAFF_QUEUE_QUERY_KEY = ["staff-queue"] as const;
const AGENCY_STAFF_QUERY_KEY = ["agency-staff"] as const;

const SELECT_CLASS =
  "h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base md:h-9 md:w-auto md:text-sm";

function StaffQueuePage() {
  const { role } = useAuth();
  const isAdmin = role === "agency_admin";
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const getQueue = useServerFn(fetchStaffQueue);
  const getStaff = useServerFn(fetchAgencyStaff);

  const queue = useQuery({
    queryKey: STAFF_QUEUE_QUERY_KEY,
    queryFn: () => getQueue(),
    enabled: isAdmin,
  });
  const { data: staff = [] } = useQuery({
    queryKey: AGENCY_STAFF_QUERY_KEY,
    queryFn: () => getStaff(),
    enabled: isAdmin,
    staleTime: 5 * 60_000,
  });

  if (!isAdmin) {
    return <div className="text-muted-foreground">Admin access required.</div>;
  }

  const all = queue.data?.items ?? [];
  const items = sortStaffQueue(filterStaffQueue(all, search), search.sort);
  const clients = staffQueueClients(all);
  const setFilter = (next: Partial<StaffQueueSearch>) =>
    navigate({ search: (prev) => ({ ...prev, ...next }) });
  const refetch = () => void queue.refetch();
  const filtered = !!(search.client || search.reason || search.assignee);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-navy flex items-center gap-2">
          <ListChecks className="h-6 w-6 text-gold" aria-hidden />
          Work Queue
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Claims across all clients that need something from the agency.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:flex md:flex-wrap md:items-end">
        <FilterSelect
          id="queue-client"
          label="Client"
          value={search.client ?? ""}
          onChange={(v) => setFilter({ client: v || undefined })}
        >
          <option value="">All clients</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          id="queue-reason"
          label="Reason"
          value={search.reason ?? ""}
          onChange={(v) => setFilter({ reason: (v || undefined) as StaffQueueSearch["reason"] })}
        >
          <option value="">All reasons</option>
          {STAFF_QUEUE_REASONS.map((r) => (
            <option key={r} value={r}>
              {STAFF_QUEUE_REASON_LABELS[r]}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          id="queue-assignee"
          label="Assigned to"
          value={search.assignee ?? ""}
          onChange={(v) => setFilter({ assignee: v || undefined })}
        >
          <option value="">Anyone</option>
          <option value={UNASSIGNED}>Unassigned</option>
          {staff.map((s) => (
            <option key={s.userId} value={s.userId}>
              {s.name}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          id="queue-sort"
          label="Sort by age"
          value={search.sort ?? "oldest"}
          onChange={(v) => setFilter({ sort: v === "newest" ? "newest" : undefined })}
        >
          <option value="oldest">Oldest first</option>
          <option value="newest">Newest first</option>
        </FilterSelect>
      </div>

      <p className="text-sm text-muted-foreground" aria-live="polite">
        {queue.isLoading
          ? "Loading…"
          : filtered
            ? `${items.length} of ${all.length} claim${all.length === 1 ? "" : "s"}`
            : `${all.length} claim${all.length === 1 ? "" : "s"}`}
      </p>

      {queue.isError ? (
        <p className="rounded-lg border border-border bg-card p-6 text-sm text-destructive">
          Couldn't load the work queue. Try refreshing.
        </p>
      ) : (
        <>
          {/* Phones get cards; the table starts at md, like the claims list. */}
          <ul className="md:hidden space-y-3">
            {!queue.isLoading && items.length === 0 && (
              <li className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
                {filtered ? "Nothing matches these filters." : "Nothing is waiting on the agency."}
              </li>
            )}
            {items.map((item) => (
              <li key={item.claimId}>
                <QueueCard item={item} staff={staff} onSaved={refetch} />
              </li>
            ))}
          </ul>

          <div className="hidden md:block rounded-lg border border-border bg-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="text-left p-3">
                    Client
                  </th>
                  <th scope="col" className="text-left p-3">
                    Claim
                  </th>
                  <th scope="col" className="text-left p-3">
                    Reason
                  </th>
                  <th
                    scope="col"
                    className="text-right p-3"
                    aria-sort={search.sort === "newest" ? "ascending" : "descending"}
                  >
                    Age
                  </th>
                  <th scope="col" className="text-left p-3">
                    Assigned to
                  </th>
                  <th scope="col" className="p-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {!queue.isLoading && items.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-muted-foreground">
                      {filtered
                        ? "Nothing matches these filters."
                        : "Nothing is waiting on the agency."}
                    </td>
                  </tr>
                )}
                {items.map((item) => (
                  <tr key={item.claimId} className="border-t border-border align-top">
                    <td className="p-3">{item.clientName || "—"}</td>
                    <td className="p-3">
                      <ClaimLink item={item} />
                    </td>
                    <td className="p-3">
                      <Reasons item={item} />
                    </td>
                    <td className="p-3 text-right tabular-nums whitespace-nowrap">
                      {daysLabel(item.ageDays)}
                    </td>
                    <td className="p-3">
                      <Assignee staff={staff} userId={item.assignedTo} />
                    </td>
                    <td className="p-3 text-right whitespace-nowrap">
                      <ClaimQuickEditButton claimId={item.claimId} onSaved={refetch} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <ResponseTargetsPanel targets={queue.data?.targets} staff={staff} onSaved={refetch} />
    </div>
  );
}

function FilterSelect({
  id,
  label,
  value,
  onChange,
  children,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={SELECT_CLASS}
      >
        {children}
      </select>
    </div>
  );
}

function ClaimLink({ item }: { item: StaffQueueItem }) {
  return (
    <div className="min-w-0">
      <Link
        to="/claims/$claimId"
        params={{ claimId: item.claimId }}
        className="font-medium text-navy hover:text-gold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
      >
        {/* Display copy for a missing claim number, not a claim status. */}
        <span className={item.claimNumber ? "font-mono text-xs" : "italic"}>
          {item.claimNumber ?? "Number pending"}
        </span>
      </Link>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="truncate">{item.claimType}</span>
        <StatusBadge status={item.status} />
        {item.pastTarget && <PastTargetBadge />}
      </div>
    </div>
  );
}

function Reasons({ item }: { item: StaffQueueItem }) {
  const several = item.reasons.length > 1;
  return (
    <ul className="space-y-1">
      {item.reasons.map((r, i) => (
        <li key={`${r.kind}:${i}`} className="break-words">
          {r.label}
          {several && (
            <span className="text-xs text-muted-foreground"> · {daysLabel(r.ageDays)}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function Assignee({ staff, userId }: { staff: readonly StaffMember[]; userId: string | null }) {
  return (
    <span className={cn(!userId && "text-muted-foreground italic")}>
      {staffName(staff, userId)}
    </span>
  );
}

function QueueCard({
  item,
  staff,
  onSaved,
}: {
  item: StaffQueueItem;
  staff: readonly StaffMember[];
  onSaved: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground truncate">{item.clientName || "—"}</p>
          <ClaimLink item={item} />
        </div>
        <span className="shrink-0 text-sm tabular-nums">{daysLabel(item.ageDays)}</span>
      </div>
      <div className="mt-3 pt-3 border-t border-border text-sm">
        <Reasons item={item} />
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-sm">
        <span className="min-w-0 truncate">
          <span className="text-xs text-muted-foreground">Assigned to </span>
          <Assignee staff={staff} userId={item.assignedTo} />
        </span>
        <ClaimQuickEditButton claimId={item.claimId} onSaved={onSaved} />
      </div>
    </div>
  );
}
