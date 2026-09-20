import { AnimatePresence, motion } from 'framer-motion';
import { useMemo, useState } from 'react';
import {
  APPOINTMENT_TYPE_LABELS,
  AppointmentStatus,
  type CalendarEntry,
} from '@pawsitive/shared';
import { useGetCalendarQuery, useTransitionAppointmentMutation } from '@/app/api/appointmentApi';
import { useListDoctorsQuery } from '@/app/api/doctorApi';
import { errorMessage } from '@/app/api/baseApi';
import { useAppSelector, useCan } from '@/app/hooks';
import { useDoctorCalendarSubscription } from '@/app/realtime/useRealtime';
import { selectDoctorId, selectRole } from '@/app/slices/authSlice';
import { StatusBadge } from '@/design/Badge';
import { Button } from '@/design/Button';
import { Card } from '@/design/Card';
import { EmptyState, ErrorState } from '@/design/EmptyState';
import { PageHeader } from '@/design/PageHeader';
import { Skeleton } from '@/design/Skeleton';
import { cn } from '@/lib/cn';
import { spring, staggerContainer, staggerItem } from '@/lib/motion';

/**
 * The clinic-side day view.
 *
 * A vertical agenda, not a grid calendar. A day of 20-minute appointments in a
 * time-grid layout is mostly empty pixels and unreadable on a phone; an agenda
 * list scales to any slot length and reads the same on every screen.
 *
 * Subscribes to the doctor's calendar room, so an appointment booked by a
 * client appears here without a refresh — the single most valuable piece of
 * realtime in the product.
 */
