import { motion } from 'framer-motion';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  APPOINTMENT_TYPE_LABELS,
  AppointmentStatus,
  formatMoney,
  formatRelative,
  type AppointmentDetail,
  type AppointmentStatus as AppointmentStatusType,
} from '@pawsitive/shared';
import {
  useCancelAppointmentMutation,
  useListAppointmentsQuery,
  useTransitionAppointmentMutation,
} from '@/app/api/appointmentApi';
import { errorMessage } from '@/app/api/baseApi';
import { useAppDispatch, useCan } from '@/app/hooks';
import { toastSuccess } from '@/app/slices/toastSlice';
import { Avatar, PetAvatar } from '@/design/Avatar';
import { Badge, StatusBadge } from '@/design/Badge';
import { Button } from '@/design/Button';
import { Card } from '@/design/Card';
import { EmptyState, ErrorState } from '@/design/EmptyState';
import { Modal } from '@/design/Modal';
import { PageHeader } from '@/design/PageHeader';
import { Pagination } from '@/design/Pagination';
import { SkeletonCard } from '@/design/Skeleton';
import { Textarea } from '@/design/Field';
import { FilterChips, Toolbar } from '@/design/Toolbar';
import { cn } from '@/lib/cn';
import { staggerContainer, staggerItem } from '@/lib/motion';

type View = 'upcoming' | 'past' | 'all';

/**
 * The appointment list.
 *
 * Splits on **time**, not status, because that is how people actually think
 * about appointments: "what's coming up" and "what happened". A status filter
 * would put a cancelled visit from last month next to a confirmed one tomorrow.
 */
