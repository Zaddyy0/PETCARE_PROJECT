import type { AppointmentStatus, AppointmentType, PetSpecies } from '../enums.js';
import type { ClinicId, DoctorId, ISODateString, MediaAsset } from './common.js';

/**
 * Analytics shapes.
 *
 * Three dashboards, three payloads, one query parameter set. Each role gets the
 * widest scope its permissions allow (`analytics:read:own` → their own numbers,
 * `:clinic` → the clinic's, `:global` → the platform's) and the server picks the
 * shape — the client never asks for a scope it might not have.
 */

export type AnalyticsPeriod = '7d' | '30d' | '90d' | '12m' | 'custom';

export interface AnalyticsQuery {
  period?: AnalyticsPeriod;
  from?: ISODateString;
  to?: ISODateString;
  clinicId?: ClinicId;
  doctorId?: DoctorId;
}

/** A single number with its movement against the preceding equal-length window. */
export interface MetricValue {
  value: number;
  previousValue: number;
  /** Percentage change. `null` when the previous window was zero — not `Infinity`. */
  changePercent: number | null;
  trend: 'up' | 'down' | 'flat';
}

export interface TimeSeriesPoint {
  /** Bucket start, `YYYY-MM-DD` for daily and `YYYY-MM` for monthly. */
  date: string;
  value: number;
}

export interface TimeSeries {
  label: string;
  points: TimeSeriesPoint[];
}

export interface DistributionSlice {
  label: string;
  key: string;
  value: number;
  percentage: number;
}

/* -------------------------------------------------------------------------- */
/*                              Client dashboard                              */
/* -------------------------------------------------------------------------- */

export interface ClientDashboard {
  petCount: number;
  upcomingAppointments: number;
  completedVisits: number;
  overdueVaccinations: number;
  nextAppointment: {
    id: string;
    slotStart: ISODateString;
    petName: string;
    doctorName: string;
    type: AppointmentType;
  } | null;
  spendByMonth: TimeSeries;
  visitsByPet: DistributionSlice[];
}

/* -------------------------------------------------------------------------- */
/*                              Doctor dashboard                              */
/* -------------------------------------------------------------------------- */

export interface DoctorDashboard {
  appointmentsToday: number;
  appointmentsThisWeek: MetricValue;
  completionRate: MetricValue;
  noShowRate: MetricValue;
  averageRating: MetricValue;
  totalPatients: MetricValue;
  /** Share of offered slots that were booked. The number a doctor actually cares about. */
  utilizationRate: MetricValue;
  appointmentsOverTime: TimeSeries;
  appointmentsByType: DistributionSlice[];
  ratingDistribution: DistributionSlice[];
  upcomingToday: {
    id: string;
    slotStart: ISODateString;
    petName: string;
    clientName: string;
    type: AppointmentType;
    status: AppointmentStatus;
  }[];
}

/* -------------------------------------------------------------------------- */
/*                         Admin dashboard (per clinic)                       */
/* -------------------------------------------------------------------------- */

export interface AdminDashboard {
  totalAppointments: MetricValue;
  totalRevenue: MetricValue;
  activeClients: MetricValue;
  activeDoctors: number;
  averageRating: MetricValue;
  cancellationRate: MetricValue;
  noShowRate: MetricValue;
  appointmentsOverTime: TimeSeries;
  revenueOverTime: TimeSeries;
  appointmentsByStatus: DistributionSlice[];
  appointmentsByType: DistributionSlice[];
  petsBySpecies: DistributionSlice[];
  /** Busiest hours, for staffing decisions. 24 entries, one per hour. */
  peakHours: TimeSeriesPoint[];
  doctorLeaderboard: DoctorPerformanceRow[];
}

export interface DoctorPerformanceRow {
  doctorId: DoctorId;
  fullName: string;
  avatar?: MediaAsset;
  specializations: string[];
  appointments: number;
  completionRate: number;
  averageRating: number;
  reviewCount: number;
  revenueMinor: number;
  utilizationRate: number;
}

/* -------------------------------------------------------------------------- */
/*                       Super admin dashboard (platform)                     */
/* -------------------------------------------------------------------------- */

export interface SuperAdminDashboard {
  totalClinics: number;
  totalUsers: MetricValue;
  totalDoctors: MetricValue;
  totalPets: MetricValue;
  totalAppointments: MetricValue;
  platformRevenue: MetricValue;
  newSignupsOverTime: TimeSeries;
  appointmentsOverTime: TimeSeries;
  usersByRole: DistributionSlice[];
  petsBySpecies: DistributionSlice[];
  clinicLeaderboard: ClinicPerformanceRow[];
  systemHealth: SystemHealth;
}

export interface ClinicPerformanceRow {
  clinicId: ClinicId;
  name: string;
  logo?: MediaAsset;
  city: string;
  doctorCount: number;
  clientCount: number;
  appointments: number;
  revenueMinor: number;
  averageRating: number;
}

export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'down';
  uptimeSeconds: number;
  databaseStatus: 'connected' | 'disconnected' | 'connecting';
  databaseLatencyMs: number | null;
  memoryUsedMb: number;
  memoryTotalMb: number;
  activeSocketConnections: number;
  version: string;
  environment: string;
}

/** Discriminated union so one endpoint can serve all four roles type-safely. */
export type RoleDashboard =
  | { scope: 'client'; data: ClientDashboard }
  | { scope: 'doctor'; data: DoctorDashboard }
  | { scope: 'clinic'; data: AdminDashboard }
  | { scope: 'platform'; data: SuperAdminDashboard };

export interface SpeciesBreakdown {
  species: PetSpecies;
  count: number;
}
