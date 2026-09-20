/**
 * Primitives and transport envelopes shared by every endpoint.
 */

/**
 * A Mongo ObjectId, already serialised to its 24-character hex form.
 *
 * The API never leaks a raw `ObjectId` past the service boundary — models are
 * mapped to DTOs before serialisation — so on the wire an id is always a string.
 * The branded shape keeps a `UserId` from being passed where a `PetId` belongs
 * while staying a plain string at runtime (zero cost, no wrappers).
 */
export type Id<TBrand extends string = string> = string & { readonly __brand?: TBrand };

export type UserId = Id<'User'>;
export type PetId = Id<'Pet'>;
export type DoctorId = Id<'Doctor'>;
export type ClinicId = Id<'Clinic'>;
export type AppointmentId = Id<'Appointment'>;
export type MedicalRecordId = Id<'MedicalRecord'>;
export type ReviewId = Id<'Review'>;
export type NotificationId = Id<'Notification'>;

/** An ISO-8601 timestamp in UTC, e.g. `2026-09-20T14:30:00.000Z`. */
export type ISODateString = string;

/** A wall-clock time of day in 24-hour `HH:mm`, interpreted in the clinic's timezone. */
export type TimeString = string;

/** A calendar date with no time component, `YYYY-MM-DD`. */
export type DateOnlyString = string;

/* -------------------------------------------------------------------------- */
/*                              Response envelopes                            */
/* -------------------------------------------------------------------------- */

/**
 * Every successful response has this shape. No exceptions, no bare arrays —
 * a client can always read `body.data` without sniffing the payload first.
 */
export interface ApiSuccess<TData> {
  success: true;
  message: string;
  data: TData;
  /** Echoed request id, for correlating a user's bug report with server logs. */
  requestId: string;
  meta?: Record<string, unknown>;
}

/**
 * Every failed response has this shape.
 *
 * `code` is a stable machine-readable token (`APPOINTMENT_SLOT_TAKEN`) while
 * `message` is human prose that may be reworded freely. Clients branch on
 * `code`; they display `message`. Anything that branches on `message` breaks
 * the moment someone fixes a typo.
 */
export interface ApiFailure {
  success: false;
  message: string;
  code: string;
  requestId: string;
  /** Field-level detail for form validation. Keyed by dotted field path. */
  errors?: FieldError[];
  /** Populated in non-production environments only. */
  stack?: string;
}

export interface FieldError {
  field: string;
  message: string;
  code?: string;
}

export type ApiResult<TData> = ApiSuccess<TData> | ApiFailure;

/* -------------------------------------------------------------------------- */
/*                                 Pagination                                 */
/* -------------------------------------------------------------------------- */

/**
 * Offset pagination — used for admin tables where "page 7 of 40" is meaningful
 * and the dataset is bounded by a clinic.
 */
export interface PageQuery {
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
  search?: string;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface Paginated<TItem> {
  items: TItem[];
  pagination: PaginationMeta;
}

/**
 * Cursor pagination — used for feeds that grow at the head (notifications,
 * activity, audit log). Offset paging double-serves and skips rows when new
 * items land mid-scroll; a cursor is stable against concurrent writes.
 */
export interface CursorQuery {
  cursor?: string | null;
  limit?: number;
}

export interface CursorPaginated<TItem> {
  items: TItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

/* -------------------------------------------------------------------------- */
/*                                   Media                                    */
/* -------------------------------------------------------------------------- */

/**
 * An uploaded asset.
 *
 * `publicId` is the storage provider's handle, retained so the asset can be
 * deleted or re-transformed later. Storing only the URL is how orphaned files
 * accumulate until the storage bill becomes a meeting.
 */
export interface MediaAsset {
  url: string;
  publicId: string;
  /** Low-resolution placeholder used for blur-up loading. */
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  format?: string;
  bytes?: number;
  uploadedAt?: ISODateString;
}

/* -------------------------------------------------------------------------- */
/*                               Value objects                                */
/* -------------------------------------------------------------------------- */

export interface Address {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

/** GeoJSON Point, ordered `[longitude, latitude]` as the spec requires. */
export interface GeoPoint {
  type: 'Point';
  coordinates: [number, number];
}

export interface PhoneNumber {
  /** E.164, e.g. `+919876543210`. */
  e164: string;
  verified: boolean;
}

/** Money in minor units — never a float. `4999` INR is ₹49.99. */
export interface Money {
  amountMinor: number;
  currency: string;
}

/** A half-open interval `[start, end)`. Half-open makes adjacent slots not overlap. */
export interface TimeRange {
  start: ISODateString;
  end: ISODateString;
}

export interface Timestamps {
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
