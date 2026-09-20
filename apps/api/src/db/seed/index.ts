/**
 * Development seed.
 *
 * Creates a coherent, realistic dataset: a clinic, a super admin, an admin,
 * three doctors with different specialities and availability, several clients
 * with pets, and a spread of appointments across past, present and future so
 * every dashboard and every list view has something meaningful in it.
 *
 * Two rules the previous implementation broke:
 *
 *   • **It does not run on boot.** The old server seeded on every start, which
 *     meant production would have re-created demo data on each deploy. This is
 *     an explicit `npm run seed`.
 *
 *   • **It refuses to run against production.** Guarded on `NODE_ENV`, because
 *     the first thing it does is delete everything.
 */

import mongoose from 'mongoose';
import {
  AppointmentStatus,
  AppointmentType,
  PetSpecies,
  PetSex,
  Role,
  UserStatus,
  VaccinationStatus,
  zonedTimeToUtc,
  formatDateOnly,
  type DayOfWeek,
} from '@pawsitive/shared';
import { connectDatabase, disconnectDatabase } from '../../config/database.js';
import { env, isProd } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import {
  Appointment,
  Clinic,
  Doctor,
  MedicalRecord,
  Notification,
  Pet,
  RefreshToken,
  Review,
  User,
  Vaccination,
} from '../../models/index.js';
import { hashPassword } from '../../utils/crypto.js';

const log = logger.child({ module: 'seed' });

/** Everyone gets the same password locally. Never used outside development. */
const DEMO_PASSWORD = 'Pawsitive123!';
const TIMEZONE = 'Asia/Kolkata';

