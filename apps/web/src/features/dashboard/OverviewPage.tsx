import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import {
  ROLE_LABELS,
  formatRelative,
  type AdminDashboard,
  type ClientDashboard,
  type DoctorDashboard,
  type SuperAdminDashboard,
} from '@pawsitive/shared';
import { useGetDashboardQuery } from '@/app/api/analyticsApi';
import { useAppSelector } from '@/app/hooks';
import { selectCurrentUser } from '@/app/slices/authSlice';
import { errorMessage } from '@/app/api/baseApi';
import { Card, CardHeader, StatTile } from '@/design/Card';
import { EmptyState, ErrorState } from '@/design/EmptyState';
import { SkeletonStatTile } from '@/design/Skeleton';
import { staggerContainer, staggerItem } from '@/lib/motion';

/**
 * The role-aware overview.
 *
 * One endpoint serves four dashboards — the *server* picks which, from the
 * caller's permissions. The `scope` discriminant then narrows the payload type,
 * so each branch below is fully typed without a cast.
 *
 * This page is the proof that the shape works end to end. The richer per-role
 * dashboards, with charts, land in phase 4.
 */
export default function OverviewPage() {
  const user = useAppSelector(selectCurrentUser);
  const { data, isLoading, error, refetch } = useGetDashboardQuery();

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-display-sm text-content text-balance">
          {greeting}
          {user?.firstName ? `, ${user.firstName}` : ''}
        </h1>
        <p className="mt-1 text-sm text-content-muted">
          {user ? ROLE_LABELS[user.role] : ''}
          {user?.lastLoginAt && ` · last signed in ${formatRelative(user.lastLoginAt)}`}
        </p>
      </header>

      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <SkeletonStatTile key={index} />
          ))}
        </div>
      )}

      {/* A failed query gets an inline error with a retry, not a toast — the
          page is what failed, so the message belongs on the page. */}
      {error && (
        <ErrorState
          title="We could not load your dashboard"
          description={errorMessage(error)}
          onRetry={() => void refetch()}
        />
      )}

      {data && (
        <motion.div
          variants={staggerContainer(0.05)}
          initial="hidden"
          animate="visible"
          className="space-y-6"
        >
          {data.scope === 'client' && <ClientOverview data={data.data} />}
          {data.scope === 'doctor' && <DoctorOverview data={data.data} />}
          {data.scope === 'clinic' && <ClinicOverview data={data.data} />}
          {data.scope === 'platform' && <PlatformOverview data={data.data} />}
        </motion.div>
      )}
    </div>
  );
}

/*
 * The four payload shapes, imported directly from the shared contract rather
 * than extracted from the hook's return type. Same types, but named at the
 * source — and inference through `ReturnType<typeof hook>` degrades to `any`
 * the moment RTK Query's generics change shape.
 */
type ClientData = ClientDashboard;
type DoctorData = DoctorDashboard;
type ClinicData = AdminDashboard;
type PlatformData = SuperAdminDashboard;

