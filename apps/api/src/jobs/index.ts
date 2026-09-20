/**
 * Scheduled jobs.
 *
 * Three things make this safe to run in a multi-instance deployment, and all
 * three matter:
 *
 *   • **Claim before work.** Each job marks its targets as claimed with an
 *     atomic update *before* acting on them, so two instances waking at the
 *     same second cannot both send the same reminder. A `find` then `send` then
 *     `mark` sequence emails everyone twice the day you scale to two servers.
 *
 *   • **Bounded batches.** A job processes at most a few hundred rows per tick.
 *     An unbounded sweep after a backlog would try to send ten thousand emails
 *     in one event-loop turn.
 *
 *   • **Never throw.** A failing job logs and returns. An unhandled rejection
 *     inside a cron callback takes down the whole process, which is a strange
 *     way to react to one undeliverable email.
 *
 * For a larger deployment these belong in a dedicated worker with a real queue.
 * The claim-first pattern means moving them there later changes where they run,
 * not how they behave.
 */

import cron, { type ScheduledTask } from 'node-cron';
import {
  AppointmentStatus,
  BOOKING,
  MEDICAL,
  NotificationType,
  SLOT_BLOCKING_STATUSES,
  VaccinationStatus,
} from '@pawsitive/shared';
import { env } from '../config/env.js';
import { createLogger } from '../config/logger.js';
import { Appointment } from '../models/appointment.model.js';
import { Doctor } from '../models/doctor.model.js';
import { Pet } from '../models/pet.model.js';
import { User } from '../models/user.model.js';
import { Vaccination } from '../models/vaccination.model.js';
import {
  appointmentReminderEmail,
  vaccinationDueEmail,
} from '../services/email.service.js';
import { notify } from '../services/notification.service.js';
import { sweepOverdue } from '../services/vaccination.service.js';

const log = createLogger('jobs');

const BATCH_SIZE = 200;

/* -------------------------------------------------------------------------- */
/*                            Appointment reminders                           */
/* -------------------------------------------------------------------------- */

/**
 * Send reminders for appointments inside each configured offset.
 *
 * `remindersSent` doubles as the claim: the `$ne` guard in the filter plus the
 * `$push` in the same atomic update means an appointment can only be claimed
 * once per offset, whichever instance gets there first.
 */
async function sendAppointmentReminders(): Promise<void> {
  const now = new Date();

  for (const offsetHours of BOOKING.REMINDER_OFFSETS_HOURS) {
    const windowStart = new Date(now.getTime() + (offsetHours - 0.5) * 3_600_000);
    const windowEnd = new Date(now.getTime() + (offsetHours + 0.5) * 3_600_000);

    /* One marker per offset, so the 24h and 2h reminders are independent. */
    const marker = new Date(Date.UTC(1970, 0, 1, offsetHours));

    const due = await Appointment.find({
      status: { $in: [AppointmentStatus.CONFIRMED, AppointmentStatus.PENDING] },
      slotStart: { $gte: windowStart, $lt: windowEnd },
      remindersSent: { $ne: marker },
    })
      .limit(BATCH_SIZE)
      .lean();

    if (due.length === 0) continue;

    let sent = 0;

    for (const appointment of due) {
      /**
       * Claim it first.
       *
       * The `$ne` in the filter makes this a compare-and-set: only one process
       * can transition this appointment for this offset, and it happens before
       * any email is composed. Claiming after sending is how duplicates happen.
       */
      const claimed = await Appointment.updateOne(
        { _id: appointment._id, remindersSent: { $ne: marker } },
        { $push: { remindersSent: marker } },
      );

      if (claimed.modifiedCount === 0) continue;

      const [pet, doctor] = await Promise.all([
        Pet.findById(appointment.pet).select('name').lean(),
        Doctor.findById(appointment.doctor).select('user title').lean(),
      ]);

      const doctorUser = doctor
        ? await User.findById(doctor.user).select('firstName lastName').lean()
        : null;

      const doctorName = doctorUser
        ? `${doctor?.title ?? ''} ${doctorUser.firstName} ${doctorUser.lastName}`.trim()
        : 'your veterinarian';

      await notify({
        userId: appointment.client,
        type: NotificationType.APPOINTMENT_REMINDER,
        title: offsetHours <= 3 ? 'Appointment soon' : 'Appointment tomorrow',
        body: `${pet?.name ?? 'Your pet'} is seeing ${doctorName}.`,
        data: { appointmentId: appointment._id.toString() },
        actionUrl: `/app/appointments/${appointment._id.toString()}`,
        priority: offsetHours <= 3 ? 'high' : 'normal',
        email: (recipient) =>
          appointmentReminderEmail(recipient.email, recipient.name, {
            petName: pet?.name ?? 'your pet',
            doctorName,
            when: appointment.slotStart.toUTCString(),
            hoursUntil: offsetHours,
          }),
      });

      sent += 1;
    }

    if (sent > 0) {
      log.info({ offsetHours, sent }, 'Appointment reminders sent');
    }
  }
}

