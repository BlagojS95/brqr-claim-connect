import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Mail, StickyNote } from "lucide-react";

const ROW_LABELS: Record<string, string> = {
  broker_claims_contact: "Broker Claims Contact",
  adjuster: "Adjuster:",
  attorney: "Attorney",
  other_1: "Other",
  other_2: "Other",
};
const ROW_ORDER = ["broker_claims_contact", "adjuster", "attorney", "other_1", "other_2"];

interface ContactEmail {
  id: string;
  sent_at: string;
  sent_by: string | null;
  subject: string | null;
  replied_at: string | null;
}

interface Contact {
  id: string;
  claim_id: string;
  row_key: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  claim_contact_emails: ContactEmail[];
}

function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

function latestEmail(emails: ContactEmail[]): ContactEmail | null {
  if (!emails.length) return null;
  return [...emails].sort(
    (a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime(),
  )[0];
}

export function ClaimContactsTable({
  claimId,
  claimNumber,
}: {
  claimId: string;
  claimNumber: string | null;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = ["claim-contacts", claimId];

  const { data: contacts, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("claim_contacts")
        .select("*, claim_contact_emails(*)")
        .eq("claim_id", claimId);
      if (error) throw error;
      const rows = (data ?? []) as unknown as Contact[];
      return ROW_ORDER.map((key) => rows.find((r) => r.row_key === key)).filter(
        Boolean,
      ) as Contact[];
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey });

  async function saveField(
    contact: Contact,
    field: "contact_person" | "phone" | "email" | "notes",
    value: string,
  ) {
    const patch: Partial<Record<typeof field, string | null>> & { updated_at: string } = {
      updated_at: new Date().toISOString(),
    };
    patch[field] = value || null;
    const { error } = await supabase.from("claim_contacts").update(patch).eq("id", contact.id);
    if (error) {
      toast.error("Failed to save");
      return;
    }
    invalidate();
  }

  async function sendEmail(contact: Contact) {
    if (!contact.email) {
      toast.error("Add an email address first");
      return;
    }
    const subject = `RE: ${claimNumber ?? "Claim"}`;
    window.location.href = `mailto:${contact.email}?subject=${encodeURIComponent(subject)}`;

    const { error } = await supabase.from("claim_contact_emails").insert({
      claim_contact_id: contact.id,
      claim_id: claimId,
      sent_by: user?.id ?? null,
      subject,
    });
    if (error) {
      toast.error("Opened email client, but failed to log the send");
      return;
    }
    toast.success("Logged email sent");
    invalidate();
  }

  async function markReplied(email: ContactEmail) {
    const { error } = await supabase
      .from("claim_contact_emails")
      .update({ replied_at: new Date().toISOString() })
      .eq("id", email.id);
    if (error) {
      toast.error("Failed to mark as replied");
      return;
    }
    toast.success("Marked as replied");
    invalidate();
  }

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading contacts…</div>;
  if (!contacts?.length) return null;

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/50 text-left">
            <th className="p-3 font-medium"></th>
            <th className="p-3 font-medium">Contact Person</th>
            <th className="p-3 font-medium">Telephone</th>
            <th className="p-3 font-medium">Email</th>
            <th className="p-3 font-medium">Notes</th>
            <th className="p-3 font-medium">Correspondence</th>
            <th className="p-3 font-medium">Send Email</th>
            <th className="p-3 font-medium">Status Follow Up</th>
          </tr>
        </thead>
        <tbody>
          {contacts.map((contact) => {
            const latest = latestEmail(contact.claim_contact_emails ?? []);
            return (
              <tr key={contact.id} className="border-t border-border align-top">
                <td className="p-3 font-medium whitespace-nowrap">{ROW_LABELS[contact.row_key]}</td>
                <EditableCell
                  value={contact.contact_person}
                  onSave={(v) => saveField(contact, "contact_person", v)}
                />
                <EditableCell
                  value={contact.phone}
                  onSave={(v) => saveField(contact, "phone", v)}
                />
                <EditableCell
                  value={contact.email}
                  onSave={(v) => saveField(contact, "email", v)}
                  type="email"
                />
                <td className="p-3">
                  <NotesPopover
                    value={contact.notes}
                    onSave={(v) => saveField(contact, "notes", v)}
                  />
                </td>
                <td className="p-3">
                  <CorrespondenceDialog contact={contact} onMarkReplied={markReplied} />
                </td>
                <td className="p-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => sendEmail(contact)}
                    disabled={!contact.email}
                  >
                    <Mail className="h-3.5 w-3.5" /> Send Email
                  </Button>
                </td>
                <td className="p-3">
                  <FollowUpStatus
                    latest={latest}
                    onSendFollowUp={() => sendEmail(contact)}
                    onMarkReplied={markReplied}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EditableCell({
  value,
  onSave,
  type = "text",
}: {
  value: string | null;
  onSave: (value: string) => void;
  type?: string;
}) {
  const [draft, setDraft] = useState(value ?? "");
  return (
    <td className="p-3">
      <input
        type={type}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== (value ?? "")) onSave(draft);
        }}
        className="w-full min-w-30 rounded border border-transparent bg-transparent px-2 py-1 hover:border-input focus:border-input focus:bg-background focus:outline-none"
        placeholder="—"
      />
    </td>
  );
}

function NotesPopover({
  value,
  onSave,
}: {
  value: string | null;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const [open, setOpen] = useState(false);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next && draft !== (value ?? "")) onSave(draft);
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="text-navy">
          <StickyNote className="h-3.5 w-3.5" /> Notes
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Type notes…"
          rows={5}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}

function CorrespondenceDialog({
  contact,
  onMarkReplied,
}: {
  contact: Contact;
  onMarkReplied: (email: ContactEmail) => void;
}) {
  const emails = [...(contact.claim_contact_emails ?? [])].sort(
    (a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime(),
  );
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-navy">
          Mailbox
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Correspondence — {ROW_LABELS[contact.row_key]}</DialogTitle>
          <DialogDescription>
            Emails logged from this app for this claim/contact. This is not a live search of your
            real inbox.
          </DialogDescription>
        </DialogHeader>
        {emails.length === 0 ? (
          <p className="text-sm text-muted-foreground">No emails logged yet.</p>
        ) : (
          <ul className="space-y-2 max-h-80 overflow-y-auto">
            {emails.map((e) => (
              <li key={e.id} className="rounded-md border border-border p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{e.subject || "(no subject)"}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(e.sent_at).toLocaleString()}
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {e.replied_at ? (
                    <span className="text-green-600">
                      Replied {new Date(e.replied_at).toLocaleDateString()}
                    </span>
                  ) : (
                    <button className="underline hover:text-navy" onClick={() => onMarkReplied(e)}>
                      Mark replied
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FollowUpStatus({
  latest,
  onSendFollowUp,
  onMarkReplied,
}: {
  latest: ContactEmail | null;
  onSendFollowUp: () => void;
  onMarkReplied: (email: ContactEmail) => void;
}) {
  if (!latest) return <span className="text-muted-foreground text-xs">—</span>;

  if (latest.replied_at) {
    return (
      <span className="text-xs text-green-600">
        Replied {new Date(latest.replied_at).toLocaleDateString()}
      </span>
    );
  }

  const days = daysSince(latest.sent_at);
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">
        {days === 0 ? "Sent today" : `${days} day${days === 1 ? "" : "s"} since sent`}
      </div>
      <div className="flex gap-1">
        <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={onSendFollowUp}>
          Send Follow Up
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => onMarkReplied(latest)}
        >
          Replied?
        </Button>
      </div>
    </div>
  );
}
