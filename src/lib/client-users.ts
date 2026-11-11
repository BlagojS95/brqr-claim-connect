// Several logins per client and locations (fix 32). Shared by the browser and
// the server functions in client-users.functions.ts; no Supabase imports.
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

export type ClientUserRole = Database["public"]["Enums"]["client_user_role"];

/** client_users.role values (client_user_role enum in the fix 32 migration). */
export const CLIENT_USER_ROLE = {
  clientAdmin: "client_admin",
  company: "company",
  location: "location",
} as const satisfies Record<string, ClientUserRole>;

export const CLIENT_USER_ROLES = [
  CLIENT_USER_ROLE.clientAdmin,
  CLIENT_USER_ROLE.company,
  CLIENT_USER_ROLE.location,
] as const;

export const CLIENT_USER_ROLE_LABELS: Record<ClientUserRole, string> = {
  client_admin: "Admin",
  company: "Whole company",
  location: "Location only",
};

export const CLIENT_USER_ROLE_HELP: Record<ClientUserRole, string> = {
  client_admin: "Sees everything and manages users and locations.",
  company: "Sees every claim, policy and loss run for the company.",
  location: "Sees only claims at their locations. No loss runs.",
};

/** Admins and company users see the whole company; location users don't. */
export function isCompanyWide(role: ClientUserRole | null | undefined): boolean {
  return role === CLIENT_USER_ROLE.clientAdmin || role === CLIENT_USER_ROLE.company;
}

const locationIds = z.array(z.string().uuid()).max(200);

// A location user needs at least one location (CHECK on client_users too).
function needsLocations<T extends { role: ClientUserRole; locationIds: string[] }>(v: T) {
  return v.role !== CLIENT_USER_ROLE.location || v.locationIds.length > 0;
}
const LOCATION_REQUIRED = {
  message: "Pick at least one location for a location user",
  path: ["locationIds"],
};

export const InviteClientUserSchema = z
  .object({
    name: z.string().trim().min(1, "Enter their name").max(120),
    email: z.string().trim().toLowerCase().email("Enter a valid email").max(254),
    password: z.string().min(8, "The password needs at least 8 characters").max(72),
    role: z.enum(CLIENT_USER_ROLES),
    locationIds,
  })
  .refine(needsLocations, LOCATION_REQUIRED);
export type InviteClientUserInput = z.infer<typeof InviteClientUserSchema>;

export const UpdateClientUserSchema = z
  .object({
    userId: z.string().uuid(),
    role: z.enum(CLIENT_USER_ROLES),
    locationIds,
  })
  .refine(needsLocations, LOCATION_REQUIRED);
export type UpdateClientUserInput = z.infer<typeof UpdateClientUserSchema>;

export const LocationSchema = z.object({
  name: z.string().trim().min(1, "Enter a location name").max(120),
  address: z
    .string()
    .trim()
    .max(300)
    .nullish()
    .transform((v) => v || null),
});

export interface ClientUserSummary {
  userId: string;
  name: string | null;
  email: string | null;
  role: ClientUserRole;
  locationIds: string[];
  /** The login the agency created; it always stays an admin. */
  isPrimary: boolean;
  isYou: boolean;
}

export interface ClientLocation {
  id: string;
  name: string;
  address: string | null;
}

export interface ClientTeam {
  clientName: string;
  locations: ClientLocation[];
  users: ClientUserSummary[];
}

/**
 * Why an admin can't make this change to a teammate, or null when allowed.
 * Keeps at least one admin and stops admins locking themselves out.
 */
export function teamChangeError(
  target: Pick<ClientUserSummary, "isPrimary" | "isYou">,
  change: { kind: "update"; role: ClientUserRole } | { kind: "remove" },
): string | null {
  if (change.kind === "remove") {
    if (target.isYou) return "You can't remove your own login";
    if (target.isPrimary)
      return "The company's main login can't be removed. Ask BRQR to change it.";
    return null;
  }
  if (change.role === CLIENT_USER_ROLE.clientAdmin) return null;
  if (target.isYou) return "You can't change your own access";
  if (target.isPrimary) return "The company's main login always stays an admin";
  return null;
}

/** "HQ, Dayton Yard" for a location user, by name in A–Z order. */
export function locationNames(
  ids: readonly string[],
  locations: readonly ClientLocation[],
): string[] {
  const byId = new Map(locations.map((l) => [l.id, l.name]));
  return ids
    .map((id) => byId.get(id))
    .filter((n): n is string => !!n)
    .sort((a, b) => a.localeCompare(b, "en-US", { sensitivity: "base", numeric: true }));
}
