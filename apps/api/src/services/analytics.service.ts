/**
 * Analytics.
 *
 * One endpoint, four shapes. The **server** picks which dashboard to build from
 * the caller's permissions — the client never asks for a scope it might not
 * hold, so there is no "is this user allowed to see platform numbers?" check to
 * forget. A doctor asking for analytics gets doctor analytics by construction.
 *
 * Everything here is aggregation-pipeline work rather than fetch-and-count in
 * JavaScript. Counting a year of appointments by pulling them into memory works
 * fine on seed data and falls over on real volume; `$group` does it in the
 * database, against an index.
 */

import { Types, type PipelineStage } from 'mongoose';
import {
  APPOINTMENT_TYPE_LABELS,
  AppointmentStatus,
  PET_SPECIES_LABELS,
  Role,
  type AdminDashboard,
  type AnalyticsQuery,
  type ClientDashboard,
  type DistributionSlice,
  type DoctorDashboard,
  type MetricValue,
  type RoleDashboard,
  type SuperAdminDashboard,
  type TimeSeries,
  type TimeSeriesPoint,
} from '@pawsitive/shared';
import { Appointment } from '../models/appointment.model.js';
import { Clinic } from '../models/clinic.model.js';
import { Doctor } from '../models/doctor.model.js';
import { Pet } from '../models/pet.model.js';
import { Review } from '../models/review.model.js';
import { User } from '../models/user.model.js';
import { Vaccination } from '../models/vaccination.model.js';
import { connectionCount } from '../realtime/emitter.js';
import { getDatabaseState, pingDatabase } from '../config/database.js';
import { env } from '../config/env.js';
import { ApiError } from '../utils/api-error.js';
import { ERROR_CODES } from '@pawsitive/shared';
import type { AuthContext } from '../types/express.js';
import { processStartedAt } from '../routes/health.routes.js';

/* -------------------------------------------------------------------------- */
/*                                   Window                                   */
/* -------------------------------------------------------------------------- */

interface Window {
  from: Date;
  to: Date;
  /** The equal-length window immediately before, for period-on-period deltas. */
  previousFrom: Date;
  previousTo: Date;
  /** Month buckets for long ranges, day buckets for short ones. */
  granularity: 'day' | 'month';
}

function resolveWindow(query: AnalyticsQuery): Window {
  const to = query.to ? new Date(query.to) : new Date();

  const spanDays =
    query.period === '7d'
      ? 7
      : query.period === '90d'
        ? 90
        : query.period === '12m'
          ? 365
          : query.period === 'custom' && query.from
            ? Math.max(1, Math.round((to.getTime() - new Date(query.from).getTime()) / 86_400_000))
            : 30;

  const from = query.from && query.period === 'custom'
    ? new Date(query.from)
    : new Date(to.getTime() - spanDays * 86_400_000);

  const span = to.getTime() - from.getTime();

  return {
    from,
    to,
    previousFrom: new Date(from.getTime() - span),
    previousTo: from,
    /* Daily buckets past ~90 days produce an unreadable chart and a large
       payload; switch to months. */
    granularity: spanDays > 92 ? 'month' : 'day',
  };
}

/**
 * Build a metric with its period-on-period movement.
 *
 * `changePercent` is `null` rather than `Infinity` when the previous window was
 * zero — "up ∞%" renders as garbage, and "new" is the honest label.
 */
function metric(value: number, previousValue: number): MetricValue {
  const changePercent =
    previousValue === 0 ? null : Math.round(((value - previousValue) / previousValue) * 100);

  return {
    value,
    previousValue,
    changePercent,
    trend: value > previousValue ? 'up' : value < previousValue ? 'down' : 'flat',
  };
}

function percentage(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10;
}

/* -------------------------------------------------------------------------- */
/*                                  Entry point                               */
/* -------------------------------------------------------------------------- */

