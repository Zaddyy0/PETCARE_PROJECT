import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { Permission } from '@pawsitive/shared';
import { useAppSelector } from '@/app/hooks';
import {
  selectAuthResolved,
  selectIsAuthenticated,
  selectPermissions,
} from '@/app/slices/authSlice';
import { LoadingPanel } from '@/design/Spinner';
import { EmptyState } from '@/design/EmptyState';

/**
 * Route guards.
 *
 * The subtle part is the third state. Authentication is not a boolean while the
 * app is booting: the access token lives only in memory, so on a page reload
 * there is a window where we have *not yet* exchanged the refresh cookie and
 * genuinely do not know whether the user is signed in.
 *
 * Treating that as "not signed in" is the bug this guard exists to avoid — it
 * would bounce every reload to the sign-in page for a moment and, worse,
 * discard the URL the user was trying to reach. So we wait for the boot refresh
 * to settle before deciding anything.
 */

export function RequireAuth({ children }: { children: ReactNode }) {
  const resolved = useAppSelector(selectAuthResolved);
  const authenticated = useAppSelector(selectIsAuthenticated);
  const location = useLocation();

  /* Still exchanging the refresh cookie — hold, do not redirect. */
  if (!resolved) return <LoadingPanel label="Signing you in" />;

  if (!authenticated) {
    /**
     * Carry the attempted URL in location state.
     *
     * After signing in the user lands where they were going, rather than on a
     * generic dashboard — which matters most for the case this is designed
     * for: following a link from a reminder email into an expired session.
     */
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}

/** Keeps a signed-in user out of the sign-in and register pages. */
export function RequireAnonymous({ children }: { children: ReactNode }) {
  const resolved = useAppSelector(selectAuthResolved);
  const authenticated = useAppSelector(selectIsAuthenticated);

  if (!resolved) return <LoadingPanel label="Loading" />;
  if (authenticated) return <Navigate to="/app" replace />;

  return <>{children}</>;
}

/**
 * Capability guard for a whole route.
 *
 * Renders a "no access" state rather than redirecting. A redirect from a
 * deep-linked page is disorienting — the user clicks a link, lands somewhere
 * else entirely, and has no idea why. Saying so plainly is kinder and easier to
 * report.
 *
 * This is *not* the security boundary. The API re-derives permissions from the
 * database on every request; this only stops us rendering a page whose every
 * request would 403.
 */
export function RequirePermission({
  anyOf,
  children,
}: {
  anyOf: Permission[];
  children: ReactNode;
}) {
  const permissions = useAppSelector(selectPermissions);
  const allowed = anyOf.some((permission) => permissions.includes(permission));

  if (!allowed) {
    return (
      <EmptyState
        illustration="🔒"
        title="You do not have access to this page"
        description="If you think you should, ask your clinic administrator to check your role."
      />
    );
  }

  return <>{children}</>;
}
