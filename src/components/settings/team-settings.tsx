// Settings > Users & Locations (fix 32). Only rendered for a client admin; the
// server functions check that again before every read and change.
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, MapPin, Pencil, Plus, Trash2, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createClientLocation,
  deleteClientLocation,
  fetchClientTeam,
  inviteClientUser,
  removeClientUser,
  updateClientLocation,
  updateClientUser,
} from "@/lib/client-users.functions";
import {
  CLIENT_USER_ROLE,
  CLIENT_USER_ROLE_HELP,
  CLIENT_USER_ROLE_LABELS,
  CLIENT_USER_ROLES,
  locationNames,
  teamChangeError,
  type ClientLocation,
  type ClientUserRole,
  type ClientUserSummary,
} from "@/lib/client-users";
import { queryKeys } from "@/lib/query-keys";

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}

// Role picker plus, for a location user, which locations they see.
function AccessFields({
  idPrefix,
  role,
  onRoleChange,
  locationIds,
  onLocationIdsChange,
  locations,
}: {
  idPrefix: string;
  role: ClientUserRole;
  onRoleChange: (role: ClientUserRole) => void;
  locationIds: string[];
  onLocationIdsChange: (ids: string[]) => void;
  locations: ClientLocation[];
}) {
  const toggle = (id: string, on: boolean) =>
    onLocationIdsChange(on ? [...locationIds, id] : locationIds.filter((x) => x !== id));
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-role`}>Access</Label>
        <Select value={role} onValueChange={(v) => onRoleChange(v as ClientUserRole)}>
          <SelectTrigger id={`${idPrefix}-role`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CLIENT_USER_ROLES.map((r) => (
              <SelectItem
                key={r}
                value={r}
                disabled={r === CLIENT_USER_ROLE.location && locations.length === 0}
              >
                {CLIENT_USER_ROLE_LABELS[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {CLIENT_USER_ROLE_HELP[role]}
          {locations.length === 0 && " Add a location first to create a location user."}
        </p>
      </div>
      {role === CLIENT_USER_ROLE.location && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Locations they can see</legend>
          <div className="max-h-48 overflow-y-auto space-y-2 rounded-md border p-3">
            {locations.map((l) => (
              <label key={l.id} className="flex items-center gap-2 text-sm min-h-[2rem]">
                <Checkbox
                  checked={locationIds.includes(l.id)}
                  onCheckedChange={(v) => toggle(l.id, v === true)}
                />
                <span className="min-w-0 break-words">{l.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </>
  );
}

function AddUserDialog({
  open,
  onOpenChange,
  locations,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locations: ClientLocation[];
}) {
  const queryClient = useQueryClient();
  const invite = useServerFn(inviteClientUser);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<ClientUserRole>(CLIENT_USER_ROLE.company);
  const [locationIds, setLocationIds] = useState<string[]>([]);

  const reset = () => {
    setName("");
    setEmail("");
    setPassword("");
    setRole(CLIENT_USER_ROLE.company);
    setLocationIds([]);
  };

  const mutation = useMutation({
    mutationFn: () => invite({ data: { name, email, password, role, locationIds } }),
    onSuccess: () => {
      toast.success(`${name.trim()} can now sign in with ${email.trim()}`);
      queryClient.invalidateQueries({ queryKey: queryKeys.clientTeam });
      reset();
      onOpenChange(false);
    },
    onError: (err) => toast.error(errorMessage(err, "Couldn't add the user")),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (role === CLIENT_USER_ROLE.location && locationIds.length === 0) {
      toast.error("Pick at least one location for a location user");
      return;
    }
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add a user</DialogTitle>
          <DialogDescription>
            They sign in at claimsqr.com with this email and password. Share the password with them
            directly; ClaimsQR doesn't email it.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-user-name">Name</Label>
            <Input
              id="new-user-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-user-email">Email</Label>
            <Input
              id="new-user-email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-user-password">Temporary password</Label>
            <Input
              id="new-user-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              maxLength={72}
              required
            />
            <p className="text-xs text-muted-foreground">At least 8 characters.</p>
          </div>
          <AccessFields
            idPrefix="new-user"
            role={role}
            onRoleChange={setRole}
            locationIds={locationIds}
            onLocationIdsChange={setLocationIds}
            locations={locations}
          />
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Add user
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({
  user,
  onClose,
  locations,
}: {
  user: ClientUserSummary;
  onClose: () => void;
  locations: ClientLocation[];
}) {
  const queryClient = useQueryClient();
  const update = useServerFn(updateClientUser);
  const remove = useServerFn(removeClientUser);
  const [role, setRole] = useState<ClientUserRole>(user.role);
  const [locationIds, setLocationIds] = useState<string[]>(user.locationIds);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const label = user.name || user.email || "this user";

  const done = (message: string) => {
    toast.success(message);
    queryClient.invalidateQueries({ queryKey: queryKeys.clientTeam });
    onClose();
  };
  const save = useMutation({
    mutationFn: () => update({ data: { userId: user.userId, role, locationIds } }),
    onSuccess: () => done(`Access updated for ${label}`),
    onError: (err) => toast.error(errorMessage(err, "Couldn't update the user")),
  });
  const removal = useMutation({
    mutationFn: () => remove({ data: { userId: user.userId } }),
    onSuccess: () => done(`${label} can no longer sign in`),
    onError: (err) => toast.error(errorMessage(err, "Couldn't remove the user")),
  });

  const roleLocked = teamChangeError(user, { kind: "update", role: CLIENT_USER_ROLE.company });
  const removeBlocked = teamChangeError(user, { kind: "remove" });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="break-words">{label}</DialogTitle>
          {user.email && user.name && (
            <DialogDescription className="break-all">{user.email}</DialogDescription>
          )}
        </DialogHeader>

        {roleLocked ? (
          <p className="text-sm text-muted-foreground">{roleLocked}.</p>
        ) : (
          <div className="space-y-4">
            <AccessFields
              idPrefix="edit-user"
              role={role}
              onRoleChange={setRole}
              locationIds={locationIds}
              onLocationIdsChange={setLocationIds}
              locations={locations}
            />
          </div>
        )}

        {!removeBlocked && (
          <div className="border-t pt-4">
            {confirmRemove ? (
              <div className="space-y-3">
                <p className="text-sm">
                  Remove {label}? They won't be able to sign in. Claims and notes they added stay.
                </p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Button
                    variant="destructive"
                    disabled={removal.isPending}
                    onClick={() => removal.mutate()}
                  >
                    {removal.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                    Remove user
                  </Button>
                  <Button variant="outline" onClick={() => setConfirmRemove(false)}>
                    Keep
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="ghost"
                className="text-destructive px-0 hover:bg-transparent"
                onClick={() => setConfirmRemove(true)}
              >
                <Trash2 className="h-4 w-4" /> Remove this user
              </Button>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            {roleLocked ? "Close" : "Cancel"}
          </Button>
          {!roleLocked && (
            <Button
              disabled={save.isPending}
              onClick={() => {
                if (role === CLIENT_USER_ROLE.location && locationIds.length === 0) {
                  toast.error("Pick at least one location for a location user");
                  return;
                }
                save.mutate();
              }}
            >
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LocationDialog({
  location,
  onClose,
}: {
  /** null = adding a new location. */
  location: ClientLocation | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const create = useServerFn(createClientLocation);
  const update = useServerFn(updateClientLocation);
  const remove = useServerFn(deleteClientLocation);
  const [name, setName] = useState(location?.name ?? "");
  const [address, setAddress] = useState(location?.address ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const done = (message: string) => {
    toast.success(message);
    queryClient.invalidateQueries({ queryKey: queryKeys.clientTeam });
    // Claims, policies and the report form show location names.
    queryClient.invalidateQueries({ queryKey: queryKeys.overviewAll });
    onClose();
  };
  const save = useMutation({
    mutationFn: async (): Promise<void> => {
      if (location) await update({ data: { id: location.id, name, address } });
      else await create({ data: { name, address } });
    },
    onSuccess: () => done(location ? "Location saved" : `${name.trim()} added`),
    onError: (err) => toast.error(errorMessage(err, "Couldn't save the location")),
  });
  const deletion = useMutation({
    mutationFn: () => remove({ data: { id: location!.id } }),
    onSuccess: () => done(`${location!.name} deleted`),
    onError: (err) => toast.error(errorMessage(err, "Couldn't delete the location")),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{location ? "Edit location" : "Add a location"}</DialogTitle>
          <DialogDescription>
            A site, store or yard. Claims can be filed under it, and location users only see claims
            at their locations.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="location-name">Name</Label>
            <Input
              id="location-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Dayton Yard"
              maxLength={120}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="location-address">Address (optional)</Label>
            <Input
              id="location-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              maxLength={300}
            />
          </div>

          {location && (
            <div className="border-t pt-4">
              {confirmDelete ? (
                <div className="space-y-3">
                  <p className="text-sm">
                    Delete {location.name}? Its claims and policies stay, but won't be tied to a
                    location any more.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={deletion.isPending}
                      onClick={() => deletion.mutate()}
                    >
                      {deletion.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                      Delete location
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setConfirmDelete(false)}>
                      Keep
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive px-0 hover:bg-transparent"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 className="h-4 w-4" /> Delete this location
                </Button>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {location ? "Save" : "Add location"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The users and locations lists, inside SettingsSection cards on the Settings page. */
function useClientTeam() {
  const getTeam = useServerFn(fetchClientTeam);
  return useQuery({ queryKey: queryKeys.clientTeam, queryFn: () => getTeam() });
}

export function TeamUsers() {
  const { data, isLoading, error } = useClientTeam();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ClientUserSummary | null>(null);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading users…
      </div>
    );
  }
  if (error || !data) {
    return (
      <p className="text-sm text-destructive">{errorMessage(error, "Couldn't load users.")}</p>
    );
  }

  return (
    <>
      <ul className="divide-y rounded-md border">
        {data.users.map((u) => {
          const sites = locationNames(u.locationIds, data.locations);
          return (
            <li key={u.userId}>
              <button
                type="button"
                onClick={() => setEditing(u)}
                className="w-full text-left px-3 py-3 hover:bg-muted/50 flex items-start justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="font-medium text-foreground break-words">
                    {u.name || u.email || "Unnamed user"}
                    {u.isYou && <span className="text-muted-foreground font-normal"> (you)</span>}
                  </div>
                  {u.name && u.email && (
                    <div className="text-sm text-muted-foreground break-all">{u.email}</div>
                  )}
                  {u.role === CLIENT_USER_ROLE.location && (
                    <div className="text-xs text-muted-foreground mt-1 break-words">
                      {sites.length ? sites.join(", ") : "No locations"}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge
                    variant={u.role === CLIENT_USER_ROLE.clientAdmin ? "default" : "secondary"}
                  >
                    {CLIENT_USER_ROLE_LABELS[u.role]}
                  </Badge>
                  <Pencil className="h-4 w-4 text-muted-foreground" aria-hidden />
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      <Button variant="outline" className="w-full sm:w-auto" onClick={() => setAdding(true)}>
        <UserPlus className="h-4 w-4" /> Add a user
      </Button>
      <AddUserDialog open={adding} onOpenChange={setAdding} locations={data.locations} />
      {editing && (
        <EditUserDialog
          key={editing.userId}
          user={editing}
          locations={data.locations}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

export function TeamLocations() {
  const { data, isLoading, error } = useClientTeam();
  // undefined = closed, null = adding.
  const [editing, setEditing] = useState<ClientLocation | null | undefined>(undefined);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading locations…
      </div>
    );
  }
  if (error || !data) {
    return (
      <p className="text-sm text-destructive">{errorMessage(error, "Couldn't load locations.")}</p>
    );
  }

  return (
    <>
      {data.locations.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No locations yet. Add your sites to file claims under them and give people access to just
          their site.
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {data.locations.map((l) => (
            <li key={l.id}>
              <button
                type="button"
                onClick={() => setEditing(l)}
                className="w-full text-left px-3 py-3 hover:bg-muted/50 flex items-start justify-between gap-3"
              >
                <div className="flex items-start gap-2 min-w-0">
                  <MapPin className="h-4 w-4 mt-0.5 shrink-0 text-gold" aria-hidden />
                  <div className="min-w-0">
                    <div className="font-medium text-foreground break-words">{l.name}</div>
                    {l.address && (
                      <div className="text-sm text-muted-foreground break-words">{l.address}</div>
                    )}
                  </div>
                </div>
                <Pencil className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Button variant="outline" className="w-full sm:w-auto" onClick={() => setEditing(null)}>
        <Plus className="h-4 w-4" /> Add a location
      </Button>
      {editing !== undefined && (
        <LocationDialog
          key={editing?.id ?? "new"}
          location={editing}
          onClose={() => setEditing(undefined)}
        />
      )}
    </>
  );
}
