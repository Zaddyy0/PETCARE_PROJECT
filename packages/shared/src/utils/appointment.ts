/**
 * The appointment state machine, and the rules around it.
 *
 * Transition legality is one question ("is pending → completed a real edge?")
 * and transition *authority* is another ("may a client confirm their own
 * booking?"). Both are answered here so the API and the UI agree on which
 * buttons exist, and neither has to re-derive the graph.
 */

import {
  APPOINTMENT_TRANSITIONS,
  AppointmentStatus,
  Role,
  TERMINAL_APPOINTMENT_STATUSES,
  type AppointmentStatus as AppointmentStatusType,
  type Role as RoleType,
} from '../enums.js';
import { BOOKING } from '../constants.js';
import { differenceInHours } from './datetime.js';

/** Is this edge present in the transition graph at all? */
export function isLegalTransition(
  from: AppointmentStatusType,
  to: AppointmentStatusType,
): boolean {
  return APPOINTMENT_TRANSITIONS[from].includes(to);
}

export function isTerminal(status: AppointmentStatusType): boolean {
  return TERMINAL_APPOINTMENT_STATUSES.includes(status);
}

/**
 * Which roles may drive a given transition.
 *
 * A client can cancel, and that is all — they cannot confirm their own booking
 * (the clinic decides), cannot start a consultation, and certainly cannot mark
 * themselves as having attended.
 */
const TRANSITION_AUTHORITY: Record<AppointmentStatusType, readonly RoleType[]> = {
  pending: [],
  confirmed: [Role.DOCTOR, Role.ADMIN, Role.SUPER_ADMIN],
  in_progress: [Role.DOCTOR, Role.ADMIN, Role.SUPER_ADMIN],
  completed: [Role.DOCTOR, Role.ADMIN, Role.SUPER_ADMIN],
  cancelled: [Role.CLIENT, Role.DOCTOR, Role.ADMIN, Role.SUPER_ADMIN],
  no_show: [Role.DOCTOR, Role.ADMIN, Role.SUPER_ADMIN],
};

export function canRoleTransitionTo(role: RoleType, to: AppointmentStatusType): boolean {
  return TRANSITION_AUTHORITY[to].includes(role);
}

/**
 * The transitions this role may actually perform from this state.
 *
 * The UI renders exactly these as buttons, so an action a user can see is
 * always an action the server will accept.
 */
export function allowedTransitionsFor(
  from: AppointmentStatusType,
  role: RoleType,
): AppointmentStatusType[] {
  return APPOINTMENT_TRANSITIONS[from].filter((to) => canRoleTransitionTo(role, to));
}

/* -------------------------------------------------------------------------- */
/*                          Cancellation & rescheduling                       */
/* -------------------------------------------------------------------------- */

export interface CancellationCheck {
  allowed: boolean;
  /** Set when `allowed` is false — a code from `ERROR_CODES`. */
  reason?: 'APPOINTMENT_ALREADY_TERMINAL' | 'APPOINTMENT_CANCELLATION_WINDOW_PASSED';
  hoursUntilStart: number;
}

/**
 * May this appointment still be cancelled online?
 *
 * Staff bypass the cutoff entirely: somebody has to be able to close out a
 * visit the client abandoned twenty minutes before it started. The window
 * exists to stop last-minute self-service cancellations from stranding a slot,
 * not to stop the clinic from managing its own calendar.
 */
export function canCancel(
  status: AppointmentStatusType,
  slotStart: Date | string,
  role: RoleType,
  now: Date = new Date(),
): CancellationCheck {
  const start = typeof slotStart === 'string' ? new Date(slotStart) : slotStart;
  const hoursUntilStart = differenceInHours(start, now);

  if (isTerminal(status)) {
    return { allowed: false, reason: 'APPOINTMENT_ALREADY_TERMINAL', hoursUntilStart };
  }

  if (role !== Role.CLIENT) {
    return { allowed: true, hoursUntilStart };
  }

  if (hoursUntilStart < BOOKING.CANCELLATION_WINDOW_HOURS) {
    return {
      allowed: false,
      reason: 'APPOINTMENT_CANCELLATION_WINDOW_PASSED',
      hoursUntilStart,
    };
  }

  return { allowed: true, hoursUntilStart };
}

export function canReschedule(
  status: AppointmentStatusType,
  slotStart: Date | string,
  role: RoleType,
  now: Date = new Date(),
): boolean {
  if (isTerminal(status) || status === AppointmentStatus.IN_PROGRESS) return false;
  if (role !== Role.CLIENT) return true;

  const start = typeof slotStart === 'string' ? new Date(slotStart) : slotStart;
  return differenceInHours(start, now) >= BOOKING.RESCHEDULE_WINDOW_HOURS;
}

/* -------------------------------------------------------------------------- */
/*                                 Presentation                               */
/* -------------------------------------------------------------------------- */

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatusType, string> = {
  pending: 'Awaiting confirmation',
  confirmed: 'Confirmed',
  in_progress: 'In consultation',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'Missed',
};

/**
 * Semantic tone per status, resolved to actual colours by the design system.
 *
 * Naming the *meaning* rather than the colour keeps this file useful when the
 * palette changes, and keeps a hardcoded `#22c55e` out of shared code.
 */
export const APPOINTMENT_STATUS_TONE: Record<
  AppointmentStatusType,
  'warning' | 'info' | 'accent' | 'success' | 'neutral' | 'danger'
> = {
  pending: 'warning',
  confirmed: 'info',
  in_progress: 'accent',
  completed: 'success',
  cancelled: 'neutral',
  no_show: 'danger',
};

/** Generate a short, human-quotable reference like `PAW-7QF2K9`. */
export function generateAppointmentReference(random: () => number = Math.random): string {
  /* Crockford-ish alphabet: no I, O, 0 or 1, so nobody misreads it over a phone. */
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let suffix = '';

  for (let index = 0; index < 6; index += 1) {
    suffix += alphabet.charAt(Math.floor(random() * alphabet.length));
  }

  return `PAW-${suffix}`;
}