async function seed(): Promise<void> {
  if (isProd) {
    log.fatal('Refusing to seed a production database.');
    process.exit(1);
  }

  await connectDatabase();

  log.info('Clearing existing data…');
  await Promise.all([
    User.deleteMany({}),
    Clinic.deleteMany({}),
    Doctor.deleteMany({}),
    Pet.deleteMany({}),
    Appointment.deleteMany({}),
    MedicalRecord.deleteMany({}),
    Vaccination.deleteMany({}),
    Review.deleteMany({}),
    Notification.deleteMany({}),
    RefreshToken.deleteMany({}),
  ]);

  /* Hash once and reuse — scrypt is deliberately slow, and hashing it a dozen
     times would make the seed take ten seconds for no benefit. */
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  /* ---------------------------------------------------------------- clinic */
  const clinic = await Clinic.create({
    name: 'Pawsitive Care Centre',
    slug: 'pawsitive-care-centre',
    description:
      'A full-service veterinary hospital with in-house diagnostics, surgery and 24-hour emergency care.',
    email: 'hello@pawsitive.test',
    phone: '+919876500000',
    address: {
      line1: '14 Banjara Hills Road',
      city: 'Hyderabad',
      state: 'Telangana',
      postalCode: '500034',
      country: 'India',
    },
    timezone: TIMEZONE,
    currency: 'INR',
  });

  /* ----------------------------------------------------------------- staff */
  const superAdmin = await User.create({
    firstName: 'Riya',
    lastName: 'Kapoor',
    email: 'super@pawsitive.test',
    passwordHash,
    role: Role.SUPER_ADMIN,
    status: UserStatus.ACTIVE,
    emailVerified: true,
    timezone: TIMEZONE,
  });

  const admin = await User.create({
    firstName: 'Arjun',
    lastName: 'Mehta',
    email: 'admin@pawsitive.test',
    passwordHash,
    role: Role.ADMIN,
    clinic: clinic._id,
    status: UserStatus.ACTIVE,
    emailVerified: true,
    timezone: TIMEZONE,
  });

  /* --------------------------------------------------------------- doctors */
  const doctorSpecs = [
    {
      firstName: 'Neha',
      lastName: 'Sharma',
      email: 'neha@pawsitive.test',
      title: 'Senior Veterinarian',
      bio: 'Fifteen years in small-animal internal medicine, with a particular interest in feline endocrinology.',
      specializations: ['Internal Medicine', 'General Practice', 'Cardiology'],
      licenseNumber: 'VET-TS-10241',
      yearsOfExperience: 15,
      feeMinor: 120_000,
      /* Mon–Fri, split shift. */
      weekly: workweek([
        { start: '09:00', end: '13:00' },
        { start: '14:00', end: '17:30' },
      ]),
      slotMinutes: 30 as const,
    },
    {
      firstName: 'Vikram',
      lastName: 'Rao',
      email: 'vikram@pawsitive.test',
      title: 'Veterinary Surgeon',
      bio: 'Orthopaedic and soft-tissue surgery. Fellowship-trained in minimally invasive technique.',
      specializations: ['Surgery', 'Orthopaedics', 'Emergency & Critical Care'],
      licenseNumber: 'VET-TS-20887',
      yearsOfExperience: 11,
      feeMinor: 180_000,
      /* Surgery days: longer slots, fewer of them. */
      weekly: [
        { dayOfWeek: 1 as DayOfWeek, blocks: [{ start: '08:00', end: '12:00' }] },
        { dayOfWeek: 3 as DayOfWeek, blocks: [{ start: '08:00', end: '12:00' }] },
        { dayOfWeek: 5 as DayOfWeek, blocks: [{ start: '08:00', end: '12:00' }] },
      ],
      slotMinutes: 60 as const,
    },
    {
      firstName: 'Ananya',
      lastName: 'Iyer',
      email: 'ananya@pawsitive.test',
      title: 'Veterinarian',
      bio: 'Dermatology, nutrition and preventative care. Works extensively with exotic pets.',
      specializations: ['Dermatology', 'Nutrition', 'Exotic Animals'],
      licenseNumber: 'VET-TS-31552',
      yearsOfExperience: 6,
      feeMinor: 90_000,
      /* Includes Saturday — weekend cover. */
      weekly: [
        ...workweek([{ start: '10:00', end: '16:00' }]).filter((day) => day.dayOfWeek !== 3),
        { dayOfWeek: 6 as DayOfWeek, blocks: [{ start: '10:00', end: '14:00' }] },
      ],
      slotMinutes: 20 as const,
    },
  ];

  const doctors = [];

  for (const spec of doctorSpecs) {
    const user = await User.create({
      firstName: spec.firstName,
      lastName: spec.lastName,
      email: spec.email,
      passwordHash,
      role: Role.DOCTOR,
      clinic: clinic._id,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      timezone: TIMEZONE,
    });

    const doctor = await Doctor.create({
      user: user._id,
      clinic: clinic._id,
      title: spec.title,
      bio: spec.bio,
      specializations: spec.specializations,
      qualifications: [
        { degree: 'BVSc & AH', institution: 'College of Veterinary Science', year: 2010 },
      ],
      licenseNumber: spec.licenseNumber,
      yearsOfExperience: spec.yearsOfExperience,
      languages: ['English', 'Hindi', 'Telugu'],
      consultationFeeMinor: spec.feeMinor,
      currency: 'INR',
      availability: {
        timezone: TIMEZONE,
        slotDurationMinutes: spec.slotMinutes,
        bufferMinutes: 0,
        advanceBookingDays: 60,
        minimumNoticeMinutes: 60,
        weekly: spec.weekly,
        overrides: [],
      },
    });

    doctors.push({ doctor, user });
  }

  await Clinic.updateOne(
    { _id: clinic._id },
    { $set: { 'stats.doctorCount': doctors.length } },
  );

  /* --------------------------------------------------------------- clients */
  const clientSpecs = [
    { firstName: 'Priya', lastName: 'Nair', email: 'priya@pawsitive.test' },
    { firstName: 'Rahul', lastName: 'Desai', email: 'rahul@pawsitive.test' },
    { firstName: 'Sana', lastName: 'Qureshi', email: 'sana@pawsitive.test' },
  ];

  const clients = [];
  for (const spec of clientSpecs) {
    clients.push(
      await User.create({
        ...spec,
        passwordHash,
        role: Role.CLIENT,
        status: UserStatus.ACTIVE,
        emailVerified: true,
        timezone: TIMEZONE,
      }),
    );
  }

  await Clinic.updateOne({ _id: clinic._id }, { $set: { 'stats.clientCount': clients.length } });

  /* ------------------------------------------------------------------ pets */
  const petSpecs = [
    { owner: 0, name: 'Bruno', species: PetSpecies.DOG, breed: 'Labrador Retriever', sex: PetSex.MALE, months: 38, weightKg: 29.4, isNeutered: true },
    { owner: 0, name: 'Misty', species: PetSpecies.CAT, breed: 'Persian', sex: PetSex.FEMALE, months: 19, weightKg: 4.1, allergies: ['Chicken'] },
    { owner: 1, name: 'Rocky', species: PetSpecies.DOG, breed: 'German Shepherd', sex: PetSex.MALE, months: 74, weightKg: 34.8, chronicConditions: ['Hip dysplasia'] },
    { owner: 1, name: 'Kiwi', species: PetSpecies.BIRD, breed: 'Indian Ringneck', sex: PetSex.UNKNOWN, months: 9, weightKg: 0.12 },
    { owner: 2, name: 'Luna', species: PetSpecies.CAT, breed: 'Domestic Shorthair', sex: PetSex.FEMALE, months: 6, weightKg: 2.3 },
    { owner: 2, name: 'Thumper', species: PetSpecies.RABBIT, breed: 'Holland Lop', sex: PetSex.MALE, months: 14, weightKg: 1.6, isNeutered: true },
  ];

  const pets = [];
  for (const spec of petSpecs) {
    const owner = clients[spec.owner];
    if (!owner) continue;

    const dob = new Date();
    dob.setMonth(dob.getMonth() - spec.months);

    pets.push(
      await Pet.create({
        owner: owner._id,
        name: spec.name,
        species: spec.species,
        breed: spec.breed,
        sex: spec.sex,
        dateOfBirth: dob,
        weightKg: spec.weightKg,
        isNeutered: spec.isNeutered ?? false,
        allergies: spec.allergies ?? [],
        chronicConditions: spec.chronicConditions ?? [],
      }),
    );
  }

  /* ---------------------------------------------------------- appointments */
  /**
   * Built by walking each doctor's real slot grid rather than inventing times,
   * so every seeded appointment sits exactly where the booking rules would put
   * it — and the availability endpoint correctly shows those slots as taken.
   */
  const appointments = [];
  const today = new Date();

  const plan = [
    { doctor: 0, pet: 0, dayOffset: -21, slot: 0, status: AppointmentStatus.COMPLETED, type: AppointmentType.VACCINATION },
    { doctor: 0, pet: 2, dayOffset: -14, slot: 2, status: AppointmentStatus.COMPLETED, type: AppointmentType.CONSULTATION },
    { doctor: 2, pet: 4, dayOffset: -10, slot: 1, status: AppointmentStatus.COMPLETED, type: AppointmentType.CONSULTATION },
    { doctor: 1, pet: 2, dayOffset: -7, slot: 0, status: AppointmentStatus.COMPLETED, type: AppointmentType.SURGERY },
    { doctor: 0, pet: 1, dayOffset: -3, slot: 4, status: AppointmentStatus.NO_SHOW, type: AppointmentType.FOLLOW_UP },
    { doctor: 0, pet: 0, dayOffset: 2, slot: 1, status: AppointmentStatus.CONFIRMED, type: AppointmentType.FOLLOW_UP },
    { doctor: 2, pet: 5, dayOffset: 3, slot: 3, status: AppointmentStatus.CONFIRMED, type: AppointmentType.DENTAL },
    { doctor: 0, pet: 4, dayOffset: 4, slot: 6, status: AppointmentStatus.PENDING, type: AppointmentType.VACCINATION },
    { doctor: 1, pet: 2, dayOffset: 7, slot: 1, status: AppointmentStatus.PENDING, type: AppointmentType.DIAGNOSTIC },
    { doctor: 2, pet: 3, dayOffset: 9, slot: 2, status: AppointmentStatus.CONFIRMED, type: AppointmentType.CONSULTATION },
  ];

  for (const entry of plan) {
    const doctorEntry = doctors[entry.doctor];
    const pet = pets[entry.pet];
    if (!doctorEntry || !pet) continue;

    const slotStart = findWorkingSlot(doctorEntry.doctor, today, entry.dayOffset, entry.slot);
    if (!slotStart) {
      log.warn(
        { doctor: doctorEntry.user.email, dayOffset: entry.dayOffset },
        'No working day found near this offset — skipping',
      );
      continue;
    }

    const created = await Appointment.create({
      client: pet.owner,
      pet: pet._id,
      doctor: doctorEntry.doctor._id,
      clinic: clinic._id,
      slotStart,
      durationMinutes: doctorEntry.doctor.availability.slotDurationMinutes,
      type: entry.type,
      reason: reasonFor(entry.type),
      status: entry.status,
      feeAmountMinor: doctorEntry.doctor.consultationFeeMinor,
      feeCurrency: 'INR',
      createdBy: pet.owner,
      ...(entry.status === AppointmentStatus.COMPLETED
        ? { confirmedAt: slotStart, startedAt: slotStart, completedAt: slotStart }
        : {}),
      ...(entry.status === AppointmentStatus.CONFIRMED ? { confirmedAt: new Date() } : {}),
    }).catch((error: unknown) => {
      /* A slot collision here means the plan double-booked a doctor; skip it
         rather than aborting the whole seed. */
      log.warn({ err: error }, 'Skipped a seeded appointment that collided');
      return null;
    });

    if (created) appointments.push({ appointment: created, pet, doctorEntry });
  }

  /* ------------------------------------------------- records & vaccinations */
  for (const entry of appointments) {
    if (entry.appointment.status !== AppointmentStatus.COMPLETED) continue;

    const record = await MedicalRecord.create({
      pet: entry.pet._id,
      doctor: entry.doctorEntry.doctor._id,
      clinic: clinic._id,
      appointment: entry.appointment._id,
      type: entry.appointment.type === AppointmentType.VACCINATION ? 'vaccination' : 'consultation',
      visitDate: entry.appointment.slotStart,
      chiefComplaint: 'Routine presentation, owner reports normal appetite and activity.',
      diagnosis: 'No significant abnormalities detected on physical examination.',
      treatment: 'Preventative care administered. Advised to continue current diet.',
      vitals: {
        weightKg: entry.pet.weightKg ?? 10,
        temperatureCelsius: 38.4,
        heartRateBpm: 96,
        respiratoryRateBpm: 22,
        bodyConditionScore: 5,
      },
      prescriptions:
        entry.appointment.type === AppointmentType.SURGERY
          ? [
              {
                medication: 'Meloxicam',
                dosage: '0.1 mg/kg',
                frequency: 'Once daily',
                durationDays: 5,
                route: 'Oral',
                instructions: 'Give with food.',
              },
            ]
          : [],
      followUpRequired: entry.appointment.type === AppointmentType.SURGERY,
      ...(entry.appointment.type === AppointmentType.SURGERY
        ? { followUpDate: addDays(entry.appointment.slotStart, 14) }
        : {}),
    });

    await Appointment.updateOne(
      { _id: entry.appointment._id },
      { $set: { hasMedicalRecord: true } },
    );

    if (entry.appointment.type === AppointmentType.VACCINATION) {
      await Vaccination.create({
        pet: entry.pet._id,
        doctor: entry.doctorEntry.doctor._id,
        clinic: clinic._id,
        medicalRecord: record._id,
        vaccineName: entry.pet.species === PetSpecies.DOG ? 'DHPP' : 'FVRCP',
        manufacturer: 'Zoetis',
        batchNumber: 'B-449102',
        doseNumber: 2,
        totalDoses: 3,
        status: VaccinationStatus.ADMINISTERED,
        administeredAt: entry.appointment.slotStart,
        dueAt: addDays(entry.appointment.slotStart, 365),
      });
    }
  }

  /* A couple of upcoming and overdue doses, so the reminder widgets have data. */
  const bruno = pets[0];
  const luna = pets[4];

  if (bruno) {
    await Vaccination.create({
      pet: bruno._id,
      clinic: clinic._id,
      vaccineName: 'Rabies',
      doseNumber: 1,
      status: VaccinationStatus.SCHEDULED,
      dueAt: addDays(new Date(), 12),
    });
  }

  if (luna) {
    await Vaccination.create({
      pet: luna._id,
      clinic: clinic._id,
      vaccineName: 'FeLV',
      doseNumber: 1,
      status: VaccinationStatus.OVERDUE,
      dueAt: addDays(new Date(), -9),
    });
  }

  /* --------------------------------------------------------------- reviews */
  const completed = appointments.filter(
    (entry) => entry.appointment.status === AppointmentStatus.COMPLETED,
  );

  const reviewTexts = [
    { rating: 5, title: 'Genuinely kind with a nervous dog', comment: 'Bruno hates the vet and somehow left wagging. Everything was explained clearly and we never felt rushed.' },
    { rating: 5, title: 'Thorough and reassuring', comment: 'Picked up something our last clinic missed entirely. The follow-up call the next day was a lovely touch.' },
    { rating: 4, title: 'Great care, slight wait', comment: 'Ran about twenty minutes behind, but the consultation itself was excellent and clearly not rushed.' },
    { rating: 5, title: 'Would not go anywhere else', comment: 'Rocky came through surgery beautifully. The aftercare instructions were detailed and easy to follow.' },
  ];

  for (const [index, entry] of completed.entries()) {
    const text = reviewTexts[index % reviewTexts.length];
    if (!text) continue;

    await Review.create({
      doctor: entry.doctorEntry.doctor._id,
      client: entry.pet.owner,
      clinic: clinic._id,
      appointment: entry.appointment._id,
      rating: text.rating,
      title: text.title,
      comment: text.comment,
      breakdown: {
        expertise: text.rating,
        communication: text.rating,
        punctuality: Math.max(3, text.rating - 1),
        facilities: text.rating,
      },
      isVerified: true,
    });

    await Appointment.updateOne({ _id: entry.appointment._id }, { $set: { hasReview: true } });

    /* Keep the running aggregate consistent, exactly as the review service
       would — otherwise seeded doctors show a rating of zero. */
    await Doctor.updateOne(
      { _id: entry.doctorEntry.doctor._id },
      {
        $inc: {
          ratingSum: text.rating,
          ratingCount: 1,
          [`ratingDistribution.${text.rating}`]: 1,
        },
      },
    );
  }

  /* `ratingAverage` is derived in a pre-save hook, which `updateOne` bypasses,
     so recompute it once here. */
  for (const entry of doctors) {
    const fresh = await Doctor.findById(entry.doctor._id);
    if (!fresh) continue;
    fresh.ratingAverage =
      fresh.ratingCount > 0
        ? Math.round((fresh.ratingSum / fresh.ratingCount) * 100) / 100
        : 0;
    await fresh.save();
  }

  await Clinic.updateOne(
    { _id: clinic._id },
    { $set: { 'stats.appointmentCount': appointments.length } },
  );

  /* ---------------------------------------------------------------- report */
  log.info(
    {
      clinics: 1,
      users: 2 + doctors.length + clients.length,
      doctors: doctors.length,
      clients: clients.length,
      pets: pets.length,
      appointments: appointments.length,
    },
    'Seed complete',
  );

  /* eslint-disable no-console -- this is a CLI script; the table is the point. */
  console.log(`
╭──────────────────────────────────────────────────────────────╮
│  Pawsitive — development data ready                          │
╰──────────────────────────────────────────────────────────────╯

  Every account uses the password:  ${DEMO_PASSWORD}

  super admin   ${superAdmin.email}
  clinic admin  ${admin.email}
  doctor        ${doctors[0]?.user.email ?? '—'}   (${doctorSpecs[0]?.title ?? ''})
  doctor        ${doctors[1]?.user.email ?? '—'}   (${doctorSpecs[1]?.title ?? ''})
  doctor        ${doctors[2]?.user.email ?? '—'}   (${doctorSpecs[2]?.title ?? ''})
  client        ${clients[0]?.email ?? '—'}    (2 pets)
  client        ${clients[1]?.email ?? '—'}    (2 pets)
  client        ${clients[2]?.email ?? '—'}     (2 pets)

  ${pets.length} pets · ${appointments.length} appointments · ${completed.length} with records & reviews
`);
  /* eslint-enable no-console */

  await disconnectDatabase();
}

