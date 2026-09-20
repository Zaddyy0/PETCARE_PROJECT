/**
 * Authorization policy.
 *
 * The permission matrix lives in `@pawsitive/shared` on purpose: the API uses it
 * to *enforce* access and the web client uses the identical table to *render*
 * access (hide a button, grey out a menu, skip a route). One table, so the UI
 * can never offer an action the server will reject, and the server can never
 * quietly gain a capability the UI forgets about.
 *
 * Two-layer model:
 *
 *   Layer 1 — capability.  "May this role ever do X?"  Answered here, statically.
 *   Layer 2 — ownership.   "May this *user* do X to *this row*?"  Answered by the
 *                          service layer, which has the document in hand.
 *
 * Layer 1 alone is never sufficient. A doctor holds `MEDICAL_RECORD_WRITE`, but
 * only for a pet they are actually treating; that second half is enforced in
 * `services/medical-record.service.ts`. Keeping the two layers distinct is what
 * stops "can this role?" from being mistaken for "can this person?" — the single
 * most common source of broken access control.
 */

import { Role, ROLE_RANK } from './enums.js';

/* -------------------------------------------------------------------------- */
/*                                 Permissions                                */
/* -------------------------------------------------------------------------- */

export const PERMISSIONS = [
  /* Pets ------------------------------------------------------------------ */
  'pet:create',
  'pet:read:own',
  /** Any pet in the actor's clinic (doctor/admin). Still subject to a care check. */
  'pet:read:clinic',
  /** Every pet on the platform. Super admin only. */
  'pet:read:any',
  'pet:update:own',
  'pet:update:any',
  'pet:delete:own',
  'pet:delete:any',

  /* Appointments ---------------------------------------------------------- */
  'appointment:create',
  'appointment:read:own',
  'appointment:read:clinic',
  'appointment:read:any',
  'appointment:cancel:own',
  'appointment:cancel:any',
  'appointment:reschedule:own',
  'appointment:reschedule:any',
  /** Confirm / start / complete / mark no-show. Clinic-side transitions. */
  'appointment:transition',

  /* Medical records & vaccinations ---------------------------------------- */
  'medical_record:read:own',
  'medical_record:read:clinic',
  'medical_record:read:any',
  /** Only clinicians may author clinical content. Admins deliberately cannot. */
  'medical_record:write',
  'vaccination:read:own',
  'vaccination:read:clinic',
  'vaccination:write',

  /* Users ----------------------------------------------------------------- */
  'user:read:clinic',
  'user:read:any',
  'user:create',
  'user:update:own',
  'user:update:any',
  'user:suspend',
  'user:delete',
  'user:change_role',
  /** Sign in as another user for support. Super admin only, always audited. */
  'user:impersonate',

  /* Doctors --------------------------------------------------------------- */
  'doctor:read:public',
  'doctor:create',
  'doctor:update:own',
  'doctor:update:any',
  'doctor:availability:own',
  'doctor:availability:any',

  /* Clinics --------------------------------------------------------------- */
  'clinic:read:own',
  'clinic:read:any',
  'clinic:create',
  'clinic:update:own',
  'clinic:update:any',
  'clinic:delete',

  /* Reviews --------------------------------------------------------------- */
  'review:read:public',
  'review:create',
  'review:update:own',
  'review:delete:own',
  'review:moderate',

  /* Analytics ------------------------------------------------------------- */
  'analytics:read:own',
  'analytics:read:clinic',
  'analytics:read:global',

  /* Platform -------------------------------------------------------------- */
  'audit:read',
  'notification:broadcast',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/* -------------------------------------------------------------------------- */
/*                            Role → permission matrix                        */
/* -------------------------------------------------------------------------- */

const CLIENT_PERMISSIONS = [
  'pet:create',
  'pet:read:own',
  'pet:update:own',
  'pet:delete:own',

  'appointment:create',
  'appointment:read:own',
  'appointment:cancel:own',
  'appointment:reschedule:own',

  'medical_record:read:own',
  'vaccination:read:own',

  'user:update:own',

  'doctor:read:public',

  'review:read:public',
  'review:create',
  'review:update:own',
  'review:delete:own',
] as const satisfies readonly Permission[];

const DOCTOR_PERMISSIONS = [
  /* A doctor inherits nothing from client: they are not a pet owner here. */
  'pet:read:clinic',

  'appointment:read:own',
  'appointment:transition',
  'appointment:cancel:any',
  'appointment:reschedule:any',

  'medical_record:read:clinic',
  'medical_record:write',
  'vaccination:read:clinic',
  'vaccination:write',

  'user:update:own',

  'doctor:read:public',
  'doctor:update:own',
  'doctor:availability:own',

  'clinic:read:own',

  'review:read:public',

  /** Their own utilisation, ratings and completion rate — nobody else's. */
  'analytics:read:own',
] as const satisfies readonly Permission[];

const ADMIN_PERMISSIONS = [
  'pet:read:clinic',

  'appointment:read:clinic',
  'appointment:transition',
  'appointment:cancel:any',
  'appointment:reschedule:any',

  /**
   * Admins may *read* clinical history for continuity of care and disputes,
   * but may not author it. Clinical authorship stays with licensed clinicians.
   */
  'medical_record:read:clinic',
  'vaccination:read:clinic',

  'user:read:clinic',
  'user:create',
  'user:update:own',
  'user:update:any',
  'user:suspend',

  'doctor:read:public',
  'doctor:create',
  'doctor:update:any',
  'doctor:availability:any',

  'clinic:read:own',
  'clinic:update:own',

  'review:read:public',
  'review:moderate',

  'analytics:read:clinic',
] as const satisfies readonly Permission[];

/** Super admin holds every permission by construction — no list to keep in sync. */
const SUPER_ADMIN_PERMISSIONS = PERMISSIONS;

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  [Role.CLIENT]: CLIENT_PERMISSIONS,
  [Role.DOCTOR]: DOCTOR_PERMISSIONS,
  [Role.ADMIN]: ADMIN_PERMISSIONS,
  [Role.SUPER_ADMIN]: SUPER_ADMIN_PERMISSIONS,
};

