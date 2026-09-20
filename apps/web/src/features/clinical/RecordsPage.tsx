import { motion } from 'framer-motion';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  MEDICAL_RECORD_TYPES,
  type MedicalRecordType,
} from '@pawsitive/shared';
import { useListRecordsQuery } from '@/app/api/medicalApi';
import { errorMessage } from '@/app/api/baseApi';
import { Badge } from '@/design/Badge';
import { Card } from '@/design/Card';
import { EmptyState, ErrorState } from '@/design/EmptyState';
import { PageHeader } from '@/design/PageHeader';
import { Pagination } from '@/design/Pagination';
import { SkeletonCard } from '@/design/Skeleton';
import { SearchInput, Toolbar } from '@/design/Toolbar';
import { staggerContainer, staggerItem } from '@/lib/motion';

const TYPE_EMOJI: Record<string, string> = {
  consultation: '📋',
  vaccination: '💉',
  surgery: '🔬',
  lab_result: '🧪',
  prescription: '💊',
  imaging: '🩻',
  note: '📝',
};

/**
 * Medical records, across every pet the viewer can reach.
 *
 * A client sees their own animals' history; clinic staff see the clinic's. The
 * server decides which — this page just renders whatever comes back.
 */
export default function RecordsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [type, setType] = useState<MedicalRecordType | ''>('');

  const { data, isLoading, isFetching, error, refetch } = useListRecordsQuery({
    page,
    limit: 10,
    ...(search ? { search } : {}),
    ...(type ? { type } : {}),
  });

  const resetAndSet = <T,>(setter: (value: T) => void) => (value: T) => {
    setPage(1);
    setter(value);
  };

  return (
    <div>
      <PageHeader
        title="Medical records"
        description="Diagnoses, treatments and prescriptions — the full clinical history."
      />

      <Toolbar>
        <SearchInput
          value={search}
          onChange={resetAndSet(setSearch)}
          placeholder="Search diagnoses and treatments…"
          loading={isFetching && !isLoading}
          className="sm:max-w-sm"
        />

        <select
          value={type}
          onChange={(event) => resetAndSet(setType)(event.target.value as MedicalRecordType | '')}
          aria-label="Filter by record type"
          className="h-10 rounded-lg border border-border bg-surface px-3 text-sm text-content sm:ml-auto"
        >
          <option value="">All types</option>
          {MEDICAL_RECORD_TYPES.map((value) => (
            <option key={value} value={value}>
              {value.replace('_', ' ')}
            </option>
          ))}
        </select>
      </Toolbar>

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 4 }, (_, index) => (
            <SkeletonCard key={index} />
          ))}
        </div>
      )}

      {error && (
        <ErrorState
          title="We could not load the records"
          description={errorMessage(error)}
          onRetry={() => void refetch()}
        />
      )}

      {data && data.items.length === 0 && (
        <EmptyState
          illustration={search || type ? '🔍' : '📋'}
          title={search || type ? 'No records match' : 'No records yet'}
          description={
            search || type
              ? 'Try a different search or clear the filter.'
              : 'Clinical notes appear here after a completed visit.'
          }
        />
      )}

      {data && data.items.length > 0 && (
        <>
          <motion.div
            variants={staggerContainer(0.04)}
            initial="hidden"
            animate="visible"
            className="space-y-3"
          >
            {data.items.map((record) => (
              <motion.div key={record.id} variants={staggerItem}>
                <Card>
                  <div className="flex items-start gap-3">
                    <span
                      aria-hidden
                      className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-sunken text-lg"
                    >
                      {TYPE_EMOJI[record.type] ?? '📋'}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="font-medium text-content text-pretty">
                            {record.diagnosis}
                          </h3>
                          <p className="mt-0.5 text-xs text-content-subtle">
                            {new Date(record.visitDate).toLocaleDateString(undefined, {
                              day: 'numeric',
                              month: 'long',
                              year: 'numeric',
                            })}
                          </p>
                        </div>

                        <div className="flex shrink-0 items-center gap-1.5">
                          <Badge tone="neutral" size="sm">
                            {record.type.replace('_', ' ')}
                          </Badge>
                          {/* A locked record is a signed-off record — worth
                              surfacing, because it changes what can be done
                              to it. */}
                          {!record.isEditable && (
                            <Badge tone="info" size="sm">
                              Signed off
                            </Badge>
                          )}
                          {record.amendments.length > 0 && (
                            <Badge tone="warning" size="sm">
                              Amended ×{record.amendments.length}
                            </Badge>
                          )}
                        </div>
                      </div>

                      <p className="mt-2 line-clamp-2 text-sm text-content-muted text-pretty">
                        {record.treatment}
                      </p>

                      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-content-subtle">
                        {record.prescriptions.length > 0 && (
                          <span>
                            💊 {record.prescriptions.length} prescription
                            {record.prescriptions.length === 1 ? '' : 's'}
                          </span>
                        )}
                        {record.followUpRequired && record.followUpDate && (
                          <span className="text-info">
                            🔁 Follow-up {new Date(record.followUpDate).toLocaleDateString()}
                          </span>
                        )}
                        <Link
                          to={`/app/pets/${record.petId}`}
                          className="ml-auto font-medium text-primary hover:underline"
                        >
                          View pet →
                        </Link>
                      </div>
                    </div>
                  </div>
                </Card>
              </motion.div>
            ))}
          </motion.div>

          <Pagination pagination={data.pagination} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