export default function AppointmentsPage() {
  const canBook = useCan('appointment:create');

  const [view, setView] = useState<View>('upcoming');
  const [page, setPage] = useState(1);
  const [cancelling, setCancelling] = useState<AppointmentDetail | null>(null);

  const now = new Date().toISOString();

  const { data, isLoading, error, refetch } = useListAppointmentsQuery({
    page,
    limit: 10,
    ...(view === 'upcoming'
      ? { from: now, sort: 'slotStart' as const, order: 'asc' as const }
      : view === 'past'
        ? { to: now, sort: 'slotStart' as const, order: 'desc' as const }
        : { sort: 'slotStart' as const, order: 'desc' as const }),
  });

  const setViewAndReset = (next: View) => {
    setView(next);
    setPage(1);
  };

  return (
    <div>
      <PageHeader
        title="Appointments"
        description="Everything booked, past and upcoming."
        actions={
          canBook && (
            <Link
              to="/app/appointments/new"
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-fg shadow-sm transition-colors hover:bg-primary-hover"
            >
              <svg aria-hidden viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.75">
                <path d="M8 3.5v9M3.5 8h9" strokeLinecap="round" />
              </svg>
              Book a visit
            </Link>
          )
        }
      />

      <Toolbar>
        <FilterChips
          label="Time period"
          options={[
            { value: 'upcoming', label: 'Upcoming' },
            { value: 'past', label: 'Past' },
            { value: 'all', label: 'All' },
          ]}
          value={view}
          onChange={setViewAndReset}
        />
      </Toolbar>

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 4 }, (_, index) => (
            <SkeletonCard key={index} />
          ))}
        </div>
      )}

      {error && (
        <ErrorState
          title="We could not load your appointments"
          description={errorMessage(error)}
          onRetry={() => void refetch()}
        />
      )}

      {data && data.items.length === 0 && (
        <EmptyState
          illustration={view === 'past' ? '🗂️' : '📅'}
          title={view === 'past' ? 'No past appointments' : 'Nothing booked yet'}
          description={
            view === 'past'
              ? 'Completed visits will appear here with their clinical notes.'
              : 'Book a visit and it will show up here — you will get a reminder the day before.'
          }
          action={
            canBook &&
            view !== 'past' && (
              <Link
                to="/app/appointments/new"
                className="inline-flex h-10 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-fg hover:bg-primary-hover"
              >
                Book a visit
              </Link>
            )
          }
        />
      )}

      {data && data.items.length > 0 && (
        <>
          <motion.div
            variants={staggerContainer(0.04)}
            initial="hidden"
            animate="visible"
            className="space-y-3"
          >
            {data.items.map((appointment) => (
              <motion.div key={appointment.id} variants={staggerItem}>
                <AppointmentRow
                  appointment={appointment}
                  onRequestCancel={() => setCancelling(appointment)}
                />
              </motion.div>
            ))}
          </motion.div>

          <Pagination pagination={data.pagination} onPageChange={setPage} />
        </>
      )}

      <CancelDialog appointment={cancelling} onClose={() => setCancelling(null)} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function AppointmentRow({
  appointment,
  onRequestCancel,
}: {
  appointment: AppointmentDetail;
  onRequestCancel: () => void;
}) {
  const dispatch = useAppDispatch();
  const [transition, { isLoading: transitioning }] = useTransitionAppointmentMutation();

  const start = new Date(appointment.slotStart);
  const isPast = start.getTime() < Date.now();

  /**
   * The actions come from `allowedTransitions`, computed server-side for this
   * viewer.
   *
   * So a client sees only "cancel" and a doctor sees the clinical transitions,
   * without this component knowing anything about roles — and the buttons on
   * screen are exactly the ones the API will accept.
   */
  const clinicalTransitions = appointment.allowedTransitions.filter(
    (status) => status !== AppointmentStatus.CANCELLED,
  );

  async function runTransition(status: AppointmentStatusType) {
    try {
      await transition({ id: appointment.id, body: { status } }).unwrap();
      dispatch(toastSuccess('Appointment updated'));
    } catch {
      /* The error middleware raises a toast. */
    }
  }

  return (
    <Card padding="none" className="overflow-hidden">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
        {/* ---- When ----------------------------------------------------- */}
        <div
          className={cn(
            'flex shrink-0 flex-row items-center gap-3 sm:w-24 sm:flex-col sm:items-start sm:gap-0',
            isPast && 'opacity-70',
          )}
        >
          <span className="text-xs font-medium uppercase tracking-wide text-content-subtle">
            {start.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
          </span>
          <span className="text-lg font-semibold tabular-nums leading-tight text-content">
            {start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
          </span>
          {!isPast && (
            <span className="text-[0.6875rem] text-content-subtle">
              {formatRelative(appointment.slotStart)}
            </span>
          )}
        </div>

        {/* ---- Who ------------------------------------------------------ */}
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <PetAvatar
            photo={appointment.pet.photo}
            name={appointment.pet.name}
            species={appointment.pet.species}
            size="md"
          />

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium text-content">{appointment.pet.name}</p>
              <StatusBadge status={appointment.status} size="sm" />
            </div>

            <p className="mt-0.5 truncate text-sm text-content-muted">
              {APPOINTMENT_TYPE_LABELS[appointment.type]} · {appointment.doctor.fullName}
            </p>

            <p className="mt-0.5 truncate text-xs text-content-subtle">{appointment.reason}</p>
          </div>

          <Avatar
            name={appointment.doctor.fullName}
            src={appointment.doctor.avatar?.url}
            size="sm"
            className="hidden sm:block"
          />
        </div>

        {/* ---- Actions -------------------------------------------------- */}
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <span className="mr-1 font-mono text-[0.6875rem] text-content-subtle">
            {appointment.reference}
          </span>

          {clinicalTransitions.map((status) => (
            <Button
              key={status}
              size="sm"
              variant={status === AppointmentStatus.COMPLETED ? 'primary' : 'outline'}
              loading={transitioning}
              onClick={() => void runTransition(status)}
            >
              {status === AppointmentStatus.CONFIRMED && 'Confirm'}
              {status === AppointmentStatus.IN_PROGRESS && 'Start'}
              {status === AppointmentStatus.COMPLETED && 'Complete'}
              {status === AppointmentStatus.NO_SHOW && 'No-show'}
            </Button>
          ))}

          {appointment.canReschedule && (
            <Button size="sm" variant="ghost" disabled>
              Reschedule
            </Button>
          )}

          {appointment.canCancel && (
            <Button size="sm" variant="ghost" onClick={onRequestCancel}>
              Cancel
            </Button>
          )}

          {appointment.canReview && (
            <Link
              to={`/app/appointments/${appointment.id}/review`}
              className="inline-flex h-8 items-center gap-1 rounded-md bg-accent px-3 text-xs font-medium text-accent-fg transition-colors hover:bg-accent-hover"
            >
              <span aria-hidden>⭐</span> Leave a review
            </Link>
          )}
        </div>
      </div>

      {/* Cancellation reason, once cancelled — otherwise the row just says
          "Cancelled" with no explanation of why. */}
      {appointment.status === AppointmentStatus.CANCELLED && appointment.cancellationReason && (
        <div className="border-t border-border bg-surface-sunken px-4 py-2.5">
          <p className="text-xs text-content-muted">
            <span className="font-medium">Cancelled</span>
            {appointment.cancelledBy && ` by the ${appointment.cancelledBy}`}:{' '}
            {appointment.cancellationReason}
          </p>
        </div>
      )}

      {appointment.status === AppointmentStatus.COMPLETED && (
        <div className="flex items-center justify-between gap-3 border-t border-border bg-surface-sunken px-4 py-2.5">
          <p className="text-xs text-content-muted">
            {appointment.hasMedicalRecord
              ? 'Clinical notes are available'
              : 'Awaiting clinical notes'}
          </p>
          <div className="flex items-center gap-3">
            <span className="text-xs tabular-nums text-content-muted">
              {formatMoney(appointment.fee)}
            </span>
            {appointment.hasMedicalRecord && (
              <Link
                to={`/app/pets/${appointment.pet.id}`}
                className="text-xs font-medium text-primary hover:underline"
              >
                View record
              </Link>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Cancellation requires a reason.
 *
 * Not friction for its own sake: the reason is shown to the clinic and stored
 * on the record, and a clinic that can see *why* appointments are cancelled can
 * do something about it.
 */
function CancelDialog({
  appointment,
  onClose,
}: {
  appointment: AppointmentDetail | null;
  onClose: () => void;
}) {
  const dispatch = useAppDispatch();
  const [reason, setReason] = useState('');
  const [cancel, { isLoading }] = useCancelAppointmentMutation();

  async function onConfirm() {
    if (!appointment || reason.trim().length < 3) return;

    try {
      await cancel({ id: appointment.id, reason: reason.trim() }).unwrap();
      dispatch(toastSuccess('Appointment cancelled', 'The slot is available for others again.'));
      setReason('');
      onClose();
    } catch {
      /* Surfaced by the error middleware. */
    }
  }

  return (
    <Modal
      open={Boolean(appointment)}
      onClose={onClose}
      title="Cancel this appointment?"
      description={
        appointment
          ? `${appointment.pet.name} with ${appointment.doctor.fullName} on ${new Date(
              appointment.slotStart,
            ).toLocaleString(undefined, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              hour: '2-digit',
              minute: '2-digit',
            })}`
          : undefined
      }
      size="sm"
      dismissible={!isLoading}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isLoading}>
            Keep it
          </Button>
          <Button
            variant="danger"
            loading={isLoading}
            disabled={reason.trim().length < 3}
            onClick={() => void onConfirm()}
          >
            Cancel appointment
          </Button>
        </>
      }
    >
      <Textarea
        name="reason"
        label="Why are you cancelling?"
        required
        rows={3}
        maxLength={300}
        showCount
        placeholder="Something came up and we cannot make this time."
        hint="The clinic sees this. It helps them offer the slot to someone else."
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />

      <p className="mt-3 text-xs text-content-subtle text-pretty">
        The time becomes available to other clients immediately.
      </p>
    </Modal>
  );
}