/* -------------------------------------------------------------------------- */
/*                           Vaccination reminders                            */
/* -------------------------------------------------------------------------- */

async function sendVaccinationReminders(): Promise<void> {
  const horizon = new Date(Date.now() + MEDICAL.VACCINATION_REMINDER_DAYS * 86_400_000);

  const due = await Vaccination.find({
    status: { $in: [VaccinationStatus.SCHEDULED, VaccinationStatus.OVERDUE] },
    dueAt: { $lte: horizon },
    reminderSent: false,
  })
    .limit(BATCH_SIZE)
    .lean();

  if (due.length === 0) return;

  let sent = 0;

  for (const dose of due) {
    /* Same claim-first pattern: `reminderSent: false` in the filter. */
    const claimed = await Vaccination.updateOne(
      { _id: dose._id, reminderSent: false },
      { $set: { reminderSent: true } },
    );

    if (claimed.modifiedCount === 0) continue;

    const pet = await Pet.findById(dose.pet).select('name owner status').lean();

    /* Never chase an owner about a booster for a pet that is archived or has
       died — the single worst email this system could send. */
    if (!pet || pet.status !== 'active') continue;

    const isOverdue = dose.dueAt.getTime() < Date.now();

    await notify({
      userId: pet.owner,
      type: NotificationType.VACCINATION_DUE,
      title: isOverdue ? `${dose.vaccineName} is overdue` : `${dose.vaccineName} is due soon`,
      body: `${pet.name} is due for ${dose.vaccineName}.`,
      data: { petId: pet._id.toString(), vaccinationId: dose._id.toString() },
      actionUrl: `/app/pets/${pet._id.toString()}`,
      priority: isOverdue ? 'high' : 'normal',
      email: (recipient) =>
        vaccinationDueEmail(recipient.email, recipient.name, {
          petName: pet.name,
          vaccineName: dose.vaccineName,
          dueDate: dose.dueAt.toDateString(),
          isOverdue,
        }),
    });

    sent += 1;
  }

  if (sent > 0) {
    log.info({ sent }, 'Vaccination reminders sent');
  }
}

/* -------------------------------------------------------------------------- */
/*                              Housekeeping                                  */
/* -------------------------------------------------------------------------- */

/**
 * Cancel bookings left unconfirmed for too long.
 *
 * Without this, a client who books and is never confirmed holds that slot
 * indefinitely — the doctor's calendar fills with requests nobody actioned and
 * the time cannot be sold to anyone else.
 */
async function expireStalePendingAppointments(): Promise<void> {
  const cutoff = new Date(Date.now() - BOOKING.PENDING_EXPIRY_HOURS * 3_600_000);

  const stale = await Appointment.find({
    status: AppointmentStatus.PENDING,
    createdAt: { $lt: cutoff },
    /* Only ones already in the past — a pending booking three weeks out is not
       stale, it is simply not urgent yet. */
    slotStart: { $lt: new Date() },
  })
    .limit(BATCH_SIZE)
    .select('_id')
    .lean();

  if (stale.length === 0) return;

  const result = await Appointment.updateMany(
    { _id: { $in: stale.map((appointment) => appointment._id) } },
    {
      $set: {
        status: AppointmentStatus.CANCELLED,
        blocksSlot: false,
        cancelledAt: new Date(),
        cancelledBy: 'system',
        cancellationReason: 'Expired without confirmation',
      },
    },
  );

  log.info({ cancelled: result.modifiedCount }, 'Expired stale pending appointments');
}

