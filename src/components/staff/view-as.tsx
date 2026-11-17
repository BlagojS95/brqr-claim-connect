// View as client (fix 55): the start button on /admin, the read-only banner
// shown on every page while viewing, and the session log card on /admin.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Eye, LogOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { HOME_PATH } from "@/lib/navigation";
import { queryKeys } from "@/lib/query-keys";
import { endViewAsClient, listViewAsSessions, startViewAsClient } from "@/lib/view-as.functions";
import {
  VIEW_SESSION_END_LABEL,
  formatViewDuration,
  isViewSessionOpen,
  viewAsBannerText,
  type ViewingAs,
} from "@/lib/view-as";

const errorMessage = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

// A full page load after starting or ending, so every cached query and the
// role in useAuth are loaded again for the new view.
function reloadAt(path: string) {
  window.location.assign(path);
}

export function ViewAsClientButton({
  clientId,
  clientName,
}: {
  clientId: string;
  clientName: string;
}) {
  const start = useServerFn(startViewAsClient);
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={busy}
      aria-label={`View as ${clientName} (read only)`}
      onClick={async () => {
        setBusy(true);
        try {
          await start({ data: { clientId } });
          reloadAt(HOME_PATH);
        } catch (e) {
          toast.error(errorMessage(e, "Couldn't open the client's portal"));
          setBusy(false);
        }
      }}
    >
      <Eye className="h-3.5 w-3.5 mr-1" /> View as client
    </Button>
  );
}

// h-11: AppShell pads its content by the same amount (pt-11) while viewing.
const VIEW_AS_BANNER_HEIGHT_CLASS = "h-11";

export function ViewAsBanner({ viewingAs }: { viewingAs: ViewingAs }) {
  const end = useServerFn(endViewAsClient);
  const [busy, setBusy] = useState(false);
  return (
    <div
      role="status"
      className={`fixed inset-x-0 top-0 z-40 ${VIEW_AS_BANNER_HEIGHT_CLASS} flex items-center justify-between gap-3 px-4 bg-gold text-navy shadow`}
    >
      <p className="flex items-center gap-2 text-sm font-semibold min-w-0">
        <Eye className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{viewAsBannerText(viewingAs.clientName)}</span>
      </p>
      <Button
        size="sm"
        className="shrink-0 h-8 bg-navy hover:bg-navy/90 text-navy-foreground"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await end({ data: { reason: "exit" } });
            reloadAt("/admin");
          } catch (e) {
            toast.error(errorMessage(e, "Couldn't exit the client view"));
            setBusy(false);
          }
        }}
      >
        <LogOut className="h-3.5 w-3.5 mr-1" aria-hidden="true" /> Exit
      </Button>
    </div>
  );
}

export function ViewAsLogCard() {
  const list = useServerFn(listViewAsSessions);
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.viewAsLog,
    queryFn: () => list(),
  });
  const rows = data ?? [];
  const now = new Date();

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="p-5 border-b border-border">
        <h2 className="font-semibold text-navy">View-as-client log</h2>
        <p className="text-xs text-muted-foreground mt-1">
          The last 20 times agency staff opened a client&apos;s portal (read only).
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="text-left p-3">Staff</th>
              <th className="text-left p-3">Client</th>
              <th className="text-left p-3">Started</th>
              <th className="text-left p-3">Ended</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={4} className="p-6 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            )}
            {error && (
              <tr>
                <td colSpan={4} className="p-6 text-center text-destructive">
                  {errorMessage(error, "Couldn't load the log")}
                </td>
              </tr>
            )}
            {!isLoading && !error && rows.length === 0 && (
              <tr>
                <td colSpan={4} className="p-6 text-center text-muted-foreground">
                  Nobody has viewed as a client yet.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="p-3">{r.adminName}</td>
                <td className="p-3">{r.clientName || "—"}</td>
                <td className="p-3 whitespace-nowrap">{new Date(r.startedAt).toLocaleString()}</td>
                <td className="p-3 whitespace-nowrap">
                  {r.endedAt
                    ? `${formatViewDuration(r.startedAt, r.endedAt)} · ${
                        r.endedReason ? VIEW_SESSION_END_LABEL[r.endedReason] : "Ended"
                      }`
                    : isViewSessionOpen({ started_at: r.startedAt, ended_at: null }, now)
                      ? "Open now"
                      : "Expired"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
