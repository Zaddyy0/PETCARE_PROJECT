import { motion } from 'framer-motion';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  APPOINTMENT_TYPES,
  APPOINTMENT_TYPE_LABELS,
  PET_SPECIES_LABELS,
  PetStatus,
  formatMoney,
  type AppointmentType,
} from '@pawsitive/shared';
import { useBookAppointmentMutation } from '@/app/api/appointmentApi';
import { useGetSlotsQuery, useListDoctorsQuery } from '@/app/api/doctorApi';
import { useListPetsQuery } from '@/app/api/petApi';
import { errorCode, errorMessage } from '@/app/api/baseApi';
import { useAppDispatch } from '@/app/hooks';
import { toastSuccess } from '@/app/slices/toastSlice';
import { Avatar, PetAvatar } from '@/design/Avatar';
import { Badge } from '@/design/Badge';
import { Button } from '@/design/Button';
import { Card } from '@/design/Card';
import { EmptyState } from '@/design/EmptyState';
import { Select, Textarea } from '@/design/Field';
import { PageHeader } from '@/design/PageHeader';
import { Skeleton } from '@/design/Skeleton';
import { cn } from '@/lib/cn';
import { fadeUp, staggerContainer, staggerItem } from '@/lib/motion';
import { SlotPicker } from './SlotPicker';

/**
 * The booking flow.
 *
 * Four steps in one scrolling page rather than a wizard. A wizard would hide
 * the doctor's fee and specialisation behind a "next" button at the exact
 * moment the user is choosing between clinicians, and it makes changing an
 * earlier answer feel expensive.
 *
 * Each section unlocks as the previous one is answered, so the page is never
 * a wall of empty inputs — but everything already chosen stays visible and
 * editable.
 */
