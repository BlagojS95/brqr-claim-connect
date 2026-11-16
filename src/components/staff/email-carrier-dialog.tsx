// "Email carrier" on claim detail (fix 54), for agency staff. Pick a template,
// it is filled from the claim, staff can edit To / Subject / Body, then send.
// The server checks the role, sends through Resend and logs it to the claim.
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Mail, Send } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchCarrierEmailDraft, sendCarrierEmail } from "@/lib/carrier-email.functions";
import {
  fillTemplate,
  isValidEmail,
  MAX_EMAIL_BODY_LENGTH,
  MAX_EMAIL_SUBJECT_LENGTH,
} from "@/lib/email-templates";
import { queryKeys } from "@/lib/query-keys";

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}

export function EmailCarrierButton({ claimId }: { claimId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Mail className="h-4 w-4" /> Email carrier
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto p-4 sm:max-w-2xl sm:p-6">
        <DialogHeader>
          <DialogTitle>Email carrier</DialogTitle>
          <DialogDescription>
            Choose a template, check the details, then send. Replies go to the agency claims inbox.
          </DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so each opening starts from fresh claim data. */}
        {open && <EmailCarrierForm claimId={claimId} onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function EmailCarrierForm({ claimId, onDone }: { claimId: string; onDone: () => void }) {
  const queryClient = useQueryClient();
  const getDraft = useServerFn(fetchCarrierEmailDraft);
  const send = useServerFn(sendCarrierEmail);

  const draft = useQuery({
    queryKey: ["carrier-email-draft", claimId],
    queryFn: () => getDraft({ data: { claimId } }),
    staleTime: 0,
    gcTime: 0,
  });

  const [templateId, setTemplateId] = useState("");
  const [to, setTo] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [showErrors, setShowErrors] = useState(false);

  const toValue = to ?? draft.data?.defaultTo ?? "";
  const template = draft.data?.templates.find((t) => t.id === templateId);

  function chooseTemplate(id: string) {
    const next = draft.data?.templates.find((t) => t.id === id);
    if (!next || !draft.data) return;
    setTemplateId(id);
    setSubject(fillTemplate(next.subject, draft.data.values));
    setBody(fillTemplate(next.body, draft.data.values));
  }

  const toError = !toValue.trim()
    ? "Enter the carrier's email address"
    : !isValidEmail(toValue)
      ? "Enter a single valid email address"
      : null;
  const subjectError = subject.trim() ? null : "Enter a subject";
  const bodyError = !body.trim()
    ? "Write the email before sending"
    : body.length > MAX_EMAIL_BODY_LENGTH
      ? `Keep the email under ${MAX_EMAIL_BODY_LENGTH.toLocaleString()} characters`
      : null;

  const mutation = useMutation({
    mutationFn: () =>
      send({ data: { claimId, templateId, to: toValue.trim(), subject: subject.trim(), body } }),
    onSuccess: (res) => {
      toast.success(`Email sent to ${toValue.trim()}`);
      if (!res.logged)
        toast.warning("The email was sent but couldn't be added to the activity log.");
      // The claim key covers the activity log and submitted_to_carrier_at.
      queryClient.invalidateQueries({ queryKey: queryKeys.claim(claimId) });
      onDone();
    },
    onError: (err) => toast.error(errorMessage(err, "Couldn't send the email")),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setShowErrors(true);
    if (!template || toError || subjectError || bodyError) return;
    mutation.mutate();
  }

  if (draft.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (draft.error || !draft.data) {
    return (
      <p className="text-sm text-destructive">
        {errorMessage(draft.error, "Couldn't load the email templates.")}
      </p>
    );
  }
  if (!draft.data.templates.length) {
    return (
      <p className="text-sm text-muted-foreground">
        There are no email templates yet. Add one in Settings → Email templates.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="carrier-email-template">Template</Label>
        <Select value={templateId} onValueChange={chooseTemplate} disabled={mutation.isPending}>
          <SelectTrigger id="carrier-email-template">
            <SelectValue placeholder="Choose a template" />
          </SelectTrigger>
          <SelectContent>
            {draft.data.templates.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {showErrors && !template && <p className="text-sm text-destructive">Choose a template</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="carrier-email-to">To</Label>
        <Input
          id="carrier-email-to"
          type="email"
          inputMode="email"
          autoComplete="off"
          placeholder="claims@carrier.com"
          value={toValue}
          onChange={(e) => setTo(e.target.value)}
          disabled={mutation.isPending}
          aria-invalid={showErrors && !!toError}
        />
        {showErrors && toError ? (
          <p className="text-sm text-destructive">{toError}</p>
        ) : (
          !draft.data.defaultTo && (
            <p className="text-xs text-muted-foreground">
              No carrier or adjuster email on this claim yet.
            </p>
          )
        )}
      </div>

      {template && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="carrier-email-subject">Subject</Label>
            <Input
              id="carrier-email-subject"
              value={subject}
              maxLength={MAX_EMAIL_SUBJECT_LENGTH}
              onChange={(e) => setSubject(e.target.value)}
              disabled={mutation.isPending}
              aria-invalid={showErrors && !!subjectError}
            />
            {showErrors && subjectError && (
              <p className="text-sm text-destructive">{subjectError}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="carrier-email-body">Message</Label>
            <Textarea
              id="carrier-email-body"
              value={body}
              rows={14}
              onChange={(e) => setBody(e.target.value)}
              disabled={mutation.isPending}
              className="font-mono text-sm"
              aria-invalid={showErrors && !!bodyError}
            />
            {showErrors && bodyError && <p className="text-sm text-destructive">{bodyError}</p>}
          </div>
        </>
      )}

      <DialogFooter className="gap-2 sm:gap-0">
        <Button
          type="button"
          variant="outline"
          onClick={onDone}
          disabled={mutation.isPending}
          className="w-full sm:w-auto"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={mutation.isPending}
          className="w-full sm:w-auto bg-navy hover:bg-navy/90 text-navy-foreground"
        >
          {mutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          Send
        </Button>
      </DialogFooter>
    </form>
  );
}
