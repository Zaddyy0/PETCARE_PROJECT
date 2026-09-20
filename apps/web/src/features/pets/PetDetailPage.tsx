import { motion } from 'framer-motion';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  APPOINTMENT_TYPE_LABELS,
  PET_SPECIES_LABELS,
  PetStatus,
  VaccinationStatus,
  formatRelative,
  type MedicalRecord,
} from '@pawsitive/shared';
import { useListAppointmentsQuery } from '@/app/api/appointmentApi';
import { useGetPetTimelineQuery, useListVaccinationsQuery } from '@/app/api/medicalApi';
import { useArchivePetMutation, useGetPetQuery, useRestorePetMutation } from '@/app/api/petApi';
import { errorMessage } from '@/app/api/baseApi';
import { useAppDispatch, useCan } from '@/app/hooks';
import { toastSuccess } from '@/app/slices/toastSlice';
import { PetAvatar } from '@/design/Avatar';
import { Badge, StatusBadge } from '@/design/Badge';
import { Button } from '@/design/Button';
import { Card, CardHeader } from '@/design/Card';
import { ConfirmDialog } from '@/design/Modal';
import { EmptyState, ErrorState } from '@/design/EmptyState';
import { PageHeader } from '@/design/PageHeader';
import { LoadingPanel } from '@/design/Spinner';
import { Tabs } from '@/design/Tabs';
import { cn } from '@/lib/cn';
import { fadeUp, staggerContainer, staggerItem } from '@/lib/motion';

type Tab = 'overview' | 'visits' | 'records' | 'vaccinations';