export default function BookAppointmentPage() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const [searchParams] = useSearchParams();

  /* Deep-linkable: a pet page's "book a visit" button pre-selects the pet, and
     a doctor's profile pre-selects the doctor. */
  const [petId, setPetId] = useState(searchParams.get('petId') ?? '');
  const [doctorId, setDoctorId] = useState(searchParams.get('doctorId') ?? '');
  const [slotStart, setSlotStart] = useState<string | null>(null);
  const [type, setType] = useState<AppointmentType>('consultation');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const { data: pets, isLoading: loadingPets } = useListPetsQuery({
    status: PetStatus.ACTIVE,
    limit: 50,
  });

  const { data: doctors, isLoading: loadingDoctors } = useListDoctorsQuery({
    isAcceptingPatients: true,
    limit: 24,
    sort: 'rating',
  });

  const today = new Date();
  const from = today.toISOString().slice(0, 10);
  const to = new Date(today.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);

  const { data: availability, isFetching: loadingSlots } = useGetSlotsQuery(
    { doctorId, from, to },
    /* No doctor chosen yet means nothing to ask for. */
    { skip: !doctorId },
  );

  const [book, { isLoading: booking }] = useBookAppointmentMutation();

  const selectedPet = pets?.items.find((pet) => pet.id === petId);
  const selectedDoctor = doctors?.items.find((doctor) => doctor.id === doctorId);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);

    if (!petId || !doctorId || !slotStart || reason.trim().length < 3) {
      setFormError('Choose a pet, a vet, a time, and tell us briefly why you are visiting.');
      return;
    }

    try {
      const appointment = await book({
        petId,
        doctorId,
        slotStart,
        type,
        reason: reason.trim(),
        ...(notes.trim() ? { clientNotes: notes.trim() } : {}),
      }).unwrap();

      dispatch(
        toastSuccess(
          'Appointment requested',
          `Reference ${appointment.reference}. The clinic will confirm shortly.`,
        ),
      );

      navigate(`/app/appointments`);
    } catch (error) {
      /**
       * A lost slot race is the expected failure here, not an anomaly.
       *
       * The grid is invalidated by the mutation's tags, so it has already
       * refetched — the user sees their chosen time turn struck-through as the
       * message appears, which explains itself better than the copy does.
       */
      if (errorCode(error) === 'APPOINTMENT_SLOT_TAKEN') {
        setSlotStart(null);
        setFormError('That time was just booked by someone else. Pick another slot below.');
        return;
      }

      setFormError(errorMessage(error));
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Book an appointment"
        description="Pick who is being seen, who is seeing them, and when."
        breadcrumbs={[{ label: 'Appointments', to: '/app/appointments' }, { label: 'Book' }]}
      />

      <form onSubmit={onSubmit} className="space-y-5">
        {/* ---- 1. Pet ---------------------------------------------------- */}
        <Card>
          <StepHeader step={1} title="Who is being seen?" done={Boolean(petId)} />

          {loadingPets && (
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {Array.from({ length: 2 }, (_, index) => (
                <Skeleton key={index} className="h-16 rounded-lg" />
              ))}
            </div>
          )}

          {pets && pets.items.length === 0 && (
            <EmptyState
              compact
              illustration="🐾"
              title="No pets to book for"
              description="Add a pet first and they will appear here."
              action={
                <Button variant="outline" size="sm" onClick={() => navigate('/app/pets/new')}>
                  Add a pet
                </Button>
              }
            />
          )}

          {pets && pets.items.length > 0 && (
            <motion.div
              variants={staggerContainer(0.03)}
              initial="hidden"
              animate="visible"
              role="radiogroup"
              aria-label="Choose a pet"
              className="mt-4 grid gap-2 sm:grid-cols-2"
            >
              {pets.items.map((pet) => {
                const selected = pet.id === petId;

                return (
                  <motion.button
                    key={pet.id}
                    variants={staggerItem}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setPetId(pet.id)}
                    className={cn(
                      'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                      selected
                        ? 'border-primary bg-primary-soft'
                        : 'border-border hover:border-border-strong hover:bg-surface-hover',
                    )}
                  >
                    <PetAvatar photo={pet.photo} name={pet.name} species={pet.species} size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-content">{pet.name}</p>
                      <p className="truncate text-xs text-content-muted">
                        {PET_SPECIES_LABELS[pet.species]} · {pet.ageLabel}
                      </p>
                    </div>
                    {selected && <CheckDot />}
                  </motion.button>
                );
              })}
            </motion.div>
          )}
        </Card>

        {/* ---- 2. Doctor ------------------------------------------------- */}
        <Card className={cn(!petId && 'pointer-events-none opacity-50')}>
          <StepHeader step={2} title="Which vet?" done={Boolean(doctorId)} />

          {loadingDoctors && (
            <div className="mt-4 space-y-2">
              {Array.from({ length: 3 }, (_, index) => (
                <Skeleton key={index} className="h-20 rounded-lg" />
              ))}
            </div>
          )}

          {doctors && (
            <div role="radiogroup" aria-label="Choose a veterinarian" className="mt-4 space-y-2">
              {doctors.items.map((doctor) => {
                const selected = doctor.id === doctorId;

                return (
                  <button
                    key={doctor.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => {
                      setDoctorId(doctor.id);
                      /* A different doctor has a different grid, so the old
                         choice cannot survive. */
                      setSlotStart(null);
                    }}
                    className={cn(
                      'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                      selected
                        ? 'border-primary bg-primary-soft'
                        : 'border-border hover:border-border-strong hover:bg-surface-hover',
                    )}
                  >
                    <Avatar name={doctor.fullName} src={doctor.avatar?.url} size="md" />

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-content">{doctor.fullName}</p>
                        {doctor.rating.count > 0 && (
                          <span className="inline-flex items-center gap-0.5 text-xs tabular-nums text-content-muted">
                            <span aria-hidden>⭐</span>
                            {doctor.rating.average.toFixed(1)}
                            <span className="text-content-subtle">({doctor.rating.count})</span>
                          </span>
                        )}
                      </div>

                      <p className="mt-0.5 truncate text-xs text-content-muted">
                        {doctor.title} · {doctor.yearsOfExperience}y experience
                      </p>

                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {doctor.specializations.slice(0, 3).map((specialization) => (
                          <Badge key={specialization} size="sm" tone="neutral">
                            {specialization}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold tabular-nums text-content">
                        {formatMoney(doctor.consultationFee)}
                      </p>
                      <p className="text-[0.625rem] text-content-subtle">per visit</p>
                      {selected && (
                        <span className="mt-1 inline-block">
                          <CheckDot />
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        {/* ---- 3. Time --------------------------------------------------- */}
        <Card className={cn(!doctorId && 'pointer-events-none opacity-50')}>
          <StepHeader step={3} title="When?" done={Boolean(slotStart)} />

          <div className="mt-4">
            {doctorId ? (
              <SlotPicker
                slots={availability?.slots ?? []}
                timezone={availability?.timezone ?? 'UTC'}
                value={slotStart}
                onChange={setSlotStart}
                loading={loadingSlots}
              />
            ) : (
              <p className="text-sm text-content-subtle">Choose a vet to see their availability.</p>
            )}
          </div>
        </Card>

        {/* ---- 4. Reason ------------------------------------------------- */}
        <Card className={cn(!slotStart && 'pointer-events-none opacity-50')}>
          <StepHeader step={4} title="What is it about?" done={reason.trim().length >= 3} />

          <div className="mt-4 space-y-4">
            <Select
              name="type"
              label="Visit type"
              value={type}
              onChange={(event) => setType(event.target.value as AppointmentType)}
              options={APPOINTMENT_TYPES.map((value) => ({
                value,
                label: APPOINTMENT_TYPE_LABELS[value],
              }))}
            />

            <Textarea
              name="reason"
              label="Reason for the visit"
              required
              rows={2}
              maxLength={200}
              showCount
              placeholder="Limping on the left hind leg since yesterday"
              hint="A short summary. The clinician sees this before the appointment."
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />

            <Textarea
              name="clientNotes"
              label="Anything else? (optional)"
              rows={3}
              maxLength={1000}
              showCount
              placeholder="He is very nervous at the vet and does better with a muzzle on."
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
        </Card>

        {/* ---- Summary and submit ---------------------------------------- */}
        {formError && (
          <div
            role="alert"
            className="rounded-lg border border-danger/25 bg-danger-soft px-3.5 py-3 text-sm text-danger"
          >
            {formError}
          </div>
        )}

        {/* A confirmation summary before committing — the last chance to spot
            that the wrong pet or the wrong day was selected. */}
        {selectedPet && selectedDoctor && slotStart && (
          <motion.div variants={fadeUp} initial="hidden" animate="visible">
            <Card className="border-primary/30 bg-primary-soft/40">
              <h3 className="text-sm font-semibold text-content">Ready to book</h3>

              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <SummaryRow label="Pet" value={selectedPet.name} />
                <SummaryRow label="Vet" value={selectedDoctor.fullName} />
                <SummaryRow
                  label="When"
                  value={new Intl.DateTimeFormat('en', {
                    timeZone: availability?.timezone,
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false,
                  }).format(new Date(slotStart))}
                />
                <SummaryRow label="Fee" value={formatMoney(selectedDoctor.consultationFee)} />
              </dl>
            </Card>
          </motion.div>
        )}

        <div className="flex items-center justify-end gap-3 pb-4">
          <Button type="button" variant="ghost" onClick={() => navigate(-1)} disabled={booking}>
            Cancel
          </Button>
          <Button
            type="submit"
            size="lg"
            loading={booking}
            disabled={!petId || !doctorId || !slotStart || reason.trim().length < 3}
          >
            Request appointment
          </Button>
        </div>
      </form>
    </div>
  );
}

function StepHeader({ step, title, done }: { step: number; title: string; done: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden
        className={cn(
          'grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold transition-colors',
          done ? 'bg-success text-success-fg' : 'bg-surface-sunken text-content-muted',
        )}
      >
        {done ? '✓' : step}
      </span>
      <h2 className="text-base font-semibold text-content">{title}</h2>
    </div>
  );
}

function CheckDot() {
  return (
    <span
      aria-hidden
      className="grid size-5 shrink-0 place-items-center rounded-full bg-primary text-[0.625rem] text-primary-fg"
    >
      ✓
    </span>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-12 shrink-0 text-content-subtle">{label}</dt>
      <dd className="font-medium text-content">{value}</dd>
    </div>
  );
}
