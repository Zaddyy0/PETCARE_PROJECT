import { motion } from 'framer-motion';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  PET_SPECIES_LABELS,
  PetStatus,
  formatRelative,
  type PetSpecies,
  type PetStatus as PetStatusType,
  type PetWithSummary,
} from '@pawsitive/shared';
import { useListPetsQuery } from '@/app/api/petApi';
import { errorMessage } from '@/app/api/baseApi';
import { useCan } from '@/app/hooks';
import { Badge } from '@/design/Badge';
import { Button } from '@/design/Button';
import { Card } from '@/design/Card';
import { EmptyState, ErrorState } from '@/design/EmptyState';
import { PageHeader } from '@/design/PageHeader';
import { Pagination } from '@/design/Pagination';
import { PetAvatar } from '@/design/Avatar';
import { SkeletonCard } from '@/design/Skeleton';
import { FilterChips, SearchInput, Toolbar } from '@/design/Toolbar';
import { staggerContainer, staggerItem } from '@/lib/motion';

const STATUS_FILTERS = [
  { value: PetStatus.ACTIVE, label: 'Active' },
  { value: PetStatus.ARCHIVED, label: 'Archived' },
  { value: PetStatus.DECEASED, label: 'Remembered' },
] as const;

export default function PetsPage() {
  const canCreate = useCan('pet:create');

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<PetStatusType>(PetStatus.ACTIVE);
  const [species, setSpecies] = useState<PetSpecies | ''>('');

  const { data, isLoading, isFetching, error, refetch } = useListPetsQuery({
    page,
    limit: 12,
    status,
    ...(search ? { search } : {}),
    ...(species ? { species } : {}),
  });

  /* Any filter change invalidates the current page number — staying on page 4
     of a narrower result set shows an empty grid. */
  const resetAndSet = <T,>(setter: (value: T) => void) => (value: T) => {
    setPage(1);
    setter(value);
  };

  return (
    <div>
      <PageHeader
        title="My pets"
        description="Everyone in your care, with their upcoming visits and vaccination status."
        actions={
          /* A real `Link`, not a button with a navigate handler — middle-click
             and "open in new tab" have to work on a primary navigation action. */
          canCreate && (
            <Link
              to="/app/pets/new"
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-fg shadow-sm transition-colors hover:bg-primary-hover"
            >
              <svg aria-hidden viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.75">
                <path d="M8 3.5v9M3.5 8h9" strokeLinecap="round" />
              </svg>
              Add a pet
            </Link>
          )
        }
      />

      <Toolbar>
        <SearchInput
          value={search}
          onChange={resetAndSet(setSearch)}
          placeholder="Search by name or breed…"
          loading={isFetching && !isLoading}
          className="sm:max-w-xs"
        />

        <FilterChips
          label="Status"
          options={[...STATUS_FILTERS]}
          value={status}
          onChange={resetAndSet(setStatus)}
        />

        <select
          value={species}
          onChange={(event) => resetAndSet(setSpecies)(event.target.value as PetSpecies | '')}
          aria-label="Filter by species"
          className="h-10 rounded-lg border border-border bg-surface px-3 text-sm text-content sm:ml-auto"
        >
          <option value="">All species</option>
          {Object.entries(PET_SPECIES_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Toolbar>

      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <SkeletonCard key={index} />
          ))}
        </div>
      )}

      {error && (
        <ErrorState
          title="We could not load your pets"
          description={errorMessage(error)}
          onRetry={() => void refetch()}
        />
      )}

      {data && data.items.length === 0 && (
        <EmptyState
          illustration={search || species ? '🔍' : '🐾'}
          title={search || species ? 'No pets match those filters' : 'No pets yet'}
          description={
            search || species
              ? 'Try a different search or clear the filters.'
              : 'Add your first pet and you can book appointments, track vaccinations and keep their medical history in one place.'
          }
          action={
            search || species ? (
              <Button
                variant="outline"
                onClick={() => {
                  setSearch('');
                  setSpecies('');
                  setPage(1);
                }}
              >
                Clear filters
              </Button>
            ) : (
              canCreate && (
                <Link
                  to="/app/pets/new"
                  className="inline-flex h-10 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-fg hover:bg-primary-hover"
                >
                  Add your first pet
                </Link>
              )
            )
          }
        />
      )}

      {data && data.items.length > 0 && (
        <>
          <motion.div
            variants={staggerContainer(0.04)}
            initial="hidden"
            animate="visible"
            className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
          >
            {data.items.map((pet) => (
              <motion.div key={pet.id} variants={staggerItem}>
                <PetCard pet={pet} />
              </motion.div>
            ))}
          </motion.div>

          <Pagination pagination={data.pagination} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}

function PetCard({ pet }: { pet: PetWithSummary }) {
  return (
    <Link to={`/app/pets/${pet.id}`} className="block h-full focus-visible:outline-none">
      <Card interactive padding="none" className="flex h-full flex-col overflow-hidden">
        <div className="flex items-start gap-3.5 p-4">
          <PetAvatar photo={pet.photo} name={pet.name} species={pet.species} size="lg" />

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h3 className="truncate font-semibold text-content">{pet.name}</h3>
              {pet.status !== PetStatus.ACTIVE && (
                <Badge size="sm" tone="neutral">
                  {pet.status === PetStatus.ARCHIVED ? 'Archived' : 'Remembered'}
                </Badge>
              )}
            </div>

            <p className="mt-0.5 truncate text-sm text-content-muted">
              {PET_SPECIES_LABELS[pet.species]}
              {pet.breed && ` · ${pet.breed}`}
            </p>
            <p className="mt-0.5 text-xs text-content-subtle">{pet.ageLabel}</p>
          </div>
        </div>

        {/* Alerts first — an overdue vaccination is the reason to open this
            card, so it outranks the cosmetic detail above it. */}
        {(pet.overdueVaccinationCount > 0 || pet.nextAppointmentAt) && (
          <div className="mt-auto space-y-1.5 border-t border-border bg-surface-sunken px-4 py-3">
            {pet.overdueVaccinationCount > 0 && (
              <p className="flex items-center gap-1.5 text-xs font-medium text-danger">
                <span aria-hidden>💉</span>
                {pet.overdueVaccinationCount} vaccination
                {pet.overdueVaccinationCount === 1 ? '' : 's'} overdue
              </p>
            )}

            {pet.nextAppointmentAt && (
              <p className="flex items-center gap-1.5 text-xs text-content-muted">
                <span aria-hidden>📅</span>
                Next visit {formatRelative(pet.nextAppointmentAt)}
              </p>
            )}
          </div>
        )}
      </Card>
    </Link>
  );
}
