import { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/layouts/AppLayout';
import { AuthLayout } from '@/layouts/AuthLayout';
import { makePlaceholder } from '@/features/PlaceholderPage';
import { RequireAnonymous, RequireAuth, RequirePermission } from './guards';

/**
 * The route table.
 *
 * Every page is `lazy()`-loaded, so the initial bundle carries the shell and
 * the sign-in form and nothing else. A client never downloads the admin
 * console, and the `manualChunks` split in `vite.config.ts` keeps the vendor
 * code in its own cacheable chunk.
 *
 * Route-level `RequirePermission` is a rendering guard, not a security
 * boundary — the API re-derives permissions from the database on every request.
 * It exists so a deep link to a page the user cannot use says so, rather than
 * rendering a screen where every request fails.
 */

/* ------------------------------ Auth pages ------------------------------- */
const LoginPage = lazy(() => import('@/features/auth/LoginPage'));
const RegisterPage = lazy(() => import('@/features/auth/RegisterPage'));
const ForgotPasswordPage = lazy(() => import('@/features/auth/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('@/features/auth/ResetPasswordPage'));
const AcceptInvitePage = lazy(() => import('@/features/auth/AcceptInvitePage'));

/* ------------------------------- App pages ------------------------------- */
const OverviewPage = lazy(() => import('@/features/dashboard/OverviewPage'));
const NotFoundPage = lazy(() => import('@/features/NotFoundPage'));

const PetsPage = lazy(() => import('@/features/pets/PetsPage'));
const PetDetailPage = lazy(() => import('@/features/pets/PetDetailPage'));
const PetFormPage = lazy(() => import('@/features/pets/PetFormPage'));
const AppointmentsPage = lazy(() => import('@/features/appointments/AppointmentsPage'));
const BookAppointmentPage = lazy(() => import('@/features/appointments/BookAppointmentPage'));
const DoctorsPage = lazy(() => import('@/features/doctors/DoctorsPage'));
const DoctorProfilePage = lazy(() => import('@/features/doctors/DoctorProfilePage'));
const SchedulePage = lazy(() => import('@/features/schedule/SchedulePage'));
const RecordsPage = lazy(() => import('@/features/clinical/RecordsPage'));
const VaccinationsPage = lazy(() => import('@/features/clinical/VaccinationsPage'));
const ManageUsersPage = lazy(() => import('@/features/manage/ManageUsersPage'));
const AnalyticsPage = lazy(() => import('@/features/analytics/AnalyticsPage'));
const NotificationsPage = lazy(() => import('@/features/notifications/NotificationsPage'));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage'));

/**
 * Still stubbed.
 *
 * Wired so the navigation and guards can be walked end to end — a route that
 * resolves to nothing is indistinguishable from a broken link during review.
 */
const ManageDoctorsPage = makePlaceholder('Manage doctors', '🩺');
const ModerateReviewsPage = makePlaceholder('Review moderation', '⭐');
const MyReviewsPage = makePlaceholder('My reviews', '⭐');
const ClinicsPage = makePlaceholder('Clinics', '🏥');
const AuditPage = makePlaceholder('Audit log', '🛡️');
const SecurityPage = makePlaceholder('Password & sessions', '🔒');

export function AppRoutes() {
  return (
    <Routes>
      {/* ---- Public / anonymous ------------------------------------------ */}
      <Route
        element={
          <RequireAnonymous>
            <AuthLayout />
          </RequireAnonymous>
        }
      >
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      </Route>

      {/**
       * Reset and invite are outside `RequireAnonymous`.
       *
       * A signed-in user following a reset link from their email must still be
       * able to use it — bouncing them to the dashboard because they happen to
       * have a session makes the link useless exactly when it is needed.
       */}
      <Route element={<AuthLayout />}>
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/accept-invite" element={<AcceptInvitePage />} />
      </Route>

      {/* ---- Authenticated ---------------------------------------------- */}
      <Route
        path="/app"
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<OverviewPage />} />

        {/* Pets — owners only. */}
        <Route
          path="pets"
          element={
            <RequirePermission anyOf={['pet:read:own', 'pet:read:clinic', 'pet:read:any']}>
              <PetsPage />
            </RequirePermission>
          }
        />
        <Route
          path="pets/new"
          element={
            <RequirePermission anyOf={['pet:create']}>
              <PetFormPage />
            </RequirePermission>
          }
        />
        {/* Declared after `pets/new`, or "new" would be parsed as a pet id. */}
        <Route
          path="pets/:petId"
          element={
            <RequirePermission anyOf={['pet:read:own', 'pet:read:clinic', 'pet:read:any']}>
              <PetDetailPage />
            </RequirePermission>
          }
        />
        <Route
          path="pets/:petId/edit"
          element={
            <RequirePermission anyOf={['pet:update:own', 'pet:update:any']}>
              <PetFormPage />
            </RequirePermission>
          }
        />

        {/* Appointments. */}
        <Route
          path="appointments"
          element={
            <RequirePermission
              anyOf={['appointment:read:own', 'appointment:read:clinic', 'appointment:read:any']}
            >
              <AppointmentsPage />
            </RequirePermission>
          }
        />
        <Route
          path="appointments/new"
          element={
            <RequirePermission anyOf={['appointment:create']}>
              <BookAppointmentPage />
            </RequirePermission>
          }
        />

        {/* Doctor directory. */}
        <Route path="doctors" element={<DoctorsPage />} />
        <Route path="doctors/:doctorId" element={<DoctorProfilePage />} />

        {/* Clinical. */}
        <Route
          path="records"
          element={
            <RequirePermission
              anyOf={[
                'medical_record:read:own',
                'medical_record:read:clinic',
                'medical_record:read:any',
              ]}
            >
              <RecordsPage />
            </RequirePermission>
          }
        />
        <Route
          path="vaccinations"
          element={
            <RequirePermission anyOf={['vaccination:read:own', 'vaccination:read:clinic']}>
              <VaccinationsPage />
            </RequirePermission>
          }
        />

        {/* Clinic side. */}
        <Route
          path="schedule"
          element={
            <RequirePermission anyOf={['appointment:transition']}>
              <SchedulePage />
            </RequirePermission>
          }
        />
        <Route
          path="manage/doctors"
          element={
            <RequirePermission anyOf={['doctor:create', 'doctor:update:any']}>
              <ManageDoctorsPage />
            </RequirePermission>
          }
        />
        <Route
          path="manage/users"
          element={
            <RequirePermission anyOf={['user:read:clinic', 'user:read:any']}>
              <ManageUsersPage />
            </RequirePermission>
          }
        />
        <Route
          path="manage/reviews"
          element={
            <RequirePermission anyOf={['review:moderate']}>
              <ModerateReviewsPage />
            </RequirePermission>
          }
        />
        <Route path="reviews" element={<MyReviewsPage />} />

        <Route
          path="analytics"
          element={
            <RequirePermission
              anyOf={['analytics:read:own', 'analytics:read:clinic', 'analytics:read:global']}
            >
              <AnalyticsPage />
            </RequirePermission>
          }
        />

        {/* Platform — super admin. */}
        <Route
          path="platform/clinics"
          element={
            <RequirePermission anyOf={['clinic:read:any', 'clinic:create']}>
              <ClinicsPage />
            </RequirePermission>
          }
        />
        <Route
          path="platform/audit"
          element={
            <RequirePermission anyOf={['audit:read']}>
              <AuditPage />
            </RequirePermission>
          }
        />

        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="settings/security" element={<SecurityPage />} />

        {/* An unknown path *inside* the shell goes to the dashboard rather than
            a full-page 404 — the user is signed in and oriented, so dropping
            them out of the app would be worse. */}
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Route>

      {/* ---- Root and catch-all ----------------------------------------- */}
      <Route path="/" element={<Navigate to="/app" replace />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
