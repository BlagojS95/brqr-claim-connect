import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { addClaimNote, fetchClaimActivity } from "@/lib/claim-activity.functions";
import {
  claimActivityLabel,
  formatActivityTimestamp,
  MAX_ACTIVITY_NOTE_LENGTH,
  normalizeActivityNote,
} from "@/lib/claim-activity";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

// Under the claim's own key, so invalidating ["claim", id] after an upload
// also refreshes the log.
function claimActivityQueryKey(claimId: string) {
  return ["claim", claimId, "activity"];
}

// Newest-first log of what happened on a claim, with an "Add note" box that
// both clients and agency staff can use.
export function ClaimActivityLog({ claimId }: { claimId: string }) {
  const queryClient = useQueryClient();
  const queryKey = claimActivityQueryKey(claimId);
  const getActivity = useServerFn(fetchClaimActivity);
  const addNote = useServerFn(addClaimNote);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const {
    data: entries,
    isLoading,
    error,
  } = useQuery({
    queryKey,
    queryFn: () => getActivity({ data: { claimId } }),
  });

  async function submit() {
    const body = normalizeActivityNote(draft);
    if (!body) {
      toast.error(draft.trim() ? "That note is too long" : "Write a note first");
      return;
    }
    setSaving(true);
    try {
      await addNote({ data: { claimId, body } });
      setDraft("");
      toast.success("Note added");
      queryClient.invalidateQueries({ queryKey });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add note");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a note to this claim…"
          maxLength={MAX_ACTIVITY_NOTE_LENGTH}
          rows={3}
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {draft.length}/{MAX_ACTIVITY_NOTE_LENGTH}
          </span>
          <Button size="sm" onClick={submit} disabled={saving || !draft.trim()}>
            {saving ? "Adding…" : "Add note"}
          </Button>
        </div>
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">Loading activity…</div>}
      {error && (
        <div className="text-sm text-destructive">
          Couldn't load activity: {error instanceof Error ? error.message : "Unknown error"}
        </div>
      )}
      {entries && entries.length === 0 && (
        <p className="text-sm text-muted-foreground">No activity yet.</p>
      )}
      {entries && entries.length > 0 && (
        <ol className="space-y-3">
          {entries.map((entry) => (
            <li key={entry.id} className="flex gap-3 text-sm">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-gold" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{claimActivityLabel(entry.kind)}</span>
                  <span className="text-xs text-muted-foreground">
                    {entry.author} · {formatActivityTimestamp(entry.created_at)}
                  </span>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-foreground/90">
                  {entry.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
