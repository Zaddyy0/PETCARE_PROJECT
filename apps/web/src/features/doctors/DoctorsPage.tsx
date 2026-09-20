import { motion } from 'framer-motion';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  SPECIALIZATION_SUGGESTIONS,
  formatMoney,
  type Doctor,
} from '@pawsitive/shared';
import { useListDoctorsQuery } from '@/app/api/doctorApi';
import { errorMessage } from '@/app/api/baseApi';
import { Avatar } from '@/design/Avatar';
import { Badge } from '@/design/Badge';
import { Button } from '@/design/Button';
import { Card } from '@/design/Card';
import { EmptyState, ErrorState } from '@/design/EmptyState';
import { PageHeader } from '@/design/PageHeader';
import { Pagination } from '@/design/Pagination';
import { SkeletonCard } from '@/design/Skeleton';
import { SearchInput, Toolbar } from '@/design/Toolbar';
import { StarRating } from './StarRating';
import { staggerContainer, staggerItem } from '@/lib/motion';

type Sort = 'rating' | 'experience' | 'fee' | 'name';

export default function DoctorsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [specialization, setSpecialization] = useState('');
  const [sort, setSort] = useState<Sort>('rating');

  const { data, isLoading, isFetching, error, refetch } = useListDoctorsQuery({
    page,
    limit: 9,
    sort,
    isAcceptingPatients: true,
    ...(search ? { search } : {}),
    ...(specialization ? { specialization } : {}),
  });

  const resetAndSet = <T,>(setter: (value: T) => void) => (value: T) => {
    setPage(1);
    setter(value);
  };

  return (
    <div>
      <PageHeader
        title="Find a vet"
        description="Every clinician accepting new bookings, with verified ratings from real appointments."
      />

      <Toolbar>
        <SearchInput
          value={search}
          onChange={resetAndSet(setSearch)}
          placeholder="Search by name…"
          loading={isFetching && !isLoading}
          className="sm:max-w-xs"
        />

        <select
          value={specialization}
          onChange={(event) => resetAndSet(setSpecialization)(event.target.value)}
          aria-label="Filter by specialisation"
          className="h-10 rounded-lg border border-border bg-surface px-3 text-sm text-content"
        >
          <option value="">All specialisations</option>
          {SPECIALIZATION_SUGGESTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>

        <select
          value={sort}
          onChange={(event) => resetAndSet(setSort)(event.target.value as Sort)}
          aria-label="Sort by"
          className="h-10 rounded-lg border border-border bg-surface px-3 text-sm text-content sm:ml-auto"
        >
          <option value="rating">Highest rated</option>
          <option value="experience">Most experienced</option>
          <option value="fee">Lowest fee</option>
        </select>
      </Toolbar>

      {isLoading && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <SkeletonCard key={index} />
          ))}
        </div>
      )}

      {error && (
        <ErrorState
          title="We could not load the directory"
          description={errorMessage(error)}
          onRetry={() => void refetch()}
        />
      )}

      {data && data.items.length === 0 && (
        <EmptyState
          illustration="🔍"
          title="No vets match those filters"
          description="Try a broader specialisation, or clear the search."
          action={
            <Button
              variant="outline"
              onClick={() => {
                setSearch('');
                setSpecialization('');
                setPage(1);
              }}
            >
              Clear filters
            </Button>
          }
        />
      )}

      {data && data.items.length > 0 && (
        <>
          <motion.div
            variants={staggerContainer(0.04)}
            initial="hidden"
            animate="visible"
            className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
          >
            {data.items.map((doctor) => (
              <motion.div key={doctor.id} variants={staggerItem}>
                <DoctorCard doctor={doctor} />
              </motion.div>
            ))}
          </motion.div>

          <Pagination pagination={data.pagination} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}

function DoctorCard({ doctor }: { doctor: Doctor }) {
  return (
    <Card padding="none" className="flex h-full flex-col overflow-hidden">
      <div className="flex-1 p-5">
        <div className="flex items-start gap-3">
          <Avatar name={doctor.fullName} src={doctor.avatar?.url} size="lg" />

          <div className="min-w-0 flex-1">
            <h3 className="truncate font-semibold text-content">{doctor.fullName}</h3>
            <p className="truncate text-sm text-content-muted">{doctor.title}</p>

            <div className="mt-1.5">
              {doctor.rating.count > 0 ? (
                <StarRating
                  value={doctor.rating.average}
                  count={doctor.rating.count}
                  size="sm"
                />
              ) : (
                /* "No reviews yet" is more honest than an empty star row,
                   which reads as a zero rating. */
                <span className="text-xs text-content-subtle">No reviews yet</span>
              )}
            </div>
          </div>
        </div>

        {doctor.bio && (
          <p className="mt-3 line-clamp-3 text-sm text-content-muted text-pretty">{doctor.bio}</p>
        )}

        <div className="mt-3 flex flex-wrap gap-1.5">
          {doctor.specializations.slice(0, 3).map((item) => (
            <Badge key={item} tone="primary" size="sm">
              {item}
            </Badge>
          ))}
          {doctor.specializations.length > 3 && (
            <Badge tone="neutral" size="sm">
              +{doctor.specializations.length - 3}
            </Badge>
          )}
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm">
          <div>
            <dt className="text-xs text-content-subtle">Experience</dt>
            <dd className="font-medium tabular-nums text-content">
              {doctor.yearsOfExperience} years
            </dd>
          </div>
          <div>
            <dt className="text-xs text-content-subtle">Consultation</dt>
            <dd className="font-medium tabular-nums text-content">
              {formatMoney(doctor.consultationFee)}
            </dd>
          </div>
        </dl>
      </div>

      <div className="flex gap-2 border-t border-border bg-surface-sunken p-3">
        <Link
          to={`/app/doctors/${doctor.id}`}
          className="flex h-9 flex-1 items-center justify-center rounded-lg border border-border bg-surface text-sm font-medium text-content transition-colors hover:bg-surface-hover"
        >
          Profile
        </Link>
        <Link
          to={`/app/appointments/new?doctorId=${doctor.id}`}
          className="flex h-9 flex-1 items-center justify-center rounded-lg bg-primary text-sm font-medium text-primary-fg transition-colors hover:bg-primary-hover"
        >
          Book
        </Link>
      </div>
    </Card>
  );
}
