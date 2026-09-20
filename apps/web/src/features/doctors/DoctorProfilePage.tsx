import { motion } from 'framer-motion';
import { Link, useParams } from 'react-router-dom';
import { MAX_RATING, formatMoney, formatRelative } from '@pawsitive/shared';
import { useGetDoctorQuery } from '@/app/api/doctorApi';
import { useGetReviewSummaryQuery, useListReviewsQuery } from '@/app/api/reviewApi';
import { errorMessage } from '@/app/api/baseApi';
import { Avatar } from '@/design/Avatar';
import { Badge } from '@/design/Badge';
import { Card, CardHeader } from '@/design/Card';
import { EmptyState, ErrorState } from '@/design/EmptyState';
import { PageHeader } from '@/design/PageHeader';
import { LoadingPanel } from '@/design/Spinner';
import { staggerContainer, staggerItem } from '@/lib/motion';
import { StarRating } from './StarRating';

export default function DoctorProfilePage() {
  const { doctorId } = useParams<{ doctorId: string }>();

  const { data: doctor, isLoading, error, refetch } = useGetDoctorQuery(doctorId as string, {
    skip: !doctorId,
  });

  const { data: summary } = useGetReviewSummaryQuery(doctorId as string, { skip: !doctorId });

  const { data: reviews } = useListReviewsQuery(
    { doctorId: doctorId as string, limit: 10, withComment: true },
    { skip: !doctorId },
  );

  if (isLoading) return <LoadingPanel label="Loading profile" />;

  if (error || !doctor) {
    return (
      <ErrorState
        title="We could not load this profile"
        description={errorMessage(error)}
        onRetry={() => void refetch()}
      />
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={doctor.fullName}
        breadcrumbs={[{ label: 'Find a vet', to: '/app/doctors' }, { label: doctor.fullName }]}
        actions={
          doctor.isAcceptingPatients ? (
            <Link
              to={`/app/appointments/new?doctorId=${doctor.id}`}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-medium text-primary-fg shadow-sm transition-colors hover:bg-primary-hover"
            >
              <span aria-hidden>📅</span> Book with {doctor.firstName}
            </Link>
          ) : (
            <Badge tone="neutral">Not accepting new bookings</Badge>
          )
        }
      />

      <div className="grid gap-5 lg:grid-cols-3">
        {/* ---- Main column ---------------------------------------------- */}
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <Avatar name={doctor.fullName} src={doctor.avatar?.url} size="2xl" />

              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-content-muted">{doctor.title}</p>

                <div className="mt-1">
                  {doctor.rating.count > 0 ? (
                    <StarRating value={doctor.rating.average} count={doctor.rating.count} size="lg" />
                  ) : (
                    <span className="text-sm text-content-subtle">No reviews yet</span>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {doctor.specializations.map((item) => (
                    <Badge key={item} tone="primary" size="sm">
                      {item}
                    </Badge>
                  ))}
                </div>

                {doctor.bio && (
                  <p className="mt-4 text-sm leading-relaxed text-content-muted text-pretty">
                    {doctor.bio}
                  </p>
                )}
              </div>
            </div>
          </Card>

          {doctor.qualifications.length > 0 && (
            <Card>
              <CardHeader title="Qualifications" />
              <ul className="mt-3 space-y-2">
                {doctor.qualifications.map((qualification, index) => (
                  <li key={index} className="flex items-baseline gap-2 text-sm">
                    <span aria-hidden className="text-content-subtle">
                      🎓
                    </span>
                    <span className="font-medium text-content">{qualification.degree}</span>
                    <span className="text-content-muted">{qualification.institution}</span>
                    <span className="ml-auto tabular-nums text-content-subtle">
                      {qualification.year}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* ---- Reviews ------------------------------------------------- */}
          <Card>
            <CardHeader
              title="Reviews"
              description={
                summary
                  ? `From ${summary.total} verified visit${summary.total === 1 ? '' : 's'}`
                  : undefined
              }
            />

            {/* The distribution histogram — more informative than the average
                alone, because it shows whether a 4.5 is consistent or polarised. */}
            {summary && summary.total > 0 && (
              <div className="mt-4 space-y-1.5">
                {([5, 4, 3, 2, 1] as const).map((star) => {
                  const count = summary.distribution[String(star) as '1'] ?? 0;
                  const share = summary.total > 0 ? (count / summary.total) * 100 : 0;

                  return (
                    <div key={star} className="flex items-center gap-2 text-xs">
                      <span className="w-8 shrink-0 tabular-nums text-content-subtle">
                        {star}★
                      </span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${share}%` }}
                          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: 0.05 * (5 - star) }}
                          className="h-full rounded-full bg-warning"
                        />
                      </div>
                      <span className="w-8 shrink-0 text-right tabular-nums text-content-subtle">
                        {count}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {reviews && reviews.items.length > 0 ? (
              <motion.ul
                variants={staggerContainer(0.05)}
                initial="hidden"
                animate="visible"
                className="mt-5 divide-y divide-border"
              >
                {reviews.items.map((review) => (
                  <motion.li key={review.id} variants={staggerItem} className="py-4 first:pt-0">
                    <div className="flex items-start gap-3">
                      <Avatar
                        name={review.clientName}
                        src={review.clientAvatar?.thumbnailUrl}
                        size="sm"
                      />

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-content">
                            {review.clientName}
                          </span>
                          {review.isVerified && (
                            <Badge tone="success" size="sm">
                              Verified visit
                            </Badge>
                          )}
                          <span className="text-xs text-content-subtle">
                            {formatRelative(review.createdAt)}
                          </span>
                        </div>

                        <div className="mt-1">
                          <StarRating value={review.rating} size="sm" showValue={false} />
                        </div>

                        {review.title && (
                          <p className="mt-1.5 text-sm font-medium text-content">{review.title}</p>
                        )}

                        <p className="mt-1 text-sm leading-relaxed text-content-muted text-pretty">
                          {review.comment}
                        </p>

                        {/* The doctor's reply, visually nested under the
                            review it answers. */}
                        {review.response && (
                          <div className="mt-3 rounded-lg border-l-2 border-primary bg-primary-soft/40 px-3 py-2">
                            <p className="text-xs font-semibold text-primary">
                              {doctor.firstName} replied
                            </p>
                            <p className="mt-0.5 text-sm text-content-muted text-pretty">
                              {review.response.comment}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.li>
                ))}
              </motion.ul>
            ) : (
              <EmptyState
                compact
                illustration="⭐"
                title="No written reviews yet"
                description="Reviews appear here after a completed visit."
              />
            )}
          </Card>
        </div>

        {/* ---- Sidebar --------------------------------------------------- */}
        <div className="space-y-5">
          <Card>
            <CardHeader title="At a glance" />
            <dl className="mt-3 space-y-3 text-sm">
              <Row label="Consultation" value={formatMoney(doctor.consultationFee)} />
              <Row label="Experience" value={`${doctor.yearsOfExperience} years`} />
              <Row label="Languages" value={doctor.languages.join(', ')} />
              {summary && summary.total > 0 && (
                <Row
                  label="Review rate"
                  value={`${Math.round(summary.responseRate * 100)}% of visits`}
                />
              )}
            </dl>
          </Card>

          {/* Sub-scores, where the doctor has enough reviews for them to mean
              something. */}
          {summary?.breakdownAverages && (
            <Card>
              <CardHeader title="Rated on" />
              <dl className="mt-3 space-y-2.5">
                {Object.entries(summary.breakdownAverages).map(([key, score]) => (
                  <div key={key}>
                    <div className="flex items-baseline justify-between text-xs">
                      <dt className="capitalize text-content-muted">{key}</dt>
                      <dd className="font-medium tabular-nums text-content">
                        {score.toFixed(1)}
                      </dd>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${(score / MAX_RATING) * 100}%` }}
                        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                        className="h-full rounded-full bg-primary"
                      />
                    </div>
                  </div>
                ))}
              </dl>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-content-subtle">{label}</dt>
      <dd className="text-right font-medium text-content">{value}</dd>
    </div>
  );
}
