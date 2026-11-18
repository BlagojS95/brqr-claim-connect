// Settings > Email templates (fix 54), for agency staff: edit the carrier
// email templates used by "Email carrier" on claim detail, or add new ones.
// The server functions check the agency_admin role.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  deleteEmailTemplate,
  fetchEmailTemplates,
  saveEmailTemplate,
  type EmailTemplate,
} from "@/lib/carrier-email.functions";
import {
  EMAIL_PLACEHOLDER_LABELS,
  EMAIL_PLACEHOLDERS,
  EMAIL_TEMPLATES_QUERY_KEY,
  MAX_EMAIL_BODY_LENGTH,
  MAX_EMAIL_SUBJECT_LENGTH,
  MAX_TEMPLATE_NAME_LENGTH,
  unknownPlaceholders,
} from "@/lib/email-templates";

const NEW = "new";

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}

export function EmailTemplatesSettings() {
  const getTemplates = useServerFn(fetchEmailTemplates);
  const [editing, setEditing] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: EMAIL_TEMPLATES_QUERY_KEY,
    queryFn: () => getTemplates(),
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading templates…
      </div>
    );
  }
  if (error || !data) {
    return (
      <p className="text-sm text-destructive">
        {errorMessage(error, "Couldn't load the email templates.")}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <details className="rounded-md bg-muted/50 px-3 py-2 text-sm">
        <summary className="cursor-pointer font-medium text-foreground">
          Placeholders you can use
        </summary>
        <p className="text-muted-foreground mt-2">
          These are filled in from the claim when staff pick the template. Anything the claim
          doesn't have shows as "—" (claim number: "pending").
        </p>
        <dl className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
          {EMAIL_PLACEHOLDERS.map((p) => (
            <div key={p} className="flex flex-wrap gap-x-2 min-w-0">
              <dt className="font-mono text-xs text-navy break-all">{`{${p}}`}</dt>
              <dd className="text-xs text-muted-foreground">{EMAIL_PLACEHOLDER_LABELS[p]}</dd>
            </div>
          ))}
        </dl>
      </details>

      <ul className="divide-y rounded-md border">
        {data.map((t) => (
          <li key={t.id} className="p-3">
            {editing === t.id ? (
              <TemplateEditor template={t} onDone={() => setEditing(null)} />
            ) : (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground break-words">{t.name}</div>
                  <div className="text-xs text-muted-foreground break-words mt-0.5">
                    {t.subject}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing(t.id)}
                    aria-label={`Edit ${t.name}`}
                  >
                    <Pencil className="h-4 w-4" aria-hidden /> Edit
                  </Button>
                  {!t.key && <DeleteTemplateButton template={t} />}
                </div>
              </div>
            )}
          </li>
        ))}
        {data.length === 0 && editing !== NEW && (
          <li className="p-3 text-sm text-muted-foreground">No templates yet.</li>
        )}
        {editing === NEW && (
          <li className="p-3">
            <TemplateEditor onDone={() => setEditing(null)} />
          </li>
        )}
      </ul>

      {editing !== NEW && (
        <Button variant="outline" className="w-full sm:w-auto" onClick={() => setEditing(NEW)}>
          <Plus className="h-4 w-4" aria-hidden /> Add template
        </Button>
      )}
    </div>
  );
}

function TemplateEditor({ template, onDone }: { template?: EmailTemplate; onDone: () => void }) {
  const queryClient = useQueryClient();
  const save = useServerFn(saveEmailTemplate);
  const [name, setName] = useState(template?.name ?? "");
  const [subject, setSubject] = useState(template?.subject ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const idBase = template?.id ?? NEW;

  const unknown = unknownPlaceholders(`${subject}\n${body}`);
  const invalid = !name.trim() || !subject.trim() || !body.trim();

  const mutation = useMutation({
    mutationFn: () => save({ data: { id: template?.id, name, subject, body } }),
    onSuccess: () => {
      toast.success(template ? "Template saved" : "Template added");
      queryClient.invalidateQueries({ queryKey: EMAIL_TEMPLATES_QUERY_KEY });
      onDone();
    },
    onError: (err) => toast.error(errorMessage(err, "Couldn't save the template")),
  });

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!invalid) mutation.mutate();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor={`tpl-name-${idBase}`}>Name</Label>
        <Input
          id={`tpl-name-${idBase}`}
          value={name}
          maxLength={MAX_TEMPLATE_NAME_LENGTH}
          onChange={(e) => setName(e.target.value)}
          disabled={mutation.isPending}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`tpl-subject-${idBase}`}>Subject</Label>
        <Input
          id={`tpl-subject-${idBase}`}
          value={subject}
          maxLength={MAX_EMAIL_SUBJECT_LENGTH}
          onChange={(e) => setSubject(e.target.value)}
          disabled={mutation.isPending}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`tpl-body-${idBase}`}>Body</Label>
        <Textarea
          id={`tpl-body-${idBase}`}
          value={body}
          rows={12}
          maxLength={MAX_EMAIL_BODY_LENGTH}
          onChange={(e) => setBody(e.target.value)}
          disabled={mutation.isPending}
          className="font-mono text-sm"
        />
      </div>
      {unknown.length > 0 && (
        <p className="text-sm text-amber-700">
          Not a known placeholder, so it will be sent as typed:{" "}
          {unknown.map((u) => `{${u}}`).join(", ")}
        </p>
      )}
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
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
          disabled={invalid || mutation.isPending}
          className="w-full sm:w-auto bg-navy hover:bg-navy/90 text-navy-foreground"
        >
          {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {template ? "Save template" : "Add template"}
        </Button>
      </div>
    </form>
  );
}

function DeleteTemplateButton({ template }: { template: EmailTemplate }) {
  const queryClient = useQueryClient();
  const remove = useServerFn(deleteEmailTemplate);
  const mutation = useMutation({
    mutationFn: () => remove({ data: { id: template.id } }),
    onSuccess: () => {
      toast.success("Template deleted");
      queryClient.invalidateQueries({ queryKey: EMAIL_TEMPLATES_QUERY_KEY });
    },
    onError: (err) => toast.error(errorMessage(err, "Couldn't delete the template")),
  });
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-destructive"
          disabled={mutation.isPending}
          aria-label={`Delete ${template.name}`}
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this template?</AlertDialogTitle>
          <AlertDialogDescription>
            "{template.name}" will no longer be offered when emailing a carrier. Emails already sent
            stay in each claim's activity log.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => mutation.mutate()}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
