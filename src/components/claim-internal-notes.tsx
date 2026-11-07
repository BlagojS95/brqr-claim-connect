import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { saveClaimInternalNote } from "@/lib/claim-internal-notes.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

// One running note per claim for agency staff. RLS on claim_internal_notes
// only lets agency_admin read or write it, so clients never see this. Saving
// goes through an admin-only server function.
export function ClaimInternalNotes({ claimId }: { claimId: string }) {
  const saveNote = useServerFn(saveClaimInternalNote);
  const queryClient = useQueryClient();
  const queryKey = ["claim-internal-notes", claimId];

  const {
    data: note,
    isLoading,
    error,
  } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("claim_internal_notes")
        .select("*")
        .eq("claim_id", claimId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(note?.body ?? ""), [note?.body]);

  async function save() {
    setSaving(true);
    try {
      await saveNote({ data: { claimId, body: draft } });
    } catch {
      toast.error("Failed to save internal notes");
      return;
    } finally {
      setSaving(false);
    }
    toast.success("Internal notes saved");
    queryClient.invalidateQueries({ queryKey });
  }

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading notes…</div>;
  if (error) {
    return (
      <div className="text-sm text-destructive">
        Couldn't load internal notes: {error instanceof Error ? error.message : "Unknown error"}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Notes for agency staff only. Clients can't see these."
        rows={6}
      />
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-muted-foreground">
          {note
            ? `Last updated by ${note.updated_by_email ?? "unknown"} · ${new Date(note.updated_at).toLocaleString()}`
            : "No notes yet."}
        </p>
        <Button
          size="sm"
          onClick={save}
          disabled={saving || draft === (note?.body ?? "")}
          className="bg-navy hover:bg-navy/90 text-navy-foreground"
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