/* Pre-computed sets: permission checks run on nearly every request, so we pay
   the O(n) construction cost once at module load rather than per call. */
const ROLE_PERMISSION_SETS: Record<Role, ReadonlySet<Permission>> = {
  [Role.CLIENT]: new Set(CLIENT_PERMISSIONS),
  [Role.DOCTOR]: new Set(DOCTOR_PERMISSIONS),
  [Role.ADMIN]: new Set(ADMIN_PERMISSIONS),
  [Role.SUPER_ADMIN]: new Set(SUPER_ADMIN_PERMISSIONS),
};

/* -------------------------------------------------------------------------- */
/*                                   Helpers                                  */
/* -------------------------------------------------------------------------- */

/** Does this role hold the given capability? Layer 1 only. */
export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSION_SETS[role].has(permission);
}

/** Does this role hold *every* listed capability? */
export function roleHasAllPermissions(role: Role, permissions: readonly Permission[]): boolean {
  const granted = ROLE_PERMISSION_SETS[role];
  return permissions.every((permission) => granted.has(permission));
}

/** Does this role hold *at least one* of the listed capabilities? */
export function roleHasAnyPermission(role: Role, permissions: readonly Permission[]): boolean {
  const granted = ROLE_PERMISSION_SETS[role];
  return permissions.some((permission) => granted.has(permission));
}

/**
 * The broadest data scope this role may reach for a resource family.
 *
 * Services turn this into a Mongo filter: `own` pins the query to the actor's
 * id, `clinic` pins it to their clinic, `global` adds no constraint at all.
 * Centralising the translation is what keeps a missing `.where()` from
 * silently leaking another clinic's patient list.
 */
export type DataScope = 'own' | 'clinic' | 'global' | 'none';

export function resolveScope(
  role: Role,
  resource: 'pet' | 'appointment' | 'medical_record' | 'user' | 'analytics',
): DataScope {
  switch (resource) {
    case 'pet':
      if (roleHasPermission(role, 'pet:read:any')) return 'global';
      if (roleHasPermission(role, 'pet:read:clinic')) return 'clinic';
      if (roleHasPermission(role, 'pet:read:own')) return 'own';
      return 'none';
    case 'appointment':
      if (roleHasPermission(role, 'appointment:read:any')) return 'global';
      if (roleHasPermission(role, 'appointment:read:clinic')) return 'clinic';
      if (roleHasPermission(role, 'appointment:read:own')) return 'own';
      return 'none';
    case 'medical_record':
      if (roleHasPermission(role, 'medical_record:read:any')) return 'global';
      if (roleHasPermission(role, 'medical_record:read:clinic')) return 'clinic';
      if (roleHasPermission(role, 'medical_record:read:own')) return 'own';
      return 'none';
    case 'user':
      if (roleHasPermission(role, 'user:read:any')) return 'global';
      if (roleHasPermission(role, 'user:read:clinic')) return 'clinic';
      return 'own';
    case 'analytics':
      if (roleHasPermission(role, 'analytics:read:global')) return 'global';
      if (roleHasPermission(role, 'analytics:read:clinic')) return 'clinic';
      if (roleHasPermission(role, 'analytics:read:own')) return 'own';
      return 'none';
    default:
      return 'none';
  }
}

/**
 * May `actor` act on an account held by `target`?
 *
 * Strictly-greater rather than greater-or-equal, so two admins cannot suspend
 * each other and an admin cannot touch a super admin. The one exception is a
 * super admin, who outranks everyone including their peers — otherwise the last
 * super admin on the platform could never be demoted by anybody.
 */
export function canActOnRole(actorRole: Role, targetRole: Role): boolean {
  if (actorRole === Role.SUPER_ADMIN) return true;
  return ROLE_RANK[actorRole] > ROLE_RANK[targetRole];
}
