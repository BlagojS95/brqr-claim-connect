import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertCircle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { fetchAttentionQueue } from "@/lib/attention.functions";
import { ATTENTION_PREVIEW_COUNT, attentionAgeLabel } from "@/lib/attention-queue";
import { queryKeys } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";

/**
 * "Needs your attention" on Home (fix 29). The server builds the list with the
 * caller's own token, so a client sees their own claims and an admin sees all;
 * `showClient` only decides whether each row names the client.
 */
export function AttentionQueue({ showClient }: { showClient: boolean }) {
  const { user } = useAuth();
  const getQueue = useServerFn(fetchAttentionQueue);
  const [expanded, setExpanded] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.attention,
    queryFn: () => getQueue(),
    enabled: !!user,
  });

  const items = data?.items ?? [];
  const shown = expanded ? items : items.slice(0, ATTENTION_PREVIEW_COUNT);

  return (
    <section
      aria-labelledby="attention-heading"
      className="rounded-lg border border-border bg-card"
    >
      <div className="flex items-center justify-between gap-3 p-5 border-b border-border">
        <h2 id="attention-heading" className="font-semibold text-navy flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-gold" aria-hidden />
          Needs your attention
        </h2>
        {items.length > 0 && (
          <span
            className="rounded-full bg-gold/15 px-2.5 py-0.5 text-xs font-semibold text-navy tabular-nums"
            aria-label={`${items.length} item${items.length === 1 ? "" : "s"}`}
          >
            {items.length}
          </span>
        )}
      </div>

      {isLoading ? (
        <p className="p-5 text-sm text-muted-foreground">Loading…</p>
      ) : isError ? (
        <p className="p-5 text-sm text-destructive">Couldn't load this list. Try refreshing.</p>
      ) : items.length === 0 ? (
        <p className="p-5 text-sm text-muted-foreground">Nothing waiting on you.</p>
      ) : (
        <ul className="divide-y divide-border">
          {shown.map((item) => (
            <li key={item.key}>
              <Link
                to="/claims/$claimId"
                params={{ claimId: item.claimId }}
                className="group flex items-start justify-between gap-3 p-4 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-navy break-words group-hover:text-gold">
                    {item.reason}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground truncate">
                    {/* Display copy for a missing claim number, not a claim status. */}
                    <span className={item.claimNumber ? "font-mono" : "italic"}>
                      {item.claimNumber ?? "Number pending"}
                    </span>
                    {" · "}
                    {item.claimType}
                    {showClient && item.clientName ? ` · ${item.clientName}` : ""}
                  </p>
                </div>
                <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                  {attentionAgeLabel(item.ageDays)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {items.length > ATTENTION_PREVIEW_COUNT && (
        <div className="border-t border-border p-2 text-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-navy hover:text-gold"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Show fewer" : `Show all ${items.length}`}
          </Button>
        </div>
      )}
    </section>
  );
}
