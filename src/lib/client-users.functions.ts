// Settings > Users & Locations (fix 32), and setting a claim's location.
//
// client_users is only writable by the service role, so every change to a
// company's logins goes through here after checking on the server that the
// caller is that company's client_admin. Locations are written with the
// caller's own token: RLS lets only the client's admin (or the agency) do it.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { forbidden, parseInput, unprocessable } from "@/lib/http-errors.server";
import { loadDevVars } from "@/lib/load-dev-vars.server";
import {
  getClientMembership,
  isAgencyAdmin,
  type ClientMembership,
} from "@/lib/client-access.server";
import {
  CLIENT_USER_ROLE,
  InviteClientUserSchema,
  isCompanyWide,
  LocationSchema,
  teamChangeError,
  UpdateClientUserSchema,
  type ClientTeam,
  type ClientUserSummary,
} from "@/lib/client-users";

const ONLY_ADMINS = "Only your company's admin can manage users and locations";

async function requireClientAdmin(userId: string): Promise<ClientMembership> {
  const member = await getClientMembership(userId);
  if (!member || member.role !== CLIENT_USER_ROLE.clientAdmin) forbidden(ONLY_ADMINS);
  return member;
}

async function primaryLoginOf(clientId: string): Promise<{ userId: string | null; name: string }> {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .select("user_id, name, company_name")
    .eq("id", clientId)
    .single();
  if (error) throw new Error(`Couldn't load your company: ${error.message}`);
  return { userId: data.user_id, name: data.company_name || data.name };
}

// The caller's company users, read with the service role after the admin check.
async function loadTeamUsers(clientId: string, callerId: string): Promise<ClientUserSummary[]> {
  const [{ data: rows, error }, primary] = await Promise.all([
    supabaseAdmin
      .from("client_users")
      .select("user_id, role, location_ids, created_at")
      .eq("client_id", clientId)
      .order("created_at"),
    primaryLoginOf(clientId),
  ]);
  if (error) throw new Error(`Couldn't load your users: ${error.message}`);

  return Promise.all(
    (rows ?? []).map(async (r) => {
      const { data } = await supabaseAdmin.auth.admin.getUserById(r.user_id);
      const metaName = data?.user?.user_metadata?.name;
      return {
        userId: r.user_id,
        name: typeof metaName === "string" && metaName.trim() ? metaName.trim() : null,
        email: data?.user?.email ?? null,
        role: r.role,
        locationIds: r.location_ids ?? [],
        isPrimary: r.user_id === primary.userId,
        isYou: r.user_id === callerId,
      };
    }),
  );
}

async function findTeammate(clientId: string, callerId: string, userId: string) {
  const users = await loadTeamUsers(clientId, callerId);
  const target = users.find((u) => u.userId === userId);
  // Same answer for "not in your company" and "doesn't exist".
  if (!target) forbidden("That user isn't part of your company");
  return target;
}

export const fetchClientTeam = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ClientTeam> => {
    await loadDevVars();
    const member = await requireClientAdmin(context.userId);
    const [users, primary, { data: locations, error }] = await Promise.all([
      loadTeamUsers(member.clientId, context.userId),
      primaryLoginOf(member.clientId),
      context.supabase
        .from("client_locations")
        .select("id, name, address")
        .eq("client_id", member.clientId)
        .order("name"),
    ]);
    if (error) throw new Error(`Couldn't load your locations: ${error.message}`);
    return { clientName: primary.name, locations: locations ?? [], users };
  });

export const inviteClientUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseInput(InviteClientUserSchema))
  .handler(async ({ data, context }) => {
    await loadDevVars();
    const member = await requireClientAdmin(context.userId);

    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { name: data.name },
    });
    if (createError || !created.user) {
      const message = createError?.message ?? "Couldn't create the login";
      if (/already|registered|exists/i.test(message)) {
        unprocessable("That email already has a ClaimsQR login");
      }
      throw new Error(message);
    }

    // The handle_new_user() trigger gave the login the 'client' app role; this
    // row is what ties it to the company and decides what it can see. The
    // trigger on client_users rejects locations from another company.
    const { error: linkError } = await supabaseAdmin.from("client_users").insert({
      user_id: created.user.id,
      client_id: member.clientId,
      role: data.role,
      location_ids: data.role === CLIENT_USER_ROLE.location ? data.locationIds : [],
    });
    if (linkError) {
      await supabaseAdmin.auth.admin.deleteUser(created.user.id);
      if (linkError.code === "23503") unprocessable("Pick locations from your own company");
      throw new Error(`Couldn't add the user: ${linkError.message}`);
    }
    return { userId: created.user.id };
  });

