import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import {
  ROLE_PERMISSIONS,
  Role,
  type CurrentUser,
  type Permission,
} from '@pawsitive/shared';

/**
 * Authentication state.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  WHY THE ACCESS TOKEN LIVES IN REDUX AND NOT IN localStorage
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The previous implementation kept its JWT in `localStorage`, which any script
 * on the page can read — one XSS, one dependency compromise, one malicious
 * browser extension, and the token is exfiltrated and valid until it expires.
 *
 * Here the access token is held only in memory, in this slice. It dies with the
 * tab, so there is nothing at rest to steal. The *refresh* token lives in an
 * httpOnly cookie the page cannot read at all, which is what restores the
 * session after a reload: on boot the app calls `/auth/refresh`, the browser
 * attaches the cookie automatically, and a fresh access token comes back.
 *
 * The cost is one extra request on a cold load. That is the entire trade, and
 * it is worth it.
 *
 * `status` exists to distinguish "not signed in" from "we do not know yet".
 * Without it, every protected route flashes the sign-in page for one frame
 * during that boot refresh — which also throws away the route the user was
 * trying to reach.
 */

export type AuthStatus = 'unknown' | 'authenticating' | 'authenticated' | 'anonymous';

export interface AuthState {
  status: AuthStatus;
  user: CurrentUser | null;
  accessToken: string | null;
  /** Epoch ms at which the access token expires, for proactive refresh. */
  expiresAt: number | null;
  /** Resolved once on sign-in, as a Set — permission checks run on every render. */
  permissions: Permission[];
}

const initialState: AuthState = {
  status: 'unknown',
  user: null,
  accessToken: null,
  expiresAt: null,
  permissions: [],
};

export interface SessionPayload {
  user: CurrentUser;
  accessToken: string;
  expiresIn: number;
}

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    /** Marks the boot refresh as in flight, so routes wait instead of redirecting. */
    authenticating(state) {
      state.status = 'authenticating';
    },

    sessionEstablished(state, action: PayloadAction<SessionPayload>) {
      const { user, accessToken, expiresIn } = action.payload;

      state.status = 'authenticated';
      state.user = user;
      state.accessToken = accessToken;
      state.expiresAt = Date.now() + expiresIn * 1000;
      /**
       * Prefer the server's list, fall back to deriving it.
       *
       * The server sends the resolved permissions with the session; the fallback
       * covers an older response shape. Either way the client only ever *renders*
       * from this — the server re-derives and enforces on every request, so a
       * tampered store buys nothing.
       */
      state.permissions = user.permissions?.length
        ? user.permissions
        : [...ROLE_PERMISSIONS[user.role]];
    },

    /** The access token was rotated; the user is unchanged. */
    tokenRefreshed(state, action: PayloadAction<{ accessToken: string; expiresIn: number }>) {
      state.accessToken = action.payload.accessToken;
      state.expiresAt = Date.now() + action.payload.expiresIn * 1000;
      state.status = 'authenticated';
    },

    /** Profile updated elsewhere (settings, avatar upload) — keep the session. */
    userUpdated(state, action: PayloadAction<Partial<CurrentUser>>) {
      if (!state.user) return;
      state.user = { ...state.user, ...action.payload };
    },

    /**
     * Clear everything.
     *
     * Used for sign-out *and* for any unrecoverable auth failure. Resetting to
     * `anonymous` rather than `unknown` matters: `unknown` would send the app
     * back into its boot-refresh path and loop.
     */
    signedOut(state) {
      state.status = 'anonymous';
      state.user = null;
      state.accessToken = null;
      state.expiresAt = null;
      state.permissions = [];
    },
  },
});

export const {
  authenticating,
  sessionEstablished,
  tokenRefreshed,
  userUpdated,
  signedOut,
} = authSlice.actions;

export default authSlice.reducer;

/* -------------------------------------------------------------------------- */
/*                                  Selectors                                 */
/* -------------------------------------------------------------------------- */

interface RootLike {
  auth: AuthState;
}

export const selectAuthStatus = (state: RootLike) => state.auth.status;
export const selectCurrentUser = (state: RootLike) => state.auth.user;
export const selectAccessToken = (state: RootLike) => state.auth.accessToken;
export const selectPermissions = (state: RootLike) => state.auth.permissions;

/** True only once the boot refresh has settled, either way. */
export const selectAuthResolved = (state: RootLike) =>
  state.auth.status === 'authenticated' || state.auth.status === 'anonymous';

export const selectIsAuthenticated = (state: RootLike) => state.auth.status === 'authenticated';

export const selectRole = (state: RootLike): Role | null => state.auth.user?.role ?? null;

/**
 * Capability check for rendering.
 *
 * This is the *same* permission matrix the API enforces with, imported from
 * `@pawsitive/shared` — which is the point of that package. The UI cannot offer
 * a button the server will reject, and it cannot hide one the server would
 * allow, because both sides read one table.
 */
export const selectCan = (permission: Permission) => (state: RootLike) =>
  state.auth.permissions.includes(permission);

export const selectCanAny = (permissions: Permission[]) => (state: RootLike) =>
  permissions.some((permission) => state.auth.permissions.includes(permission));

/** The doctor profile id, for a clinician's own-records queries. */
export const selectDoctorId = (state: RootLike) => state.auth.user?.doctorId ?? null;
export const selectClinicId = (state: RootLike) => state.auth.user?.clinicId ?? null;

export const selectIsImpersonating = (state: RootLike) =>
  Boolean(state.auth.user?.isImpersonating);
