// Settings > Activity (fix 51): who signed in, opened or changed a claim, or
// downloaded something. A company's admin sees their company; agency staff see
// every client and can filter. What each person may read is decided by RLS.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { fetchAccessLog } from "@/lib/access-log.functions";
import { claimLinkText, pageCount } from "@/lib/access-log";
import { formatActivityTimestamp } from "@/lib/claim-activity";

const ALL_CLIENTS = "all";

export function ActivitySettings() {
  const getLog = useServerFn(fetchAccessLog);
  const [page, setPage] = useState(0);
  const [clientId, setClientId] = useState<string>(ALL_CLIENTS);

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ["access-log", page, clientId],
    queryFn: () => getLog({ data: { page, clientId: clientId === ALL_CLIENTS ? null : clientId } }),
    placeholderData: (previous) => previous,
  });

  if (error) {
    return (
      <p className="text-sm text-destructive">
        {error instanceof Error ? error.message : "Couldn't load the activity log"}
      </p>
    );
  }
  if (isLoading || !data) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const pages = pageCount(data.total, data.pageSize);
  return (
    <div className="space-y-3">
      {data.clients && (
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Client</span>
          <select
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value);
              setPage(0);
            }}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm max-w-full"
          >
            <option value={ALL_CLIENTS}>All clients</option>
            {data.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {data.entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border">
          {data.entries.map((e) => (
            <li key={e.id} className="p-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="font-medium text-navy break-words">
                  {e.who}: {e.actionLabel}
                  {e.claimId && (
                    <>
                      {" "}
                      <Link
                        to="/claims/$claimId"
                        params={{ claimId: e.claimId }}
                        className="underline underline-offset-2 hover:text-gold-text"
                      >
                        {claimLinkText(e.claimNumber)}
                      </Link>
                    </>
                  )}
                </span>
                <time dateTime={e.createdAt} className="text-xs text-muted-foreground">
                  {formatActivityTimestamp(e.createdAt)}
                </time>
              </div>
              {(e.detail || (data.clients && e.clientName)) && (
                <p className="mt-0.5 text-xs text-muted-foreground break-words">
                  {[data.clients ? e.clientName : null, e.detail].filter(Boolean).join(" · ")}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page === 0 || isFetching}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
        >
          Newer
        </Button>
        <span className="text-xs text-muted-foreground">
          Page {data.page + 1} of {pages}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page + 1 >= pages || isFetching}
          onClick={() => setPage((p) => p + 1)}
        >
          Older
        </Button>
      </div>
    </div>
  );
}