/**
 * Mark confirmed appointments whose time has passed as no-shows.
 *
 * Run with a generous grace period, because a doctor running late is not a
 * no-show. Only `confirmed` is swept — an `in_progress` consultation that
 * overran must not be closed out from under the clinician.
 */
async function markMissedAppointments(): Promise<void> {
  const graceHours = 4;
  const cutoff = new Date(Date.now() - graceHours * 3_600_000);

  const result = await Appointment.updateMany(
    {
      status: AppointmentStatus.CONFIRMED,
      slotStart: { $lt: cutoff },
    },
    {
      $set: {
        status: AppointmentStatus.NO_SHOW,
        blocksSlot: false,
      },
    },
  );

  if (result.modifiedCount > 0) {
    log.info({ marked: result.modifiedCount }, 'Marked missed appointments as no-shows');
  }
}

/** Lift suspensions whose end date has passed. */
async function liftExpiredSuspensions(): Promise<void> {
  const result = await User.updateMany(
    { status: 'suspended', suspendedUntil: { $lt: new Date(), $ne: null } },
    {
      $set: { status: 'active', suspendedAt: null, suspendedReason: null, suspendedUntil: null },
    },
  );

  if (result.modifiedCount > 0) {
    log.info({ reactivated: result.modifiedCount }, 'Lifted expired suspensions');
  }
}

/* -------------------------------------------------------------------------- */
/*                                 Scheduling                                 */
/* -------------------------------------------------------------------------- */

/**
 * Wrap a job so a failure is logged and contained.
 *
 * `node-cron` does not catch rejections from an async callback, so without this
 * a single failed query becomes an unhandled rejection and the process exits.
 */
function safely(name: string, job: () => Promise<void>): () => void {
  return () => {
    void (async () => {
      const startedAt = Date.now();

      try {
        await job();
        log.debug({ job: name, ms: Date.now() - startedAt }, 'Job finished');
      } catch (error) {
        log.error({ err: error, job: name }, 'Scheduled job failed');
      }
    })();
  };
}

const tasks: ScheduledTask[] = [];

export function startScheduledJobs(): void {
  if (!env.ENABLE_SCHEDULED_JOBS) {
    log.info('Scheduled jobs are disabled (ENABLE_SCHEDULED_JOBS=false)');
    return;
  }

  /* Reminders every fifteen minutes. The half-hour window either side of each
     offset means a slightly late tick still catches everything. */
  tasks.push(
    cron.schedule('*/15 * * * *', safely('appointment-reminders', sendAppointmentReminders)),
  );

  /* Vaccinations once a day, mid-morning — nobody wants a 3am email about a
     booster. UTC, so the hour is predictable regardless of host timezone. */
  tasks.push(
    cron.schedule('0 9 * * *', safely('vaccination-reminders', sendVaccinationReminders), {
      timezone: 'Etc/UTC',
    }),
  );

  tasks.push(
    cron.schedule('30 2 * * *', safely('vaccination-overdue-sweep', async () => {
      const updated = await sweepOverdue();
      if (updated > 0) log.info({ updated }, 'Marked vaccinations overdue');
    })),
  );

  tasks.push(cron.schedule('0 * * * *', safely('expire-pending', expireStalePendingAppointments)));
  tasks.push(cron.schedule('15 * * * *', safely('mark-missed', markMissedAppointments)));
  tasks.push(cron.schedule('45 3 * * *', safely('lift-suspensions', liftExpiredSuspensions)));

  log.info({ jobs: tasks.length }, 'Scheduled jobs started');
}

/** Stop every task. Called from the graceful-shutdown path. */
export function stopScheduledJobs(): void {
  for (const task of tasks) {
    task.stop();
  }

  tasks.length = 0;
}

/* Exported for tests and for a manual run via the admin console. */
export const jobs = {
  sendAppointmentReminders,
  sendVaccinationReminders,
  expireStalePendingAppointments,
  markMissedAppointments,
  liftExpiredSuspensions,
};

export { SLOT_BLOCKING_STATUSES };
