import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AdvocateDraft } from "@/lib/claims-advocate";

/** Name, phone and email inputs for a claims advocate (fix 59). */
export function AdvocateFields({
  idPrefix,
  value,
  onChange,
  disabled,
}: {
  idPrefix: string;
  value: AdvocateDraft;
  onChange: (next: AdvocateDraft) => void;
  disabled?: boolean;
}) {
  const field = (key: keyof AdvocateDraft, label: string, type: string, autoComplete: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`${idPrefix}-${key}`}>{label}</Label>
      <Input
        id={`${idPrefix}-${key}`}
        type={type}
        autoComplete={autoComplete}
        value={value[key]}
        disabled={disabled}
        onChange={(e) => onChange({ ...value, [key]: e.target.value })}
      />
    </div>
  );
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {field("name", "Name", "text", "off")}
      {field("phone", "Phone", "tel", "off")}
      {field("email", "Email", "email", "off")}
    </div>
  );
}
