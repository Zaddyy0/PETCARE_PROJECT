import {
  createApi,
  fetchBaseQuery,
  type BaseQueryFn,
  type FetchArgs,
  type FetchBaseQueryError,
} from '@reduxjs/toolkit/query/react';
import {
  SESSION_ENDED_ERROR_CODES,
  type ApiFailure,
  type ApiSuccess,
} from '@pawsitive/shared';
import { signedOut, tokenRefreshed, type AuthState } from '../slices/authSlice';

/**
 * The RTK Query base.
 *
 * Two problems are solved here that every hand-rolled API client gets wrong.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  1. UNWRAPPING THE ENVELOPE
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Every endpoint returns `{ success, message, data, requestId }`. Unwrapping
 * that in each endpoint's `transformResponse` would be ~30 copies of the same
 * two lines; doing it here means hooks receive `data` directly and never see
 * the envelope.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  2. REFRESHING WITHOUT A STAMPEDE
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Access tokens last 15 minutes. When one expires, a dashboard typically has
 * several queries in flight, so *all* of them get a 401 at once. The naive fix
 * — "on 401, call /auth/refresh and retry" — fires one refresh per failed
 * request.
 *
 * That is actively harmful here, not merely wasteful: refresh tokens rotate and
 * are single-use, so the first refresh invalidates the token the others are
 * about to present. The API correctly reads those as **token reuse** and
 * revokes the entire family — the user is signed out of every device by a
 * perfectly ordinary page load.
 *
 * The mutex below makes concurrent 401s await one shared refresh.
 */

const RAW_BASE = '/api/v1';

/* -------------------------------------------------------------------------- */
/*                                   Mutex                                    */
/* -------------------------------------------------------------------------- */

/**
 * A single in-flight refresh, shared by every waiter.
 *
 * Deliberately a bare promise rather than a library: the entire requirement is
 * "at most one of these at a time, and everyone else awaits the same result".
 */
let refreshInFlight: Promise<boolean> | null = null;

const rawBaseQuery = fetchBaseQuery({
  baseUrl: RAW_BASE,
  /**
   * Required for the refresh cookie to be sent at all.
   *
   * `fetch` omits cookies by default on anything but a same-origin GET. Without
   * this the refresh endpoint receives no cookie and every session ends after
   * 15 minutes.
   */
  credentials: 'include',

  prepareHeaders(headers, { getState }) {
    const { accessToken } = (getState() as { auth: AuthState }).auth;

    if (accessToken) {
      headers.set('authorization', `Bearer ${accessToken}`);
    }

    return headers;
  },
});

/** Ask the server for a new access token. Returns whether it worked. */
async function runRefresh(
  api: Parameters<BaseQueryFn>[1],
  extraOptions: Parameters<BaseQueryFn>[2],
): Promise<boolean> {
  const result = await rawBaseQuery(
    { url: '/auth/refresh', method: 'POST', body: {} },
    api,
    extraOptions,
  );

  const body = result.data as ApiSuccess<{
    tokens: { accessToken: string; expiresIn: number };
  }> | undefined;

  if (body?.success && body.data?.tokens) {
    api.dispatch(
      tokenRefreshed({
        accessToken: body.data.tokens.accessToken,
        expiresIn: body.data.tokens.expiresIn,
      }),
    );
    return true;
  }

  return false;
}

/**
 * The wrapped base query: refresh-on-401, then unwrap.
 */
const baseQueryWithReauth: BaseQueryFn<
  string | FetchArgs,
  unknown,
  FetchBaseQueryError
