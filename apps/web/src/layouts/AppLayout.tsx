import { AnimatePresence, motion } from 'framer-motion';
import { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AppointmentStatus } from '@pawsitive/shared';
import { useListAppointmentsQuery } from '@/app/api/appointmentApi';
import { useListReviewsQuery } from '@/app/api/reviewApi';
import { useAppSelector, useCan } from '@/app/hooks';
import { useRealtime } from '@/app/realtime/useRealtime';
import { selectRole } from '@/app/slices/authSlice';
import { Sidebar } from '@/components/Sidebar';
import { TopBar } from '@/components/TopBar';
import { LoadingPanel } from '@/design/Spinner';
import { fadeUp } from '@/lib/motion';

/**
 * The authenticated shell.
 *
 * Badge counts are fetched here rather than inside the sidebar so the sidebar
 * stays a pure presentational component — and so the two queries run once for
 * the whole shell instead of once per sidebar instance (there are two: the
 * desktop rail and the mobile drawer).
 *
 * Both are gated behind a permission check, so a client never issues a request
 * for a moderation queue they cannot read and then swallows the 403.
 */
export function AppLayout() {
  const location = useLocation();
  const role = useAppSelector(selectRole);

  /**
   * The single realtime connection for the session.
   *
   * Mounted here, not per-page, so it survives navigation — a socket that
   * reconnects on every route change would miss events during the gap and
   * hammer the handshake endpoint.
   */
  useRealtime();

  const canSeeClinicQueue = useCan('appointment:transition');
  const canModerate = useCan('review:moderate');

  const { data: pending } = useListAppointmentsQuery(
    { status: AppointmentStatus.PENDING, limit: 1 },
    { skip: !canSeeClinicQueue },
  );

  const { data: moderation } = useListReviewsQuery(
    { status: 'pending_moderation', limit: 1 },
    { skip: !canModerate },
  );

  const badges = {
    ...(pending?.pagination.total ? { pendingAppointments: pending.pagination.total } : {}),
    ...(moderation?.pagination.total ? { moderationQueue: moderation.pagination.total } : {}),
  };

  return (
    <div className="flex min-h-dvh bg-canvas">
      <Sidebar badges={badges} />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />

        {/* `id="main"` is the skip-link target from index.html. */}
        <main id="main" className="min-w-0 flex-1 px-4 py-6 lg:px-8">
          {/**
           * Route transitions keyed on the pathname.
           *
           * `mode="wait"` would be smoother but adds the exit duration to every
           * navigation, which makes the app feel slower the more you use it.
           * Cross-fading is the better trade for an application.
           */}
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={location.pathname}
              variants={fadeUp}
              initial="hidden"
              animate="visible"
              className="mx-auto w-full max-w-7xl"
            >
              {/* Suspense boundary for the lazily-loaded route modules. */}
              <Suspense fallback={<LoadingPanel />}>
                <Outlet context={{ role }} />
              </Suspense>
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