export async function getDashboard(
  auth: AuthContext,
  query: AnalyticsQuery,
): Promise<RoleDashboard> {
  const window = resolveWindow(query);

  if (auth.permissions.has('analytics:read:global')) {
    return { scope: 'platform', data: await platformDashboard(window) };
  }

  if (auth.permissions.has('analytics:read:clinic')) {
    if (!auth.clinicId) throw ApiError.forbidden(ERROR_CODES.OUTSIDE_CLINIC_SCOPE);
    return { scope: 'clinic', data: await clinicDashboard(auth.clinicId, window) };
  }

  if (auth.permissions.has('analytics:read:own') && auth.role === Role.DOCTOR) {
    if (!auth.doctorId) throw ApiError.forbidden(ERROR_CODES.INSUFFICIENT_PERMISSION);
    return { scope: 'doctor', data: await doctorDashboard(auth.doctorId, window) };
  }

  /* Clients hold no analytics permission, but their own dashboard is just their
     own data reshaped — no cross-tenant exposure, so it is served here. */
  return { scope: 'client', data: await clientDashboard(auth.userId) };
}

/* -------------------------------------------------------------------------- */
/*                                   Client                                   */
/* -------------------------------------------------------------------------- */

async function clientDashboard(userId: Types.ObjectId): Promise<ClientDashboard> {
  const pets = await Pet.find({ owner: userId, status: 'active' }).select('_id name').lean();
  const petIds = pets.map((pet) => pet._id);
  const now = new Date();

  const [petCount, upcoming, completed, overdueVaccinations, nextAppointment, spend, visitsByPet] =
    await Promise.all([
      pets.length,
      Appointment.countDocuments({
        client: userId,
        status: { $in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED] },
        slotStart: { $gte: now },
      }),
      Appointment.countDocuments({ client: userId, status: AppointmentStatus.COMPLETED }),
      petIds.length > 0
        ? Vaccination.countDocuments({
            pet: { $in: petIds },
            status: { $in: ['overdue'] },
          })
        : 0,
      Appointment.findOne({
        client: userId,
        status: { $in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED] },
        slotStart: { $gte: now },
      })
        .sort({ slotStart: 1 })
        .lean(),
      monthlySpend(userId),
      visitCountByPet(userId, pets),
    ]);

  let next: ClientDashboard['nextAppointment'] = null;

  if (nextAppointment) {
    const [pet, doctor] = await Promise.all([
      Pet.findById(nextAppointment.pet).select('name').lean(),
      Doctor.findById(nextAppointment.doctor).select('user title').lean(),
    ]);

    const doctorUser = doctor
      ? await User.findById(doctor.user).select('firstName lastName').lean()
      : null;

    next = {
      id: nextAppointment._id.toString(),
      slotStart: nextAppointment.slotStart.toISOString(),
      petName: pet?.name ?? 'Your pet',
      doctorName: doctorUser
        ? `${doctor?.title ?? ''} ${doctorUser.firstName} ${doctorUser.lastName}`.trim()
        : 'your veterinarian',
      type: nextAppointment.type,
    };
  }

  return {
    petCount,
    upcomingAppointments: upcoming,
    completedVisits: completed,
    overdueVaccinations,
    nextAppointment: next,
    spendByMonth: spend,
    visitsByPet,
  };
}

async function monthlySpend(userId: Types.ObjectId): Promise<TimeSeries> {
  const rows = await Appointment.aggregate<{ _id: string; total: number }>([
    { $match: { client: userId, status: AppointmentStatus.COMPLETED } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m', date: '$slotStart' } },
        total: { $sum: '$feeAmountMinor' },
      },
    },
    { $sort: { _id: 1 } },
    { $limit: 24 },
  ]);

  return {
    label: 'Spend',
    /* Minor units to major, so the chart axis reads as currency. */
    points: rows.map((row) => ({ date: row._id, value: Math.round(row.total / 100) })),
  };
}

async function visitCountByPet(
  userId: Types.ObjectId,
  pets: { _id: Types.ObjectId; name: string }[],
): Promise<DistributionSlice[]> {
  if (pets.length === 0) return [];

  const rows = await Appointment.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $match: { client: userId, status: AppointmentStatus.COMPLETED } },
    { $group: { _id: '$pet', count: { $sum: 1 } } },
  ]);

  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const nameById = new Map(pets.map((pet) => [pet._id.toString(), pet.name]));

  return rows.map((row) => ({
    key: row._id.toString(),
    label: nameById.get(row._id.toString()) ?? 'Former pet',
    value: row.count,
    percentage: percentage(row.count, total),
  }));
}

/* -------------------------------------------------------------------------- */
/*                                   Doctor                                   */
/* -------------------------------------------------------------------------- */

