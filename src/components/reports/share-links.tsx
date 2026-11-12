import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Copy, Link2, Share2 } from "lucide-react";
import { toast } from "sonner";
import { listSharedReports, revokeSharedReport } from "@/lib/shared-reports.functions";
import { queryKeys } from "@/lib/query-keys";
import {
  SHARE_DAY_CHOICES,
  SHARE_DAYS_DEFAULT,
  shareLinkState,
  type SharedReportKind,
} from "@/lib/shared-reports";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

// A moment in the viewer's own time zone, e.g. "Nov 12, 2026, 3:04 PM".
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "—";

/**
 * "Share" (fixes 44 and 46): makes an expiring read-only link to a frozen copy
 * of the report and shows it once to copy. Only the link's hash is stored,
 * so it can't be shown again later; a new one can always be made.
 */
export function ShareReportButton({
  title,
  description,
  disabled,
  disabledReason,
  createLink,
}: {
  title: string;
  description: string;
  disabled?: boolean;
  disabledReason?: string;
  createLink: (days: number) => Promise<{ path: string; expiresAt: string }>;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState<number>(SHARE_DAYS_DEFAULT);
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const create = useMutation({
    mutationFn: () => createLink(days),
    onSuccess: ({ path, expiresAt }) => {
      setLink({ url: `${window.location.origin}${path}`, expiresAt });
      queryClient.invalidateQueries({ queryKey: queryKeys.sharedReports });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't create the link"),
  });

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy. Select the link and copy it instead.");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setLink(null);
          setCopied(false);
          setDays(SHARE_DAYS_DEFAULT);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          title={disabled ? disabledReason : undefined}
        >
          <Share2 className="h-4 w-4" aria-hidden />
          Share
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {!link ? (
          <div className="space-y-2">
            <label htmlFor="share-days" className="text-sm font-medium">
              Link works for
            </label>
            <select
              id="share-days"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-base md:text-sm"
            >
              {SHARE_DAY_CHOICES.map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Anyone with the link can view this report until it expires or you revoke it. It shows
              the figures as of today and never changes.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <label htmlFor="share-url" className="text-sm font-medium">
              Your link
            </label>
            <div className="flex gap-2">
              <Input id="share-url" readOnly value={link.url} onFocus={(e) => e.target.select()} />
              <Button
                type="button"
                variant="outline"
                onClick={() => void copy()}
                aria-label="Copy link"
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Expires {when(link.expiresAt)}. Copy it now: for safety it can't be shown again. You
              can revoke it under Shared links.
            </p>
          </div>
        )}

        <DialogFooter>
          {!link ? (
            <Button
              onClick={() => create.mutate()}
              disabled={create.isPending}
              className="bg-navy hover:bg-navy/90 text-navy-foreground"
            >
              <Link2 className="h-4 w-4" aria-hidden />
              {create.isPending ? "Creating…" : "Create link"}
            </Button>
          ) : (
            <Button variant="outline" onClick={() => setOpen(false)}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const STATE_LABEL = { active: "Active", expired: "Expired", revoked: "Revoked" } as const;
const STATE_TONE = {
  active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  expired: "bg-slate-100 text-slate-600 border-slate-200",
  revoked: "bg-red-50 text-red-700 border-red-200",
} as const;

/** The share links an agency admin or client admin manages, with Revoke. */
export function SharedLinksList({ kind, clientId }: { kind: SharedReportKind; clientId?: string }) {
  const queryClient = useQueryClient();
  const list = useServerFn(listSharedReports);
  const revoke = useServerFn(revokeSharedReport);
  const { data: links = [], isLoading } = useQuery({
    queryKey: [...queryKeys.sharedReports, clientId ?? "all"],
    queryFn: () => list({ data: { clientId } }),
    select: (rows) => rows.filter((r) => r.kind === kind),
  });

  const revokeLink = useMutation({
    mutationFn: (id: string) => revoke({ data: { id } }),
    onSuccess: () => {
      toast.success("Link revoked. It no longer opens.");
      queryClient.invalidateQueries({ queryKey: queryKeys.sharedReports });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't revoke the link"),
  });

  if (isLoading || links.length === 0) return null;

  return (
    <section className="rounded-lg border border-border bg-card">
      <h3 className="px-5 py-3 border-b border-border text-sm font-semibold text-navy">
        Shared links
      </h3>
      <ul className="divide-y divide-border">
        {links.map((l) => {
          const state = shareLinkState(l);
          return (
            <li key={l.id} className="px-5 py-3 flex flex-wrap items-center gap-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="truncate text-navy">{l.title}</div>
                <div className="text-xs text-muted-foreground">
                  Made {when(l.created_at)} ·{" "}
                  {state === "revoked"
                    ? `Revoked ${when(l.revoked_at)}`
                    : `${state === "expired" ? "Expired" : "Expires"} ${when(l.expires_at)}`}
                </div>
              </div>
              <span
                className={`text-[10px] uppercase tracking-wide px-2 py-1 rounded-full border ${STATE_TONE[state]}`}
              >
                {STATE_LABEL[state]}
              </span>
              {state === "active" && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={revokeLink.isPending}
                  onClick={() => revokeLink.mutate(l.id)}
                >
                  Revoke
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