/* -------------------------------------------------------------------------- */
/*                                  Helpers                                   */
/* -------------------------------------------------------------------------- */

function workweek(blocks: { start: string; end: string }[]) {
  return ([1, 2, 3, 4, 5] as DayOfWeek[]).map((dayOfWeek) => ({ dayOfWeek, blocks }));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/**
 * Find a real slot near a target offset, searching outward for a working day.
 *
 * A fixed offset like "-21 days" lands on whatever weekday that happens to be,
 * so running the seed on a Sunday silently dropped half the plan — every
 * offset that fell on a weekend produced no slot. Walking *away* from today
 * until a working day turns up makes the seeded dataset identical in shape
 * regardless of when it is run, which is what makes the dashboards worth
 * looking at.
 *
 * Past offsets search further into the past and future ones further into the
 * future, so a "completed" appointment never accidentally lands in the future.
 */
function findWorkingSlot(
  doctor: Parameters<typeof nthSlotOnDay>[0],
  today: Date,
  dayOffset: number,
  slotIndex: number,
): Date | null {
  const direction = dayOffset < 0 ? -1 : 1;

  for (let step = 0; step < 14; step += 1) {
    const target = new Date(today);
    target.setDate(target.getDate() + dayOffset + step * direction);

    const slot = nthSlotOnDay(doctor, target, slotIndex);
    if (slot) return slot;
  }

  return null;
}

/**
 * The nth bookable slot on a given day, or null if the doctor does not work
 * then. Generating from the real rules keeps seeded appointments aligned to the
 * grid, so the availability endpoint reports them as taken.
 */
function nthSlotOnDay(
  doctor: { availability: { timezone: string; slotDurationMinutes: number; bufferMinutes: number; weekly: { dayOfWeek: DayOfWeek; blocks: { start: string; end: string }[] }[] } },
  day: Date,
  index: number,
): Date | null {
  const availability = doctor.availability;
  const dateOnly = formatDateOnly(day, availability.timezone);

  const noon = zonedTimeToUtc(dateOnly, '12:00', availability.timezone);
  const weekday = new Date(noon.getTime()).getUTCDay() as DayOfWeek;

  const rule = availability.weekly.find((entry) => entry.dayOfWeek === weekday);
  if (!rule || rule.blocks.length === 0) return null;

  const stride = availability.slotDurationMinutes + availability.bufferMinutes;
  const starts: Date[] = [];

  for (const block of rule.blocks) {
    const [bh = '0', bm = '0'] = block.start.split(':');
    const [eh = '0', em = '0'] = block.end.split(':');
    const blockStart = Number(bh) * 60 + Number(bm);
    const blockEnd = Number(eh) * 60 + Number(em);

    for (
      let minute = blockStart;
      minute + availability.slotDurationMinutes <= blockEnd;
      minute += stride
    ) {
      const hh = String(Math.floor(minute / 60)).padStart(2, '0');
      const mm = String(minute % 60).padStart(2, '0');
      starts.push(zonedTimeToUtc(dateOnly, `${hh}:${mm}`, availability.timezone));
    }
  }

  if (starts.length === 0) return null;

  /* Wrap rather than collapsing to the first slot. Falling back to index 0
     made two plan entries on the same day pick the same time, which the slot
     index then correctly rejected — losing a seeded appointment to a
     "collision" that was really a bug in the seed. */
  return starts[index % starts.length] ?? null;
}

function reasonFor(type: string): string {
  const reasons: Record<string, string> = {
    consultation: 'General check-up and wellness examination',
    vaccination: 'Annual booster vaccination',
    follow_up: 'Follow-up after previous treatment',
    dental: 'Dental scaling and oral examination',
    surgery: 'Scheduled orthopaedic procedure',
    grooming: 'Full groom and nail trim',
    diagnostic: 'Radiography and blood panel',
    emergency: 'Acute presentation, urgent assessment',
  };

  return reasons[type] ?? 'Veterinary consultation';
}

seed()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    log.fatal({ err: error }, 'Seed failed');
    void mongoose.disconnect().finally(() => process.exit(1));
  });

export { env };
