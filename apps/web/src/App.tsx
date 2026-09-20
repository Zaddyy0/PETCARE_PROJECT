import { Suspense, useEffect, useRef } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { useRefreshMutation } from '@/app/api/authApi';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { authenticating, selectAuthStatus } from '@/app/slices/authSlice';
import { selectTheme, watchSystemTheme } from '@/app/slices/uiSlice';
import { Toaster } from '@/components/Toaster';
import { LoadingPanel } from '@/design/Spinner';
import { AppRoutes } from '@/routes';

/**
 * Restore the session on boot.
 *
 * The access token lives only in memory, so a page reload starts with no
 * credentials — the httpOnly refresh cookie is the only thing that survives.
 * This exchanges it for a fresh access token exactly once, before any protected
 * route is allowed to decide whether the user is signed in.
 *
 * The `useRef` guard matters: React 18's Strict Mode deliberately double-invokes
 * effects in development, and firing two refreshes would spend the single-use
 * rotated token twice. The server would correctly read that as token reuse and
 * revoke the whole family — so every dev reload would sign the user out. This is
 * the same stampede the base query's mutex prevents at runtime.
 */
function useSessionBootstrap() {
  const dispatch = useAppDispatch();
  const status = useAppSelector(selectAuthStatus);
  const [refresh] = useRefreshMutation();
  const started = useRef(false);

  useEffect(() => {
    if (started.current || status !== 'unknown') return;

    started.current = true;
    dispatch(authenticating());

    /* `refresh`'s own `onQueryStarted` dispatches the session or signs out, so
       there is nothing to handle here. */
    void refresh();
  }, [dispatch, refresh, status]);

  return status;
}

/** Keep the `system` theme in sync when the OS preference flips mid-session. */
function useSystemThemeSync() {
  const theme = useAppSelector(selectTheme);
  const latest = useRef(theme);

  useEffect(() => {
    latest.current = theme;
  }, [theme]);

  /* Subscribes once and reads the current choice through a ref, so changing the
     theme does not tear down and re-add the listener. */
  useEffect(() => watchSystemTheme(() => latest.current), []);
}

export default function App() {
  const status = useSessionBootstrap();
  useSystemThemeSync();

  /**
   * Hold the first paint until the boot refresh settles.
   *
   * Without this, a reload renders the sign-in page for a frame before the
   * session resolves — a visible flash, and one that also discards the URL the
   * user was navigating to.
   */
  if (status === 'unknown' || status === 'authenticating') {
    return <LoadingPanel label="Starting Pawsitive" />;
  }

  return (
    <BrowserRouter>
      <Suspense fallback={<LoadingPanel />}>
        <AppRoutes />
      </Suspense>

      {/* Outside the router: a toast must survive navigation, and the error
          middleware can raise one during a route change. */}
      <Toaster />
    </BrowserRouter>
  );
}