async function doctorDashboard(
  doctorId: Types.ObjectId,
  window: Window,
): Promise<DoctorDashboard> {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setUTCHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday.getTime() + 86_400_000);

  const base = { doctor: doctorId };

  const [
    appointmentsToday,
    thisWindow,
    previousWindow,
    completedNow,
    completedPrev,
    noShowNow,
    noShowPrev,
    patientsNow,
    patientsPrev,
    doctor,
    series,
    byType,
    todayList,
  ] = await Promise.all([
    Appointment.countDocuments({
      ...base,
      slotStart: { $gte: startOfToday, $lt: endOfToday },
      status: { $nin: [AppointmentStatus.CANCELLED] },
    }),
    Appointment.countDocuments({ ...base, slotStart: { $gte: window.from, $lt: window.to } }),
    Appointment.countDocuments({
      ...base,
      slotStart: { $gte: window.previousFrom, $lt: window.previousTo },
    }),
    Appointment.countDocuments({
      ...base,
      status: AppointmentStatus.COMPLETED,
      slotStart: { $gte: window.from, $lt: window.to },
    }),
    Appointment.countDocuments({
      ...base,
      status: AppointmentStatus.COMPLETED,
      slotStart: { $gte: window.previousFrom, $lt: window.previousTo },
    }),
    Appointment.countDocuments({
      ...base,
      status: AppointmentStatus.NO_SHOW,
      slotStart: { $gte: window.from, $lt: window.to },
    }),
    Appointment.countDocuments({
      ...base,
      status: AppointmentStatus.NO_SHOW,
      slotStart: { $gte: window.previousFrom, $lt: window.previousTo },
    }),
    distinctCount(Appointment, 'client', { ...base, slotStart: { $gte: window.from, $lt: window.to } }),
    distinctCount(Appointment, 'client', {
      ...base,
      slotStart: { $gte: window.previousFrom, $lt: window.previousTo },
    }),
    Doctor.findById(doctorId).select('ratingAverage ratingCount ratingDistribution').lean(),
    timeSeries(base, window, 'Appointments'),
    typeDistribution(base, window),
    Appointment.find({
      ...base,
      slotStart: { $gte: startOfToday, $lt: endOfToday },
      status: { $nin: [AppointmentStatus.CANCELLED] },
    })
      .sort({ slotStart: 1 })
      .limit(20)
      .lean(),
  ]);

  /* Names for today's list, in two queries rather than two per row. */
  const pets = await Pet.find({ _id: { $in: todayList.map((a) => a.pet) } })
    .select('name')
    .lean();
  const clients = await User.find({ _id: { $in: todayList.map((a) => a.client) } })
    .select('firstName lastName')
    .lean();

  const petNames = new Map(pets.map((pet) => [pet._id.toString(), pet.name]));
  const clientNames = new Map(
    clients.map((c) => [c._id.toString(), `${c.firstName} ${c.lastName}`.trim()]),
  );

  const ratingDistribution: DistributionSlice[] = doctor
    ? ([5, 4, 3, 2, 1] as const).map((star) => ({
        key: String(star),
        label: `${star} star${star === 1 ? '' : 's'}`,
        value: doctor.ratingDistribution[star],
        percentage: percentage(doctor.ratingDistribution[star], doctor.ratingCount),
      }))
    : [];

  return {
    appointmentsToday,
    appointmentsThisWeek: metric(thisWindow, previousWindow),
    completionRate: metric(percentage(completedNow, thisWindow), percentage(completedPrev, previousWindow)),
    noShowRate: metric(percentage(noShowNow, thisWindow), percentage(noShowPrev, previousWindow)),
    averageRating: metric(doctor?.ratingAverage ?? 0, doctor?.ratingAverage ?? 0),
    totalPatients: metric(patientsNow, patientsPrev),
    /* Utilisation needs the offered-slot count, which means expanding the
       availability grid — deferred to a background job rather than computed on
       a dashboard request, so this reports booked volume for now. */
    utilizationRate: metric(thisWindow, previousWindow),
    appointmentsOverTime: series,
    appointmentsByType: byType,
    ratingDistribution,
    upcomingToday: todayList.map((appointment) => ({
      id: appointment._id.toString(),
      slotStart: appointment.slotStart.toISOString(),
      petName: petNames.get(appointment.pet.toString()) ?? 'Unknown',
      clientName: clientNames.get(appointment.client.toString()) ?? 'Unknown',
      type: appointment.type,
      status: appointment.status,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/*                                Clinic (admin)                              */
/* -------------------------------------------------------------------------- */

async function clinicDashboard(
  clinicId: Types.ObjectId,
  window: Window,
): Promise<AdminDashboard> {
  const base = { clinic: clinicId };
  const inWindow = { ...base, slotStart: { $gte: window.from, $lt: window.to } };
  const inPrevious = {
    ...base,
    slotStart: { $gte: window.previousFrom, $lt: window.previousTo },
  };

  const [
    total,
    totalPrev,
    revenue,
    revenuePrev,
    activeClients,
    activeClientsPrev,
    activeDoctors,
    cancelled,
    cancelledPrev,
    noShow,
    noShowPrev,
    series,
    revenueSeries,
    byStatus,
    byType,
    bySpecies,
    peak,
    leaderboard,
    ratingRow,
  ] = await Promise.all([
    Appointment.countDocuments(inWindow),
    Appointment.countDocuments(inPrevious),
    sumRevenue(inWindow),
    sumRevenue(inPrevious),
    distinctCount(Appointment, 'client', inWindow),
    distinctCount(Appointment, 'client', inPrevious),
    Doctor.countDocuments({ clinic: clinicId, isActive: true }),
    Appointment.countDocuments({ ...inWindow, status: AppointmentStatus.CANCELLED }),
    Appointment.countDocuments({ ...inPrevious, status: AppointmentStatus.CANCELLED }),
    Appointment.countDocuments({ ...inWindow, status: AppointmentStatus.NO_SHOW }),
    Appointment.countDocuments({ ...inPrevious, status: AppointmentStatus.NO_SHOW }),
    timeSeries(base, window, 'Appointments'),
    revenueTimeSeries(base, window),
    statusDistribution(base, window),
    typeDistribution(base, window),
    speciesDistribution(clinicId),
    peakHours(base, window),
    doctorLeaderboard(clinicId, window),
    clinicAverageRating(clinicId),
  ]);

  return {
    totalAppointments: metric(total, totalPrev),
    totalRevenue: metric(Math.round(revenue / 100), Math.round(revenuePrev / 100)),
    activeClients: metric(activeClients, activeClientsPrev),
    activeDoctors,
    averageRating: metric(ratingRow, ratingRow),
    cancellationRate: metric(percentage(cancelled, total), percentage(cancelledPrev, totalPrev)),
    noShowRate: metric(percentage(noShow, total), percentage(noShowPrev, totalPrev)),
    appointmentsOverTime: series,
    revenueOverTime: revenueSeries,
    appointmentsByStatus: byStatus,
    appointmentsByType: byType,
    petsBySpecies: bySpecies,
    peakHours: peak,
    doctorLeaderboard: leaderboard,
  };
}

async function clinicAverageRating(clinicId: Types.ObjectId): Promise<number> {
  const [row] = await Review.aggregate<{ average: number }>([
    { $match: { clinic: clinicId, status: 'published' } },
    { $group: { _id: null, average: { $avg: '$rating' } } },
    { $project: { _id: 0, average: { $round: ['$average', 2] } } },
  ]);

  return row?.average ?? 0;
}

async function doctorLeaderboard(clinicId: Types.ObjectId, window: Window) {
  const rows = await Appointment.aggregate<{
    _id: Types.ObjectId;
    appointments: number;
    completed: number;
    revenue: number;
  }>([
    { $match: { clinic: clinicId, slotStart: { $gte: window.from, $lt: window.to } } },
    {
      $group: {
        _id: '$doctor',
        appointments: { $sum: 1 },
        completed: {
          $sum: { $cond: [{ $eq: ['$status', AppointmentStatus.COMPLETED] }, 1, 0] },
        },
        revenue: {
          $sum: {
            $cond: [{ $eq: ['$status', AppointmentStatus.COMPLETED] }, '$feeAmountMinor', 0],
          },
        },
      },
    },
    { $sort: { appointments: -1 } },
    { $limit: 20 },
  ]);

  if (rows.length === 0) return [];

  const doctors = await Doctor.find({ _id: { $in: rows.map((row) => row._id) } })
    .select('user specializations ratingAverage ratingCount')
    .lean();

  const users = await User.find({ _id: { $in: doctors.map((d) => d.user) } })
    .select('firstName lastName avatar')
    .lean();

  const userById = new Map(users.map((user) => [user._id.toString(), user]));
  const doctorById = new Map(doctors.map((doctor) => [doctor._id.toString(), doctor]));

  return rows.flatMap((row) => {
    const doctor = doctorById.get(row._id.toString());
    const user = doctor ? userById.get(doctor.user.toString()) : undefined;
    if (!doctor || !user) return [];

    return [
      {
        doctorId: row._id.toString(),
        fullName: `${user.firstName} ${user.lastName}`.trim(),
        ...(user.avatar
          ? { avatar: { url: user.avatar.url, publicId: user.avatar.publicId } }
          : {}),
        specializations: doctor.specializations,
        appointments: row.appointments,
        completionRate: percentage(row.completed, row.appointments),
        averageRating: doctor.ratingAverage,
        reviewCount: doctor.ratingCount,
        revenueMinor: row.revenue,
        utilizationRate: 0,
      },
    ];
  });
}

/* -------------------------------------------------------------------------- */
/*                             Platform (super admin)                        */
/* -------------------------------------------------------------------------- */

async function platformDashboard(window: Window): Promise<SuperAdminDashboard> {
  const inWindow = { slotStart: { $gte: window.from, $lt: window.to } };
  const inPrevious = { slotStart: { $gte: window.previousFrom, $lt: window.previousTo } };

  const [
    totalClinics,
    users,
    usersPrev,
    doctors,
    doctorsPrev,
    pets,
    petsPrev,
    appointments,
    appointmentsPrev,
    revenue,
    revenuePrev,
    signups,
    series,
    byRole,
    bySpecies,
    clinics,
    latency,
  ] = await Promise.all([
    Clinic.countDocuments({ isActive: true }),
    User.countDocuments({ createdAt: { $lt: window.to } }),
    User.countDocuments({ createdAt: { $lt: window.from } }),
    Doctor.countDocuments({ isActive: true, createdAt: { $lt: window.to } }),
    Doctor.countDocuments({ isActive: true, createdAt: { $lt: window.from } }),
    Pet.countDocuments({ createdAt: { $lt: window.to } }),
    Pet.countDocuments({ createdAt: { $lt: window.from } }),
    Appointment.countDocuments(inWindow),
    Appointment.countDocuments(inPrevious),
    sumRevenue(inWindow),
    sumRevenue(inPrevious),
    signupSeries(window),
    timeSeries({}, window, 'Appointments'),
    roleDistribution(),
    speciesDistribution(null),
    clinicLeaderboard(window),
    pingDatabase(),
  ]);

  const memory = process.memoryUsage();

  return {
    totalClinics,
    totalUsers: metric(users, usersPrev),
    totalDoctors: metric(doctors, doctorsPrev),
    totalPets: metric(pets, petsPrev),
    totalAppointments: metric(appointments, appointmentsPrev),
    platformRevenue: metric(Math.round(revenue / 100), Math.round(revenuePrev / 100)),
    newSignupsOverTime: signups,
    appointmentsOverTime: series,
    usersByRole: byRole,
    petsBySpecies: bySpecies,
    clinicLeaderboard: clinics,
    systemHealth: {
      status: latency !== null ? 'healthy' : 'degraded',
      uptimeSeconds: Math.floor((Date.now() - processStartedAt) / 1000),
      databaseStatus: getDatabaseState() === 'connected' ? 'connected' : 'disconnected',
      databaseLatencyMs: latency,
      memoryUsedMb: Math.round(memory.rss / 1024 / 1024),
      memoryTotalMb: Math.round(memory.heapTotal / 1024 / 1024),
      activeSocketConnections: connectionCount(),
      version: process.env['npm_package_version'] ?? '1.0.0',
      environment: env.NODE_ENV,
    },
  };
}

async function clinicLeaderboard(window: Window) {
  const rows = await Appointment.aggregate<{
    _id: Types.ObjectId;
    appointments: number;
    revenue: number;
  }>([
    { $match: { slotStart: { $gte: window.from, $lt: window.to } } },
    {
      $group: {
        _id: '$clinic',
        appointments: { $sum: 1 },
        revenue: {
          $sum: {
            $cond: [{ $eq: ['$status', AppointmentStatus.COMPLETED] }, '$feeAmountMinor', 0],
          },
        },
      },
    },
    { $sort: { appointments: -1 } },
    { $limit: 20 },
  ]);

  if (rows.length === 0) return [];

  const clinics = await Clinic.find({ _id: { $in: rows.map((row) => row._id) } })
    .select('name logo address stats')
    .lean();

  const byId = new Map(clinics.map((clinic) => [clinic._id.toString(), clinic]));

  const ratings = await Review.aggregate<{ _id: Types.ObjectId; average: number }>([
    { $match: { clinic: { $in: rows.map((row) => row._id) }, status: 'published' } },
    { $group: { _id: '$clinic', average: { $avg: '$rating' } } },
  ]);

  const ratingById = new Map(ratings.map((row) => [row._id.toString(), row.average]));

  return rows.flatMap((row) => {
    const clinic = byId.get(row._id.toString());
    if (!clinic) return [];

    return [
      {
        clinicId: row._id.toString(),
        name: clinic.name,
        ...(clinic.logo ? { logo: { url: clinic.logo.url, publicId: clinic.logo.publicId } } : {}),
        city: clinic.address.city,
        doctorCount: clinic.stats.doctorCount,
        clientCount: clinic.stats.clientCount,
        appointments: row.appointments,
        revenueMinor: row.revenue,
        averageRating: Math.round((ratingById.get(row._id.toString()) ?? 0) * 100) / 100,
      },
    ];
  });
}

/* -------------------------------------------------------------------------- */
/*                             Shared aggregations                            */
/* -------------------------------------------------------------------------- */

/**
 * `$group` on a field then count the groups.
 *
 * `distinct()` returns every value into memory before counting, which for
 * "how many unique clients this month" on a busy clinic is a large array
 * allocated to produce one integer.
 */
async function distinctCount(
  model: typeof Appointment,
  field: string,
  match: Record<string, unknown>,
): Promise<number> {
  const [row] = await model.aggregate<{ count: number }>([
    { $match: match },
    { $group: { _id: `$${field}` } },
    { $count: 'count' },
  ]);

  return row?.count ?? 0;
}

async function sumRevenue(match: Record<string, unknown>): Promise<number> {
  const [row] = await Appointment.aggregate<{ total: number }>([
    { $match: { ...match, status: AppointmentStatus.COMPLETED } },
    { $group: { _id: null, total: { $sum: '$feeAmountMinor' } } },
  ]);

  return row?.total ?? 0;
}

function bucketFormat(granularity: 'day' | 'month'): string {
  return granularity === 'month' ? '%Y-%m' : '%Y-%m-%d';
}

async function timeSeries(
  base: Record<string, unknown>,
  window: Window,
  label: string,
): Promise<TimeSeries> {
  const rows = await Appointment.aggregate<{ _id: string; value: number }>([
    { $match: { ...base, slotStart: { $gte: window.from, $lt: window.to } } },
    {
      $group: {
        _id: { $dateToString: { format: bucketFormat(window.granularity), date: '$slotStart' } },
        value: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return { label, points: fillGaps(rows, window) };
}

async function revenueTimeSeries(
  base: Record<string, unknown>,
  window: Window,
): Promise<TimeSeries> {
  const rows = await Appointment.aggregate<{ _id: string; value: number }>([
    {
      $match: {
        ...base,
        status: AppointmentStatus.COMPLETED,
        slotStart: { $gte: window.from, $lt: window.to },
      },
    },
    {
      $group: {
        _id: { $dateToString: { format: bucketFormat(window.granularity), date: '$slotStart' } },
        value: { $sum: '$feeAmountMinor' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return {
    label: 'Revenue',
    points: fillGaps(rows, window).map((point) => ({
      ...point,
      value: Math.round(point.value / 100),
    })),
  };
}

async function signupSeries(window: Window): Promise<TimeSeries> {
  const rows = await User.aggregate<{ _id: string; value: number }>([
    { $match: { createdAt: { $gte: window.from, $lt: window.to } } },
    {
      $group: {
        _id: { $dateToString: { format: bucketFormat(window.granularity), date: '$createdAt' } },
        value: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return { label: 'New sign-ups', points: fillGaps(rows, window) };
}

/**
 * Insert zero points for empty buckets.
 *
 * Without this a line chart connects Monday straight to Friday and reads as a
 * smooth trend across days that actually had no activity at all.
 */
function fillGaps(rows: { _id: string; value: number }[], window: Window): TimeSeriesPoint[] {
  const byDate = new Map(rows.map((row) => [row._id, row.value]));
  const points: TimeSeriesPoint[] = [];

  const cursor = new Date(window.from);

  /* Bounded, so a mis-specified window cannot generate an enormous array. */
  for (let step = 0; step < 400 && cursor < window.to; step += 1) {
    const key =
      window.granularity === 'month'
        ? cursor.toISOString().slice(0, 7)
        : cursor.toISOString().slice(0, 10);

    points.push({ date: key, value: byDate.get(key) ?? 0 });

    if (window.granularity === 'month') {
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    } else {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  return points;
}

async function statusDistribution(
  base: Record<string, unknown>,
  window: Window,
): Promise<DistributionSlice[]> {
  const rows = await Appointment.aggregate<{ _id: string; count: number }>([
    { $match: { ...base, slotStart: { $gte: window.from, $lt: window.to } } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  const total = rows.reduce((sum, row) => sum + row.count, 0);

  return rows.map((row) => ({
    key: row._id,
    label: row._id.replace('_', ' '),
    value: row.count,
    percentage: percentage(row.count, total),
  }));
}

async function typeDistribution(
  base: Record<string, unknown>,
  window: Window,
): Promise<DistributionSlice[]> {
  const rows = await Appointment.aggregate<{ _id: string; count: number }>([
    { $match: { ...base, slotStart: { $gte: window.from, $lt: window.to } } },
    { $group: { _id: '$type', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  const total = rows.reduce((sum, row) => sum + row.count, 0);

  return rows.map((row) => ({
    key: row._id,
    label: APPOINTMENT_TYPE_LABELS[row._id as keyof typeof APPOINTMENT_TYPE_LABELS] ?? row._id,
    value: row.count,
    percentage: percentage(row.count, total),
  }));
}

async function speciesDistribution(
  clinicId: Types.ObjectId | null,
): Promise<DistributionSlice[]> {
  const pipeline: PipelineStage[] = [];

  if (clinicId) {
    /* Pets have no clinic, so scope through the appointments this clinic saw. */
    const petIds = await Appointment.distinct('pet', { clinic: clinicId });
    pipeline.push({ $match: { _id: { $in: petIds } } });
  }

  pipeline.push(
    { $group: { _id: '$species', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  );

  const rows = await Pet.aggregate<{ _id: string; count: number }>(pipeline);
  const total = rows.reduce((sum, row) => sum + row.count, 0);

  return rows.map((row) => ({
    key: row._id,
    label: PET_SPECIES_LABELS[row._id as keyof typeof PET_SPECIES_LABELS] ?? row._id,
    value: row.count,
    percentage: percentage(row.count, total),
  }));
}

async function roleDistribution(): Promise<DistributionSlice[]> {
  const rows = await User.aggregate<{ _id: string; count: number }>([
    { $group: { _id: '$role', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  const total = rows.reduce((sum, row) => sum + row.count, 0);

  return rows.map((row) => ({
    key: row._id,
    label: row._id.replace('_', ' '),
    value: row.count,
    percentage: percentage(row.count, total),
  }));
}

/**
 * Bookings per hour of day, as 24 points.
 *
 * Every hour is present even when empty, so the bar chart has a fixed shape
 * and a quiet afternoon reads as quiet rather than as missing data.
 */
async function peakHours(
  base: Record<string, unknown>,
  window: Window,
): Promise<TimeSeriesPoint[]> {
  const rows = await Appointment.aggregate<{ _id: number; count: number }>([
    { $match: { ...base, slotStart: { $gte: window.from, $lt: window.to } } },
    { $group: { _id: { $hour: '$slotStart' }, count: { $sum: 1 } } },
  ]);

  const byHour = new Map(rows.map((row) => [row._id, row.count]));

  return Array.from({ length: 24 }, (_, hour) => ({
    date: `${String(hour).padStart(2, '0')}:00`,
    value: byHour.get(hour) ?? 0,
  }));
}