> = async (args, api, extraOptions) => {
  let result = await rawBaseQuery(args, api, extraOptions);

  /* ---- 401: try exactly one refresh, shared across callers. ------------- */
  if (result.error?.status === 401) {
    const failure = result.error.data as ApiFailure | undefined;

    /**
     * Some 401s are not worth refreshing.
     *
     * A revoked session or a detected token reuse means the refresh token is
     * already dead — retrying would produce a second failure and, worse, look
     * like more reuse. Sign out immediately instead.
     */
    const unrecoverable =
      failure?.code === 'REFRESH_TOKEN_REUSED' || failure?.code === 'SESSION_REVOKED';

    const isRefreshCall = typeof args === 'object' && args.url === '/auth/refresh';

    if (!unrecoverable && !isRefreshCall) {
      /* First caller creates the promise; the rest await the same one. */
      refreshInFlight ??= runRefresh(api, extraOptions).finally(() => {
        /* Cleared in `finally` so a failed refresh does not wedge the mutex
           closed for the rest of the session. */
        refreshInFlight = null;
      });

      const refreshed = await refreshInFlight;

      if (refreshed) {
        /* `prepareHeaders` reads the new token from the store on this retry. */
        result = await rawBaseQuery(args, api, extraOptions);
      } else {
        api.dispatch(signedOut());
      }
    } else {
      api.dispatch(signedOut());
    }
  }

  /* ---- Any other terminal auth failure ends the session. ---------------- */
  if (result.error) {
    const failure = result.error.data as ApiFailure | undefined;

    if (
      failure?.code &&
      (SESSION_ENDED_ERROR_CODES as readonly string[]).includes(failure.code) &&
      result.error.status !== 401
    ) {
      api.dispatch(signedOut());
    }

    return { error: result.error };
  }

  /* ---- Unwrap the envelope. -------------------------------------------- */
  const body = result.data as ApiSuccess<unknown> | undefined;

  /**
   * A 204 has no body, and some responses legitimately carry `data: null`.
   * Returning `undefined` rather than throwing keeps those endpoints usable.
   */
  if (body === undefined || body === null) {
    return { data: undefined, meta: result.meta };
  }

  /* A 2xx that is not our envelope means something proxied or rewrote the
     response. Surface it rather than handing a mystery object to a component. */
  if (typeof body !== 'object' || !('success' in body)) {
    return {
      error: {
        status: 'PARSING_ERROR',
        originalStatus: result.meta?.response?.status ?? 200,
        data: JSON.stringify(body).slice(0, 200),
        error: 'The server returned an unexpected response shape.',
      } satisfies FetchBaseQueryError,
    };
  }

  return { data: body.data, meta: result.meta };
};

/* -------------------------------------------------------------------------- */
/*                                  The API                                   */
/* -------------------------------------------------------------------------- */

/**
 * Cache tags.
 *
 * These are what replace the old "refetch everything after every mutation"
 * pattern. A mutation declares which tags it invalidates and RTK Query refetches
 * precisely those queries — so booking an appointment refreshes the appointment
 * list and the affected doctor's slot grid, and nothing else.
 */
export const TAGS = [
  'Auth',
  'User',
  'Clinic',
  'Pet',
  'Doctor',
  'Slots',
  'Appointment',
  'Calendar',
  'MedicalRecord',
  'Vaccination',
  'Review',
  'ReviewSummary',
  'Notification',
  'Analytics',
] as const;

export const baseApi = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithReauth,
  tagTypes: TAGS,

  /**
   * Cached data is dropped 60s after the last component unsubscribes.
   *
   * Long enough that navigating away and back is instant; short enough that
   * returning to a page after a real pause fetches fresh data rather than
   * showing a stale calendar.
   */
  keepUnusedDataFor: 60,

  /* Re-sync when the user comes back to the tab or regains connectivity —
     both are moments where our cache is most likely to be stale. */
  refetchOnFocus: true,
  refetchOnReconnect: true,

  endpoints: () => ({}),
});

/* -------------------------------------------------------------------------- */
/*                               Error helpers                                */
/* -------------------------------------------------------------------------- */

/**
 * Pull a displayable message out of an RTK Query error.
 *
 * Every layer produces a different shape — our `ApiFailure`, a network failure,
 * a parsing error — and components should not each re-derive this.
 */
export function errorMessage(error: unknown, fallback = 'Something went wrong.'): string {
  if (!error || typeof error !== 'object') return fallback;

  const candidate = error as { status?: unknown; data?: unknown; error?: unknown };

  /* Our envelope. */
  const failure = candidate.data as ApiFailure | undefined;
  if (failure?.message) return failure.message;

  /* The request never reached the server. Say so specifically — "something
     went wrong" sends people to support when the real problem is their wifi. */
  if (candidate.status === 'FETCH_ERROR') {
    return 'Could not reach the server. Check your connection and try again.';
  }

  if (candidate.status === 'PARSING_ERROR') {
    return 'The server returned an unexpected response.';
  }

  if (typeof candidate.error === 'string') return candidate.error;

  return fallback;
}

/** The stable machine-readable code, for branching on a specific failure. */
export function errorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const failure = (error as { data?: ApiFailure }).data;
  return failure?.code ?? null;
}

/** Field-level errors, keyed by field name, for attaching to form inputs. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!error || typeof error !== 'object') return {};

  const failure = (error as { data?: ApiFailure }).data;
  if (!failure?.errors) return {};

  const map: Record<string, string> = {};

  for (const entry of failure.errors) {
    /* First error per field wins — showing three messages under one input is
       noise, and the first is usually the most fundamental. */
    map[entry.field] ??= entry.message;
  }

  return map;
}

/** The request id, for a user to quote in a support message. */
export function errorRequestId(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  return (error as { data?: ApiFailure }).data?.requestId;
}
