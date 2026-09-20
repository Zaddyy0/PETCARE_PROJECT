import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { useGetVaccinationScheduleQuery } from '@/app/api/medicalApi';
import { errorMessage } from '@/app/api/baseApi';
import { PetAvatar } from '@/design/Avatar';
import { Badge } from '@/design/Badge';
import { Card } from '@/design/Card';
import { EmptyState, ErrorState } from '@/design/EmptyState';
import { PageHeader, SectionHeader } from '@/design/PageHeader';
import { Skeleton } from '@/design/Skeleton';
import { cn } from '@/lib/cn';
import { staggerContainer, staggerItem } from '@/lib/motion';

/**
 * The vaccination schedule.
 *
 * Grouped into overdue / due soon / upcoming rather than shown as one list
 * sorted by date. The grouping *is* the information: "3 overdue" is what the
 * owner needs to act on, and burying it in a chronological list with everything
 * else makes it easy to miss.
 */
export default function VaccinationsPage() {
  const { data, isLoading, error, refetch } = useGetVaccinationScheduleQuery({ withinDays: 180 });

  const overdue = data?.filter((item) => item.isOverdue) ?? [];
  /* "Soon" is the next four weeks — long enough to plan a visit around. */
  const soon = data?.filter((item) => !item.isOverdue && item.daysUntilDue >= -28) ?? [];
  const later = data?.filter((item) => !item.isOverdue && item.daysUntilDue < -28) ?? [];

  return (
    <div>
      <PageHeader
        title="Vaccinations"
        description="What is due, what is overdue, and what is coming up."
      />

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-16 rounded-xl" />
          ))}
        </div>
      )}

      {error && (
        <ErrorState
          title="We could not load the schedule"
          description={errorMessage(error)}
          onRetry={() => void refetch()}
        />
      )}

      {data && data.length === 0 && (
        <EmptyState
          illustration="✅"
          title="Nothing due"
          description="Every vaccination on record is up to date. We will email you before the next one falls due."
        />
      )}

      {data && data.length > 0 && (
        <div className="space-y-8">
          {overdue.length > 0 && (
            <section>
              <SectionHeader
                title={`Overdue (${overdue.length})`}
                description="These should be booked as soon as you can."
              />
              <Group items={overdue} tone="danger" />
            </section>
          )}

          {soon.length > 0 && (
            <section>
              <SectionHeader title={`Due within a month (${soon.length})`} />
              <Group items={soon} tone="warning" />
            </section>
          )}

          {later.length > 0 && (
            <section>
              <SectionHeader title={`Later (${later.length})`} />
              <Group items={later} tone="neutral" />
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function Group({
  items,
  tone,
}: {
  items: NonNullable<ReturnType<typeof useGetVaccinationScheduleQuery>['data']>;
  tone: 'danger' | 'warning' | 'neutral';
}) {
  return (
    <motion.ul
      variants={staggerContainer(0.03)}
      initial="hidden"
      animate="visible"
      className="space-y-2"
    >
      {items.map((item) => (
        <motion.li key={`${item.petId}-${item.vaccineName}-${item.dueAt}`} variants={staggerItem}>
          <Card
            padding="sm"
            className={cn(
              'flex flex-wrap items-center gap-3',
              tone === 'danger' && 'border-danger/30 bg-danger-soft/30',
            )}
          >
            <PetAvatar
              photo={item.petPhoto}
              name={item.petName}
              /* The schedule payload carries no species, and the emoji fallback
                 needs one — 'other' gives the generic paw rather than nothing. */
              species="other"
              size="md"
            />

            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-content">
                {item.vaccineName}
                <span className="ml-1.5 font-normal text-content-muted">for {item.petName}</span>
              </p>
              <p className="text-xs text-content-subtle">
                Due {new Date(item.dueAt).toLocaleDateString(undefined, {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </p>
            </div>

            <Badge tone={tone === 'neutral' ? 'neutral' : tone} size="sm">
              {item.isOverdue
                ? `${item.daysUntilDue} day${item.daysUntilDue === 1 ? '' : 's'} overdue`
                : `in ${Math.abs(item.daysUntilDue)} day${Math.abs(item.daysUntilDue) === 1 ? '' : 's'}`}
            </Badge>

            <Link
              to={`/app/appointments/new?petId=${item.petId}`}
              className="inline-flex h-8 shrink-0 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-fg transition-colors hover:bg-primary-hover"
            >
              Book
            </Link>
          </Card>
        </motion.li>
      ))}
    </motion.ul>
  );
}