export default function SchedulePage() {
  const role = useAppSelector(selectRole);
  const ownDoctorId = useAppSelector(selectDoctorId);
  const canSeeClinic = useCan('appointment:read:clinic');

  /* A doctor sees themselves; an admin picks from the roster. */
  const [selectedDoctor, setSelectedDoctor] = useState<string>(ownDoctorId ?? '');
  const [dayOffset, setDayOffset] = useState(0);

  const { data: doctors } = useListDoctorsQuery(
    { limit: 50 },
    { skip: !canSeeClinic || Boolean(ownDoctorId) },
  );

  const day = useMemo(() => {
    const date = new Date();
    date.setDate(date.getDate() + dayOffset);
    date.setHours(0, 0, 0, 0);
    return date;
  }, [dayOffset]);

  const dayEnd = useMemo(() => new Date(day.getTime() + 86_400_000), [day]);

  const {
    data: entries,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useGetCalendarQuery({
    from: day.toISOString(),
    to: dayEnd.toISOString(),
    ...(selectedDoctor ? { doctorId: selectedDoctor } : {}),
  });

  /* Live updates for whichever calendar is on screen. */
  useDoctorCalendarSubscription(selectedDoctor || ownDoctorId);

  const isToday = dayOffset === 0;

  const grouped = useMemo(() => groupByHour(entries ?? []), [entries]);

  const stats = useMemo(() => {
    const list = entries ?? [];
    return {
      total: list.length,
      done: list.filter((entry) => entry.status === AppointmentStatus.COMPLETED).length,
      pending: list.filter((entry) => entry.status === AppointmentStatus.PENDING).length,
      inProgress: list.filter((entry) => entry.status === AppointmentStatus.IN_PROGRESS).length,
    };
  }, [entries]);

  return (
    <div>
      <PageHeader
        title="Schedule"
        description={
          role === 'doctor'
            ? 'Your day, updating live as bookings come in.'
            : "The clinic's day, updating live as bookings come in."
        }
      />

      {/* ---- Day navigation --------------------------------------------- */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-border bg-surface p-1">
          <button
            type="button"
            onClick={() => setDayOffset((current) => current - 1)}
            aria-label="Previous day"
            className="grid size-8 place-items-center rounded-md text-content-muted transition-colors hover:bg-surface-hover hover:text-content"
          >
            <svg aria-hidden viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.75">
              <path d="M10 4l-4 4 4 4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          <button
            type="button"
            onClick={() => setDayOffset(0)}
            className={cn(
              'h-8 rounded-md px-3 text-sm font-medium transition-colors',
              isToday ? 'bg-primary text-primary-fg' : 'text-content-muted hover:bg-surface-hover',
            )}
          >
            Today
          </button>

          <button
            type="button"
            onClick={() => setDayOffset((current) => current + 1)}
            aria-label="Next day"
            className="grid size-8 place-items-center rounded-md text-content-muted transition-colors hover:bg-surface-hover hover:text-content"
          >
            <svg aria-hidden viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.75">
              <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        <div className="min-w-0">
          {/* `aria-live` so a screen reader hears the day change when the
              arrows are used. */}
          <p aria-live="polite" className="text-sm font-semibold text-content">
            {day.toLocaleDateString(undefined, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </p>
          <p className="text-xs text-content-subtle">
            {stats.total} appointment{stats.total === 1 ? '' : 's'}
            {stats.done > 0 && ` · ${stats.done} done`}
            {stats.pending > 0 && ` · ${stats.pending} awaiting confirmation`}
          </p>
        </div>

        {/* Admins pick a clinician; a doctor's own id is fixed. */}
        {!ownDoctorId && doctors && (
          <select
            value={selectedDoctor}
            onChange={(event) => setSelectedDoctor(event.target.value)}
            aria-label="Filter by clinician"
            className="ml-auto h-10 rounded-lg border border-border bg-surface px-3 text-sm text-content"
          >
            <option value="">Whole clinic</option>
            {doctors.items.map((doctor) => (
              <option key={doctor.id} value={doctor.id}>
                {doctor.fullName}
              </option>
            ))}
          </select>
        )}

        {/* A quiet indicator that a background refetch is in flight — better
            than a spinner that replaces the whole list. */}
        {isFetching && !isLoading && (
          <span className="flex items-center gap-1.5 text-xs text-content-subtle">
            <span aria-hidden className="size-1.5 animate-breathe rounded-full bg-success" />
            Live
          </span>
        )}
      </div>

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-20 rounded-xl" />
          ))}
        </div>
      )}

      {error && (
        <ErrorState
          title="We could not load the schedule"
          description={errorMessage(error)}
          onRetry={() => void refetch()}
        />
      )}

      {entries && entries.length === 0 && (
        <EmptyState
          illustration={isToday ? '☕' : '🗓️'}
          title={isToday ? 'Nothing booked today' : 'Nothing booked'}
          description={
            isToday
              ? 'A quiet one. New bookings will appear here automatically.'
              : 'Try another day, or check the whole clinic.'
          }
        />
      )}

      {entries && entries.length > 0 && (
        <motion.div variants={staggerContainer(0.03)} initial="hidden" animate="visible">
          <AnimatePresence initial={false}>
            {grouped.map(([hour, group]) => (
              <motion.section key={hour} layout variants={staggerItem} className="mb-4">
                <h2 className="mb-2 flex items-center gap-3 text-xs font-semibold uppercase tracking-wider text-content-subtle">
                  <span className="tabular-nums">{hour}</span>
                  <span aria-hidden className="h-px flex-1 bg-border" />
                </h2>

                <div className="space-y-2">
                  {group.map((entry) => (
                    <ScheduleRow key={entry.id} entry={entry} />
                  ))}
                </div>
              </motion.section>
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ScheduleRow({ entry }: { entry: CalendarEntry }) {
  const [transition, { isLoading }] = useTransitionAppointmentMutation();

  /**
   * The next action, chosen from the status.
   *
   * One button rather than a row of them: during a clinic day there is exactly
   * one thing a clinician wants to do to the appointment in front of them, and
   * making them pick from four reduces a one-tap action to a decision.
   */
  const next =
    entry.status === AppointmentStatus.PENDING
      ? { status: AppointmentStatus.CONFIRMED, label: 'Confirm' }
      : entry.status === AppointmentStatus.CONFIRMED
        ? { status: AppointmentStatus.IN_PROGRESS, label: 'Start' }
        : entry.status === AppointmentStatus.IN_PROGRESS
          ? { status: AppointmentStatus.COMPLETED, label: 'Complete' }
          : null;

  const start = new Date(entry.slotStart);
  const isPast = new Date(entry.slotEnd).getTime() < Date.now();

  return (
    <motion.div layout transition={spring}>
      <Card
        padding="none"
        className={cn(
          'flex flex-wrap items-center gap-3 p-3.5',
          /* An in-progress consultation is highlighted — it is the one row that
             matters right now. */
          entry.status === AppointmentStatus.IN_PROGRESS && 'border-primary bg-primary-soft/40',
          isPast && entry.status !== AppointmentStatus.IN_PROGRESS && 'opacity-70',
        )}
      >
        <span className="w-14 shrink-0 font-mono text-sm tabular-nums text-content-muted">
          {start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-content">{entry.petName}</p>
            <StatusBadge status={entry.status} size="sm" />
          </div>
          <p className="mt-0.5 truncate text-xs text-content-muted">
            {entry.clientName} · {APPOINTMENT_TYPE_LABELS[entry.type]}
          </p>
        </div>

        <span className="hidden font-mono text-[0.6875rem] text-content-subtle sm:inline">
          {entry.reference}
        </span>

        {next && (
          <Button
            size="sm"
            variant={next.status === AppointmentStatus.COMPLETED ? 'primary' : 'outline'}
            loading={isLoading}
            onClick={() =>
              void transition({ id: entry.id, body: { status: next.status } })
                .unwrap()
                .catch(() => undefined)
            }
          >
            {next.label}
          </Button>
        )}
      </Card>
    </motion.div>
  );
}

/** Group entries into hour buckets, preserving order. */
function groupByHour(entries: CalendarEntry[]): [string, CalendarEntry[]][] {
  const buckets = new Map<string, CalendarEntry[]>();

  for (const entry of [...entries].sort((a, b) => a.slotStart.localeCompare(b.slotStart))) {
    const hour = new Date(entry.slotStart).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    /* Bucket by the hour, not the exact minute, so 09:00 and 09:20 sit under
       one heading. */
    const key = `${hour.slice(0, 2)}:00`;

    const bucket = buckets.get(key);
    if (bucket) bucket.push(entry);
    else buckets.set(key, [entry]);
  }

  return [...buckets.entries()];
}
