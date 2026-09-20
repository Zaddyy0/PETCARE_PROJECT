import type { Types } from 'mongoose';
import { fullName, type Doctor as DoctorDTO, type DoctorAvailability } from '@pawsitive/shared';
import type { IDoctor } from '../models/doctor.model.js';
import type { IUser } from '../models/user.model.js';

type DoctorLike = IDoctor & { _id: Types.ObjectId };
type UserLike = Pick<IUser, 'firstName' | 'lastName' | 'email'> &
  Partial<Pick<IUser, 'avatar'>> & { _id: Types.ObjectId };

/**
 * A doctor profile joined with their user account.
 *
 * The two live in separate collections — see `doctor.model.ts` for why — so
 * every caller needs both. Taking them as separate arguments makes that
 * requirement explicit rather than depending on a `populate()` having happened
 * somewhere up the call chain.
 */
export function toDoctorDTO(doctor: DoctorLike, user: UserLike): DoctorDTO {
  const dto: DoctorDTO = {
    id: doctor._id.toString(),
    userId: user._id.toString(),
    clinicId: doctor.clinic.toString(),
    firstName: user.firstName,
    lastName: user.lastName,
    fullName: fullName(user.firstName, user.lastName),
    email: user.email,
    title: doctor.title,
    bio: doctor.bio,
    specializations: [...doctor.specializations],
    qualifications: doctor.qualifications.map((q) => ({ ...q })),
    licenseNumber: doctor.licenseNumber,
    yearsOfExperience: doctor.yearsOfExperience,
    languages: [...doctor.languages],
    consultationFee: {
      amountMinor: doctor.consultationFeeMinor,
      currency: doctor.currency,
    },
    availability: toAvailabilityDTO(doctor.availability),
    rating: {
      average: doctor.ratingAverage,
      count: doctor.ratingCount,
      sum: doctor.ratingSum,
      distribution: {
        1: doctor.ratingDistribution[1],
        2: doctor.ratingDistribution[2],
        3: doctor.ratingDistribution[3],
        4: doctor.ratingDistribution[4],
        5: doctor.ratingDistribution[5],
      },
    },
    isAcceptingPatients: doctor.isAcceptingPatients,
    isActive: doctor.isActive,
    createdAt: doctor.createdAt.toISOString(),
    updatedAt: doctor.updatedAt.toISOString(),
  };

  if (user.avatar) {
    dto.avatar = { url: user.avatar.url, publicId: user.avatar.publicId };
  }

  if (doctor.licenseExpiresAt) {
    dto.licenseExpiresAt = doctor.licenseExpiresAt.toISOString();
  }

  return dto;
}

export function toAvailabilityDTO(availability: IDoctor['availability']): DoctorAvailability {
  return {
    timezone: availability.timezone,
    slotDurationMinutes: availability.slotDurationMinutes,
    bufferMinutes: availability.bufferMinutes,
    advanceBookingDays: availability.advanceBookingDays,
    minimumNoticeMinutes: availability.minimumNoticeMinutes,
    weekly: availability.weekly.map((entry) => ({
      dayOfWeek: entry.dayOfWeek,
      blocks: entry.blocks.map((block) => ({ start: block.start, end: block.end })),
    })),
    overrides: availability.overrides.map((override) => ({
      date: override.date,
      isUnavailable: override.isUnavailable,
      blocks: override.blocks.map((block) => ({ start: block.start, end: block.end })),
      ...(override.reason ? { reason: override.reason } : {}),
    })),
  };
}

/**
 * The public view of a doctor.
 *
 * Strips the licence number and the raw availability rules. A licence number is
 * a regulated identifier that has no business being on a public booking page,
 * and the rules are an implementation detail — clients get generated slots
 * instead, which is what they can actually act on.
 */
export function toPublicDoctorDTO(doctor: DoctorLike, user: UserLike): Omit<
  DoctorDTO,
  'licenseNumber' | 'licenseExpiresAt' | 'availability'
> & { slotDurationMinutes: number } {
  const full = toDoctorDTO(doctor, user);
  const { licenseNumber: _l, licenseExpiresAt: _e, availability, ...rest } = full;

  return { ...rest, slotDurationMinutes: availability.slotDurationMinutes };
}
