import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { ensureClaimContacts } from "@/lib/claim-contacts.functions";
import { CONTACT_ROW_LABELS as ROW_LABELS } from "@/lib/claim-contacts";
import { queryKeys } from "@/lib/query-keys";
import { claimEmailSubject, followUpEmailBody, type ClaimEmailInfo } from "@/lib/claim-email";
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

// The broker row's email is the agency's shared claims inbox (agency_settings),
// filled in by ensureClaimContacts, so it is shown read-only.
const isBrokerRow = (contact: Contact) => contact.row_key === "broker_claims_contact";

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
  email: emailInfo,
}: {
  claimId: string;
  email: ClaimEmailInfo;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = ["claim-contacts", claimId];
  const ensureContacts = useServerFn(ensureClaimContacts);

  const {
    data: contacts,
    isLoading,
    error,
  } = useQuery({
    queryKey,
    retry: 1,
    queryFn: async () => {
      // This server fn verifies claim ownership, makes sure the contact rows
      // exist, and returns them in display order with the adjuster and broker
      // defaults filled in.
      return (await ensureContacts({ data: { claimId } })) as unknown as Contact[];
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey });
  // The DB trigger on claim_contact_emails adds an entry to the claim's activity log.
  const invalidateActivity = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.claimActivity(claimId) });

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

  async function sendEmail(contact: Contact, followUp = false) {
    if (!contact.email) {
      toast.error("Add an email address first");
      return;
    }
    const subject = claimEmailSubject(emailInfo);
    let href = `mailto:${contact.email}?subject=${encodeURIComponent(subject)}`;
    if (followUp) href += `&body=${encodeURIComponent(followUpEmailBody(contact.contact_person))}`;
    window.location.href = href;

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
    invalidateActivity();
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
    invalidateActivity();
  }

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading contacts…</div>;
  if (error) {
    return (
      <div className="text-sm text-destructive">
        Couldn't load contacts: {error instanceof Error ? error.message : "Unknown error"}
      </div>
    );
  }
  if (!contacts?.length) return null;

  // Shared by the table (1024 px and up) and the cards (below 1024 px).
  const fieldsFor = (contact: Contact) => ({
    person: (
      <EditableInput
        key={`person-${contact.contact_person ?? ""}`}
        label="Contact Person"
        value={contact.contact_person}
        onSave={(v) => saveField(contact, "contact_person", v)}
      />
    ),
    phone: (
      <EditableInput
        key={`phone-${contact.phone ?? ""}`}
        label="Telephone"
        value={contact.phone}
        onSave={(v) => saveField(contact, "phone", v)}
      />
    ),
    email: isBrokerRow(contact) ? (
      <span className="block break-all px-2 py-1">{contact.email}</span>
    ) : (
      <EditableInput
        key={`email-${contact.email ?? ""}`}
        label="Email"
        value={contact.email}
        onSave={(v) => saveField(contact, "email", v)}
        type="email"
      />
    ),
    notes: <NotesPopover value={contact.notes} onSave={(v) => saveField(contact, "notes", v)} />,
    mailbox: <CorrespondenceDialog contact={contact} onMarkReplied={markReplied} />,
    send: (
      <Button
        variant="outline"
        size="sm"
        onClick={() => sendEmail(contact)}
        disabled={!contact.email}
      >
        <Mail className="h-3.5 w-3.5" /> Send Email
      </Button>
    ),
    followUp: (
      <FollowUpStatus
        latest={latestEmail(contact.claim_contact_emails ?? [])}
        onSendFollowUp={() => sendEmail(contact, true)}
        onMarkReplied={markReplied}
      />
    ),
  });

  return (
    <>
      <div className="space-y-3 lg:hidden">
        {contacts.map((contact) => {
          const f = fieldsFor(contact);
          return (
            <div key={contact.id} className="rounded-lg border border-border p-4 text-sm">
              <div className="font-medium">{ROW_LABELS[contact.row_key]}</div>
              <dl className="mt-3 grid gap-2 sm:grid-cols-3">
                <div>
                  <dt className="px-2 text-xs text-muted-foreground">Contact Person</dt>
                  <dd>{f.person}</dd>
                </div>
                <div>
                  <dt className="px-2 text-xs text-muted-foreground">Telephone</dt>
                  <dd>{f.phone}</dd>
                </div>
                <div>
                  <dt className="px-2 text-xs text-muted-foreground">Email</dt>
                  <dd>{f.email}</dd>
                </div>
              </dl>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {f.notes}
                {f.mailbox}
                {f.send}
              </div>
              <div className="mt-3 border-t border-border pt-3">
                <div className="mb-1 text-xs text-muted-foreground">Status Follow Up</div>
                {f.followUp}
              </div>
            </div>
          );
        })}
      </div>

      <div className="hidden overflow-x-auto rounded-lg border border-border lg:block">
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
              const f = fieldsFor(contact);
              return (
                <tr key={contact.id} className="border-t border-border align-top">
                  <td className="p-3 font-medium whitespace-nowrap">
                    {ROW_LABELS[contact.row_key]}
                  </td>
                  <td className="p-3">{f.person}</td>
                  <td className="p-3">{f.phone}</td>
                  <td className="p-3">{f.email}</td>
                  <td className="p-3">{f.notes}</td>
                  <td className="p-3">{f.mailbox}</td>
                  <td className="p-3">{f.send}</td>
                  <td className="p-3">{f.followUp}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function EditableInput({
  label,
  value,
  onSave,
  type = "text",
}: {
  label: string;
  value: string | null;
  onSave: (value: string) => void;
  type?: string;
}) {
  const [draft, setDraft] = useState(value ?? "");
  return (
    <input
      type={type}
      aria-label={label}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== (value ?? "")) onSave(draft);
      }}
      className="w-full min-w-30 rounded border border-transparent bg-transparent px-2 py-1 hover:border-input focus:border-input focus:bg-background focus:outline-none"
      placeholder="—"
    />
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
      <PopoverContent className="w-80 space-y-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Type notes…"
          rows={5}
          autoFocus
        />
        <div className="flex justify-end">
          {/* Closing the popover is what saves; the button just makes that explicit */}
          <Button
            size="sm"
            className="bg-navy hover:bg-navy/90 text-navy-foreground"
            onClick={() => {
              if (draft !== (value ?? "")) onSave(draft);
              setOpen(false);
            }}
          >
            Save
          </Button>
        </div>
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
