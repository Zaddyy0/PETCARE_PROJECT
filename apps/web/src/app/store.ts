import { configureStore, isRejectedWithValue, type Middleware } from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';
import { REFETCH_ON_ERROR_CODES, type ApiFailure } from '@pawsitive/shared';
import { baseApi } from './api/baseApi';
import authReducer from './slices/authSlice';
import toastReducer, { toastError, toastPushed } from './slices/toastSlice';
import uiReducer from './slices/uiSlice';

/* Endpoint files must be imported for their `injectEndpoints` side effect —
   without this the hooks exist as types but the endpoints are never registered. */
import './api/authApi';
import './api/petApi';
import './api/doctorApi';
import './api/appointmentApi';
import './api/medicalApi';
import './api/reviewApi';
import './api/notificationApi';
import './api/analyticsApi';
import './api/userApi';

/**
 * Surface failed mutations as toasts, centrally.
 *
 * Without this, every mutation call site needs its own `catch` that raises a
 * toast — dozens of copies, and the one that gets forgotten is a mutation that
 * fails completely silently. The user clicks "save", nothing happens, and there
 * is no indication why.
 *
 * Queries are deliberately excluded: a failed *query* belongs inline on the
 * page it was loading, as an error state with a retry, not as a toast that
 * vanishes while the screen stays empty.
 */
const errorToastMiddleware: Middleware = (store) => (next) => (action) => {
  if (!isRejectedWithValue(action)) return next(action);

  const meta = action.meta as { arg?: { type?: string; endpointName?: string } } | undefined;

  /* Only mutations. */
  if (meta?.arg?.type !== 'mutation') return next(action);

  const payload = action.payload as { status?: unknown; data?: ApiFailure } | undefined;
  const failure = payload?.data;
  const status = payload?.status;

  /**
   * 401 is handled by the base query, which refreshes or signs the user out.
   * A toast here would double up on the redirect to sign-in.
   */
  if (status === 401) return next(action);

  /* Field-level validation belongs on the inputs, not in a floating toast. */
  if (failure?.code === 'VALIDATION_FAILED' && failure.errors?.length) {
    return next(action);
  }

  if (status === 'FETCH_ERROR') {
    store.dispatch(
      toastError('You appear to be offline', 'We could not reach the server. Check your connection.'),
    );
    return next(action);
  }

  /**
   * Some failures are stale data rather than errors.
   *
   * `APPOINTMENT_SLOT_TAKEN` means somebody booked first — the honest framing
   * is "that time just went", with a nudge to pick another, not a red error.
   * The shared package lists which codes behave this way so the client and the
   * server agree on the classification.
   */
  const isStale =
    failure?.code && (REFETCH_ON_ERROR_CODES as readonly string[]).includes(failure.code);

  store.dispatch(
    toastPushed({
      tone: isStale ? 'warning' : 'error',
      title: failure?.message ?? 'Something went wrong',
      ...(failure?.requestId && !isStale
        ? { description: `Reference: ${failure.requestId}` }
        : {}),
    }),
  );

  return next(action);
};

export const store = configureStore({
  reducer: {
    auth: authReducer,
    ui: uiReducer,
    toast: toastReducer,
    [baseApi.reducerPath]: baseApi.reducer,
  },

  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        /**
         * RTK Query's internal actions carry non-serialisable values, and file
         * uploads put a `File` in a mutation argument. Both are legitimate, so
         * the paths are exempted rather than the check being switched off
         * wholesale — which would also stop catching our own mistakes.
         */
        ignoredActions: [
          'api/executeMutation/pending',
          'api/executeMutation/fulfilled',
          'api/executeMutation/rejected',
        ],
        ignoredPaths: ['api.mutations'],
      },
    }).concat(baseApi.middleware, errorToastMiddleware),

  /* The Redux DevTools extension, in development only. */
  devTools: import.meta.env.DEV,
});

/**
 * Wire up `refetchOnFocus` and `refetchOnReconnect`.
 *
 * Those flags on the API do nothing without this — they declare the intent,
 * and `setupListeners` attaches the actual `visibilitychange` and `online`
 * handlers that trigger it.
 */
setupListeners(store.dispatch);

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