export const updateClientUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseInput(UpdateClientUserSchema))
  .handler(async ({ data, context }) => {
    await loadDevVars();
    const member = await requireClientAdmin(context.userId);
    const target = await findTeammate(member.clientId, context.userId, data.userId);
    const problem = teamChangeError(target, { kind: "update", role: data.role });
    if (problem) unprocessable(problem);

    const { error } = await supabaseAdmin
      .from("client_users")
      .update({
        role: data.role,
        location_ids: data.role === CLIENT_USER_ROLE.location ? data.locationIds : [],
      })
      .eq("user_id", data.userId)
      .eq("client_id", member.clientId);
    if (error) {
      if (error.code === "23503") unprocessable("Pick locations from your own company");
      throw new Error(`Couldn't update the user: ${error.message}`);
    }
    return { ok: true };
  });

const UserIdSchema = z.object({ userId: z.string().uuid() });

// Deletes the login itself; their client_users row goes with it (cascade).
// Claims, notes and documents they added stay with the company.
export const removeClientUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseInput(UserIdSchema))
  .handler(async ({ data, context }) => {
    await loadDevVars();
    const member = await requireClientAdmin(context.userId);
    const target = await findTeammate(member.clientId, context.userId, data.userId);
    const problem = teamChangeError(target, { kind: "remove" });
    if (problem) unprocessable(problem);
    // Never delete agency staff, whatever rows exist.
    if (await isAgencyAdmin(data.userId)) forbidden("That login belongs to BRQR");

    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(`Couldn't remove the user: ${error.message}`);
    return { ok: true };
  });

export const createClientLocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseInput(LocationSchema))
  .handler(async ({ data, context }) => {
    await loadDevVars();
    const member = await requireClientAdmin(context.userId);
    // Caller's token: RLS checks again that they manage this client.
    const { data: row, error } = await context.supabase
      .from("client_locations")
      .insert({ client_id: member.clientId, name: data.name, address: data.address })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") unprocessable(`There's already a location called ${data.name}`);
      throw new Error(`Couldn't add the location: ${error.message}`);
    }
    return { id: row.id };
  });

export const updateClientLocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseInput(LocationSchema.extend({ id: z.string().uuid() })))
  .handler(async ({ data, context }) => {
    await loadDevVars();
    const member = await requireClientAdmin(context.userId);
    const { data: rows, error } = await context.supabase
      .from("client_locations")
      .update({ name: data.name, address: data.address })
      .eq("id", data.id)
      .eq("client_id", member.clientId)
      .select("id");
    if (error) {
      if (error.code === "23505") unprocessable(`There's already a location called ${data.name}`);
      throw new Error(`Couldn't rename the location: ${error.message}`);
    }
    if (!rows?.length) forbidden("That location isn't part of your company");
    return { ok: true };
  });

// Claims and policies at a deleted location become company-wide
// (ON DELETE SET NULL). Refused while a location user depends on it.
export const deleteClientLocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseInput(z.object({ id: z.string().uuid() })))
  .handler(async ({ data, context }) => {
    await loadDevVars();
    const member = await requireClientAdmin(context.userId);
    const { count, error: usersError } = await supabaseAdmin
      .from("client_users")
      .select("user_id", { count: "exact", head: true })
      .eq("client_id", member.clientId)
      .contains("location_ids", [data.id]);
    if (usersError) throw new Error(usersError.message);
    if (count) {
      unprocessable(
        `${count === 1 ? "A user is" : `${count} users are`} set to this location. Change their access first.`,
      );
    }
    const { data: rows, error } = await context.supabase
      .from("client_locations")
      .delete()
      .eq("id", data.id)
      .eq("client_id", member.clientId)
      .select("id");
    if (error) throw new Error(`Couldn't delete the location: ${error.message}`);
    if (!rows?.length) forbidden("That location isn't part of your company");
    return { ok: true };
  });

const ClaimLocationSchema = z.object({
  claimId: z.string().uuid(),
  locationId: z.string().uuid().nullable(),
});

// The claim page's Location picker: agency staff, or a company-wide user of
// the claim's client. Clients can't update claims under RLS, so the write uses
// the service role after these checks; a trigger refuses another client's location.
export const setClaimLocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseInput(ClaimLocationSchema))
  .handler(async ({ data, context }) => {
    await loadDevVars();
    // Caller's token, so a claim they can't see is "not found" for them.
    const { data: claim } = await context.supabase
      .from("claims")
      .select("id, client_id")
      .eq("id", data.claimId)
      .maybeSingle();
    if (!claim) forbidden("You can't change this claim");

    if (!(await isAgencyAdmin(context.userId))) {
      const member = await getClientMembership(context.userId);
      if (!member || member.clientId !== claim.client_id || !isCompanyWide(member.role)) {
        forbidden("Only BRQR or your company's admins can change a claim's location");
      }
    }

    const { error } = await supabaseAdmin
      .from("claims")
      .update({ location_id: data.locationId })
      .eq("id", claim.id);
    if (error) {
      if (error.code === "23503") unprocessable("That location doesn't belong to this client");
      throw new Error(`Couldn't change the location: ${error.message}`);
    }
    return { ok: true };
  });