export default function PetDetailPage() {
  const { petId } = useParams<{ petId: string }>();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();

  const canEdit = useCan('pet:update:own') || useCan('pet:update:any');
  const canBook = useCan('appointment:create');

  const [tab, setTab] = useState<Tab>('overview');
  const [confirmArchive, setConfirmArchive] = useState(false);

  const { data: pet, isLoading, error, refetch } = useGetPetQuery(petId as string, {
    skip: !petId,
  });

  const { data: visits } = useListAppointmentsQuery(
    { petId: petId as string, limit: 20, sort: 'slotStart', order: 'desc' },
    { skip: !petId },
  );

  const { data: records } = useGetPetTimelineQuery(petId as string, { skip: !petId });

  const { data: vaccinations } = useListVaccinationsQuery(
    { petId: petId as string, limit: 50 },
    { skip: !petId },
  );

  const [archivePet, { isLoading: archiving }] = useArchivePetMutation();
  const [restorePet, { isLoading: restoring }] = useRestorePetMutation();

  if (isLoading) return <LoadingPanel label="Loading pet" />;

  if (error || !pet) {
    return (
      <ErrorState
        title="We could not load this pet"
        description={errorMessage(error, 'They may have been archived, or the link may be wrong.')}
        onRetry={() => void refetch()}
      />
    );
  }

  const overdueVaccinations =
    vaccinations?.items.filter(
      (dose) => dose.status === VaccinationStatus.OVERDUE || dose.daysUntilDue > 0,
    ) ?? [];

  return (
    <div>
      <PageHeader
        title={pet.name}
        breadcrumbs={[{ label: 'My pets', to: '/app/pets' }, { label: pet.name }]}
        actions={
          <>
            {canBook && pet.status === PetStatus.ACTIVE && (
              <Link
                to={`/app/appointments/new?petId=${pet.id}`}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-fg shadow-sm transition-colors hover:bg-primary-hover"
              >
                <span aria-hidden>📅</span> Book a visit
              </Link>
            )}
            {canEdit && (
              <Link
                to={`/app/pets/${pet.id}/edit`}
                className="inline-flex h-10 items-center rounded-lg border border-border px-4 text-sm font-medium text-content transition-colors hover:bg-surface-hover"
              >
                Edit
              </Link>
            )}
          </>
        }
      />

      {/* ---- Emergency notes, first and loud ----------------------------- */}
      {pet.emergencyNotes && (
        <motion.div variants={fadeUp} initial="hidden" animate="visible" className="mb-5">
          <div
            role="note"
            className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3"
          >
            <span aria-hidden className="text-lg">
              ⚠️
            </span>
            <div>
              <p className="text-sm font-semibold text-content">Before you examine {pet.name}</p>
              <p className="mt-0.5 text-sm text-content-muted text-pretty">{pet.emergencyNotes}</p>
            </div>
          </div>
        </motion.div>
      )}

      {pet.status !== PetStatus.ACTIVE && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-sunken px-4 py-3">
          <p className="text-sm text-content-muted">
            {pet.status === PetStatus.ARCHIVED
              ? `${pet.name} is archived. Their history is kept, but they cannot be booked.`
              : `${pet.name} is remembered here. Their records remain available.`}
          </p>
          {canEdit && pet.status === PetStatus.ARCHIVED && (
            <Button
              size="sm"
              variant="outline"
              loading={restoring}
              onClick={async () => {
                await restorePet(pet.id).unwrap().catch(() => undefined);
                dispatch(toastSuccess(`${pet.name} is active again`));
              }}
            >
              Restore
            </Button>
          )}
        </div>
      )}

      {/* ---- Identity card ----------------------------------------------- */}
      <Card className="mb-5">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <PetAvatar photo={pet.photo} name={pet.name} species={pet.species} size="2xl" />

          <dl className="grid flex-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label="Species" value={PET_SPECIES_LABELS[pet.species]} />
            <Fact label="Breed" value={pet.breed ?? 'Not recorded'} />
            <Fact
              label="Age"
              value={pet.ageLabel}
              hint={pet.isDateOfBirthApproximate ? 'Estimated' : undefined}
            />
            <Fact
              label="Sex"
              value={
                pet.sex === 'unknown'
                  ? 'Not known'
                  : `${pet.sex === 'male' ? 'Male' : 'Female'}${pet.isNeutered ? ' · neutered' : ''}`
              }
            />
            <Fact
              label="Weight"
              value={pet.weightKg ? `${pet.weightKg} kg` : 'Not recorded'}
              hint={pet.weightKg ? 'Updated at each visit' : undefined}
            />
            <Fact label="Colour" value={pet.color ?? 'Not recorded'} />
            <Fact
              label="Microchip"
              value={pet.microchipId ?? 'Not recorded'}
              mono={Boolean(pet.microchipId)}
            />
            <Fact
              label="Insurance"
              value={pet.isInsured ? (pet.insuranceProvider ?? 'Insured') : 'Not insured'}
            />
            <Fact
              label="Last visit"
              value={pet.lastVisitAt ? formatRelative(pet.lastVisitAt) : 'No visits yet'}
            />
          </dl>
        </div>

        {/* Health flags as chips — a vet scanning this card needs allergies to
            be impossible to miss. */}
        {(pet.allergies.length > 0 ||
          pet.chronicConditions.length > 0 ||
          pet.currentMedications.length > 0) && (
          <div className="mt-5 space-y-3 border-t border-border pt-4">
            <ChipRow label="Allergies" items={pet.allergies} tone="danger" />
            <ChipRow label="Ongoing conditions" items={pet.chronicConditions} tone="warning" />
            <ChipRow label="Current medications" items={pet.currentMedications} tone="info" />
          </div>
        )}
      </Card>

      <Tabs
        items={[
          { value: 'overview', label: 'Overview' },
          { value: 'visits', label: 'Visits', badge: visits?.pagination.total },
          { value: 'records', label: 'Records', badge: records?.length },
          {
            value: 'vaccinations',
            label: 'Vaccinations',
            badge: overdueVaccinations.length || undefined,
          },
        ]}
        value={tab}
        onChange={setTab}
        className="mb-5"
      />

      {tab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="Next visit"
              action={
                canBook && (
                  <Link
                    to={`/app/appointments/new?petId=${pet.id}`}
                    className="text-sm font-medium text-primary hover:underline"
                  >
                    Book
                  </Link>
                )
              }
            />
            {pet.nextAppointmentAt ? (
              <p className="mt-3 text-sm text-content">
                {new Date(pet.nextAppointmentAt).toLocaleString(undefined, {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                <span className="ml-2 text-content-subtle">
                  ({formatRelative(pet.nextAppointmentAt)})
                </span>
              </p>
            ) : (
              <EmptyState compact illustration="📅" title="Nothing booked" />
            )}
          </Card>

          <Card>
            <CardHeader title="Vaccinations due" />
            {overdueVaccinations.length === 0 ? (
              <EmptyState compact illustration="✅" title="All up to date" />
            ) : (
              <ul className="mt-3 space-y-2">
                {overdueVaccinations.slice(0, 4).map((dose) => (
                  <li key={dose.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-content">{dose.vaccineName}</span>
                    <Badge tone={dose.daysUntilDue > 0 ? 'danger' : 'warning'} size="sm">
                      {dose.daysUntilDue > 0
                        ? `${dose.daysUntilDue}d overdue`
                        : `due in ${Math.abs(dose.daysUntilDue)}d`}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {tab === 'visits' && (
        <motion.div variants={staggerContainer(0.03)} initial="hidden" animate="visible">
          {visits && visits.items.length > 0 ? (
            <div className="space-y-2">
              {visits.items.map((visit) => (
                <motion.div key={visit.id} variants={staggerItem}>
                  <Card padding="sm" className="flex flex-wrap items-center gap-3">
                    <span className="w-28 shrink-0 text-sm tabular-nums text-content-muted">
                      {new Date(visit.slotStart).toLocaleDateString(undefined, {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-content">
                      {APPOINTMENT_TYPE_LABELS[visit.type]} · {visit.doctor.fullName}
                    </span>
                    <StatusBadge status={visit.status} size="sm" />
                  </Card>
                </motion.div>
              ))}
            </div>
          ) : (
            <EmptyState illustration="📅" title="No visits yet" />
          )}
        </motion.div>
      )}

      {tab === 'records' && <RecordTimeline records={records ?? []} />}

      {tab === 'vaccinations' && (
        <div className="space-y-2">
          {vaccinations && vaccinations.items.length > 0 ? (
            vaccinations.items.map((dose) => (
              <Card key={dose.id} padding="sm" className="flex flex-wrap items-center gap-3">
                <span aria-hidden className="text-lg">
                  💉
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-content">
                    {dose.vaccineName}
                    {dose.totalDoses && (
                      <span className="ml-1.5 text-xs font-normal text-content-subtle">
                        dose {dose.doseNumber} of {dose.totalDoses}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-content-subtle">
                    {dose.administeredAt
                      ? `Given ${new Date(dose.administeredAt).toLocaleDateString()}`
                      : `Due ${new Date(dose.dueAt).toLocaleDateString()}`}
                    {dose.doctorName && ` · ${dose.doctorName}`}
                  </p>
                </div>
                <Badge
                  tone={
                    dose.status === VaccinationStatus.ADMINISTERED
                      ? 'success'
                      : dose.status === VaccinationStatus.OVERDUE
                        ? 'danger'
                        : dose.status === VaccinationStatus.SKIPPED
                          ? 'neutral'
                          : 'info'
                  }
                  size="sm"
                >
                  {dose.status}
                </Badge>
              </Card>
            ))
          ) : (
            <EmptyState
              illustration="💉"
              title="No vaccinations recorded"
              description="Your vet will add these as they are given."
            />
          )}
        </div>
      )}

      {/* ---- Archive ----------------------------------------------------- */}
      {canEdit && pet.status === PetStatus.ACTIVE && (
        <div className="mt-8 border-t border-border pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-content">Archive {pet.name}</p>
              <p className="mt-0.5 text-xs text-content-muted text-pretty">
                Hides them from your list and stops reminders. Their medical history is kept.
              </p>
            </div>
            <Button variant="outline" onClick={() => setConfirmArchive(true)}>
              Archive
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmArchive}
        onClose={() => setConfirmArchive(false)}
        onConfirm={async () => {
          try {
            await archivePet({ id: pet.id }).unwrap();
            dispatch(toastSuccess(`${pet.name} has been archived`));
            setConfirmArchive(false);
            navigate('/app/pets');
          } catch {
            setConfirmArchive(false);
          }
        }}
        title={`Archive ${pet.name}?`}
        message="Their medical history and past visits are kept, and you can restore them at any time. Any upcoming appointments must be cancelled first."
        confirmLabel="Archive"
        loading={archiving}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Fact({
  label,
  value,
  hint,
  mono,
}: {
  label: string;
  value: string;
  hint?: string | undefined;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-content-subtle">{label}</dt>
      <dd className={cn('mt-0.5 text-sm text-content', mono && 'font-mono text-xs')}>
        {value}
        {hint && <span className="ml-1.5 text-xs text-content-subtle">({hint})</span>}
      </dd>
    </div>
  );
}

function ChipRow({
  label,
  items,
  tone,
}: {
  label: string;
  items: string[];
  tone: 'danger' | 'warning' | 'info';
}) {
  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-content-subtle">
        {label}
      </span>
      {items.map((item) => (
        <Badge key={item} tone={tone} size="sm">
          {item}
        </Badge>
      ))}
    </div>
  );
}

/**
 * The clinical timeline.
 *
 * Amendments are rendered inline rather than hidden behind a toggle. The whole
 * point of an amendment trail is that it is visible to whoever can read the
 * record — a trail nobody sees is the same as no trail.
 */
function RecordTimeline({ records }: { records: MedicalRecord[] }) {
  if (records.length === 0) {
    return (
      <EmptyState
        illustration="📋"
        title="No clinical records yet"
        description="After a completed visit, your vet's notes appear here."
      />
    );
  }

  return (
    <motion.ol
      variants={staggerContainer(0.04)}
      initial="hidden"
      animate="visible"
      className="relative space-y-4 before:absolute before:left-[0.9375rem] before:top-2 before:h-[calc(100%-1rem)] before:w-px before:bg-border"
    >
      {records.map((record) => (
        <motion.li key={record.id} variants={staggerItem} className="relative pl-10">
          <span
            aria-hidden
            className="absolute left-0 top-1.5 grid size-8 place-items-center rounded-full border border-border bg-surface text-sm"
          >
            {record.type === 'vaccination' ? '💉' : record.type === 'surgery' ? '🔬' : '📋'}
          </span>

          <Card>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-content">{record.diagnosis}</p>
                <p className="mt-0.5 text-xs text-content-subtle">
                  {new Date(record.visitDate).toLocaleDateString(undefined, {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </p>
              </div>
              <Badge tone="neutral" size="sm">
                {record.type.replace('_', ' ')}
              </Badge>
            </div>

            <dl className="mt-3 space-y-2 text-sm">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-content-subtle">
                  Presenting complaint
                </dt>
                <dd className="mt-0.5 text-content-muted text-pretty">{record.chiefComplaint}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-content-subtle">
                  Treatment
                </dt>
                <dd className="mt-0.5 text-content-muted text-pretty">{record.treatment}</dd>
              </div>
            </dl>

            {record.prescriptions.length > 0 && (
              <div className="mt-3 rounded-lg bg-surface-sunken p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-content-subtle">
                  Prescribed
                </p>
                <ul className="mt-1.5 space-y-1">
                  {record.prescriptions.map((prescription, index) => (
                    <li key={index} className="text-sm text-content">
                      <span className="font-medium">{prescription.medication}</span>{' '}
                      <span className="text-content-muted">
                        {prescription.dosage}, {prescription.frequency}, {prescription.durationDays}{' '}
                        day{prescription.durationDays === 1 ? '' : 's'}
                      </span>
                      {prescription.instructions && (
                        <span className="block text-xs text-content-subtle">
                          {prescription.instructions}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {record.followUpRequired && record.followUpDate && (
              <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-info">
                <span aria-hidden>🔁</span>
                Follow-up due {new Date(record.followUpDate).toLocaleDateString()}
              </p>
            )}

            {record.amendments.length > 0 && (
              <div className="mt-3 border-t border-border pt-3">
                <p className="text-xs font-medium uppercase tracking-wide text-content-subtle">
                  Amended {record.amendments.length} time
                  {record.amendments.length === 1 ? '' : 's'}
                </p>
                <ul className="mt-1.5 space-y-1.5">
                  {record.amendments.map((amendment, index) => (
                    <li key={index} className="text-xs text-content-muted text-pretty">
                      <span className="tabular-nums text-content-subtle">
                        {new Date(amendment.amendedAt).toLocaleDateString()}
                      </span>{' '}
                      — {amendment.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        </motion.li>
      ))}
    </motion.ol>
  );
}