function Tiles({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{children}</div>;
}

function ClientOverview({ data }: { data: ClientData }) {
  return (
    <>
      <motion.div variants={staggerItem}>
        <Tiles>
          <StatTile label="Pets" value={data.petCount} icon="🐾" tone="primary" />
          <StatTile label="Upcoming visits" value={data.upcomingAppointments} icon="📅" tone="info" />
          <StatTile label="Completed visits" value={data.completedVisits} icon="✅" tone="success" />
          <StatTile
            label="Overdue vaccinations"
            value={data.overdueVaccinations}
            icon="💉"
            tone={data.overdueVaccinations > 0 ? 'danger' : 'success'}
          />
        </Tiles>
      </motion.div>

      <motion.div variants={staggerItem}>
        <Card>
          <CardHeader
            title="Next appointment"
            action={
              <Link to="/app/appointments" className="text-sm font-medium text-primary hover:underline">
                View all
              </Link>
            }
          />

          {data.nextAppointment ? (
            <div className="mt-4 flex items-center gap-4 rounded-lg bg-surface-sunken p-4">
              <span aria-hidden className="grid size-11 place-items-center rounded-lg bg-primary-soft text-xl">
                📅
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-content">
                  {data.nextAppointment.petName} with {data.nextAppointment.doctorName}
                </p>
                <p className="mt-0.5 text-sm text-content-muted">
                  {new Date(data.nextAppointment.slotStart).toLocaleString(undefined, {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}{' '}
                  · {formatRelative(data.nextAppointment.slotStart)}
                </p>
              </div>
            </div>
          ) : (
            <EmptyState
              compact
              illustration="📅"
              title="No upcoming appointments"
              description="Book a visit and it will appear here."
              action={
                <Link
                  to="/app/doctors"
                  className="text-sm font-medium text-primary hover:underline"
                >
                  Find a vet →
                </Link>
              }
            />
          )}
        </Card>
      </motion.div>
    </>
  );
}

function DoctorOverview({ data }: { data: DoctorData }) {
  return (
    <>
      <motion.div variants={staggerItem}>
        <Tiles>
          <StatTile label="Today" value={data.appointmentsToday} icon="📋" tone="primary" />
          <StatTile
            label="This period"
            value={data.appointmentsThisWeek.value}
            change={data.appointmentsThisWeek}
            icon="📅"
            tone="info"
          />
          <StatTile
            label="Completion rate"
            value={`${data.completionRate.value}%`}
            change={data.completionRate}
            icon="✅"
            tone="success"
          />
          <StatTile
            label="Average rating"
            value={data.averageRating.value.toFixed(1)}
            icon="⭐"
            tone="warning"
          />
        </Tiles>
      </motion.div>

      <motion.div variants={staggerItem}>
        <Card>
          <CardHeader
            title="Today's list"
            description={`${data.upcomingToday.length} appointment${data.upcomingToday.length === 1 ? '' : 's'}`}
            action={
              <Link to="/app/schedule" className="text-sm font-medium text-primary hover:underline">
                Full schedule
              </Link>
            }
          />

          {data.upcomingToday.length === 0 ? (
            <EmptyState compact illustration="☕" title="Nothing booked today" />
          ) : (
            <ul className="mt-4 divide-y divide-border">
              {data.upcomingToday.map((appointment) => (
                <li key={appointment.id} className="flex items-center gap-4 py-3">
                  <span className="w-16 shrink-0 font-mono text-sm tabular-nums text-content-muted">
                    {new Date(appointment.slotStart).toLocaleTimeString(undefined, {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-content">
                      {appointment.petName}
                    </p>
                    <p className="truncate text-xs text-content-subtle">{appointment.clientName}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </motion.div>
    </>
  );
}

function ClinicOverview({ data }: { data: ClinicData }) {
  return (
    <>
      <motion.div variants={staggerItem}>
        <Tiles>
          <StatTile
            label="Appointments"
            value={data.totalAppointments.value}
            change={data.totalAppointments}
            icon="📅"
            tone="primary"
          />
          <StatTile
            label="Revenue"
            value={`₹${data.totalRevenue.value.toLocaleString()}`}
            change={data.totalRevenue}
            icon="💰"
            tone="success"
          />
          <StatTile
            label="Active clients"
            value={data.activeClients.value}
            change={data.activeClients}
            icon="👥"
            tone="info"
          />
          <StatTile
            label="No-show rate"
            value={`${data.noShowRate.value}%`}
            change={data.noShowRate}
            icon="⚠️"
            tone="warning"
          />
        </Tiles>
      </motion.div>

      <motion.div variants={staggerItem}>
        <Card>
          <CardHeader title="Doctors" description="Ranked by appointment volume this period" />

          {data.doctorLeaderboard.length === 0 ? (
            <EmptyState compact illustration="🩺" title="No activity in this period" />
          ) : (
            <ul className="mt-4 divide-y divide-border">
              {data.doctorLeaderboard.slice(0, 5).map((doctor) => (
                <li key={doctor.doctorId} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-content">{doctor.fullName}</p>
                    <p className="truncate text-xs text-content-subtle">
                      {doctor.specializations.slice(0, 2).join(' · ')}
                    </p>
                  </div>
                  <span className="text-sm tabular-nums text-content-muted">
                    {doctor.appointments}
                  </span>
                  <span className="w-12 text-right text-sm tabular-nums text-content-muted">
                    ⭐ {doctor.averageRating.toFixed(1)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </motion.div>
    </>
  );
}

function PlatformOverview({ data }: { data: PlatformData }) {
  return (
    <>
      <motion.div variants={staggerItem}>
        <Tiles>
          <StatTile label="Clinics" value={data.totalClinics} icon="🏥" tone="primary" />
          <StatTile
            label="Users"
            value={data.totalUsers.value}
            change={data.totalUsers}
            icon="👥"
            tone="info"
          />
          <StatTile
            label="Pets"
            value={data.totalPets.value}
            change={data.totalPets}
            icon="🐾"
            tone="accent"
          />
          <StatTile
            label="Appointments"
            value={data.totalAppointments.value}
            change={data.totalAppointments}
            icon="📅"
            tone="success"
          />
        </Tiles>
      </motion.div>

      <motion.div variants={staggerItem}>
        <Card>
          <CardHeader title="System health" description="Live status of this API instance" />

          <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                label: 'Status',
                value: data.systemHealth.status,
                tone:
                  data.systemHealth.status === 'healthy'
                    ? 'text-success'
                    : 'text-warning',
              },
              {
                label: 'Database',
                value: `${data.systemHealth.databaseLatencyMs ?? '—'} ms`,
                tone: 'text-content',
              },
              {
                label: 'Memory',
                value: `${data.systemHealth.memoryUsedMb} MB`,
                tone: 'text-content',
              },
              {
                label: 'Live connections',
                value: String(data.systemHealth.activeSocketConnections),
                tone: 'text-content',
              },
            ].map((metric) => (
              <div key={metric.label} className="rounded-lg bg-surface-sunken p-3">
                <dt className="text-xs text-content-subtle">{metric.label}</dt>
                <dd className={`mt-0.5 text-sm font-semibold capitalize ${metric.tone}`}>
                  {metric.value}
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      </motion.div>
    </>
  );
}
