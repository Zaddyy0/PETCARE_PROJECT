import type {
  CreateReviewInput,
  ModerateReviewInput,
  Paginated,
  Review,
  ReviewDetail,
  ReviewListQuery,
  ReviewSummary,
  UpdateReviewInput,
} from '@pawsitive/shared';
import { baseApi } from './baseApi';
import { cleanParams } from './petApi';

export const reviewApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    listReviews: build.query<Paginated<ReviewDetail>, ReviewListQuery | void>({
      query: (params) => ({ url: '/reviews', params: cleanParams(params) }),
      providesTags: (result) =>
        result
          ? [
              ...result.items.map((review) => ({ type: 'Review' as const, id: review.id })),
              { type: 'Review' as const, id: 'LIST' },
            ]
          : [{ type: 'Review' as const, id: 'LIST' }],
    }),

    getReviewSummary: build.query<ReviewSummary, string>({
      query: (doctorId) => `/reviews/summary/${doctorId}`,
      providesTags: (_result, _error, doctorId) => [{ type: 'ReviewSummary', id: doctorId }],
    }),

    createReview: build.mutation<Review, CreateReviewInput>({
      query: (body) => ({ url: '/reviews', method: 'POST', body }),
      /**
       * A new review moves the doctor's aggregate, so the summary *and* the
       * doctor record are invalidated — the rating shown on a doctor card comes
       * from the Doctor document, not from the review list.
       */
      invalidatesTags: [
        { type: 'Review', id: 'LIST' },
        'ReviewSummary',
        'Doctor',
        'Appointment',
      ],
    }),

    updateReview: build.mutation<Review, { id: string; body: UpdateReviewInput }>({
      query: ({ id, body }) => ({ url: `/reviews/${id}`, method: 'PATCH', body }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'Review', id },
        { type: 'Review', id: 'LIST' },
        'ReviewSummary',
        'Doctor',
      ],
    }),

    deleteReview: build.mutation<{ reviewId: string; status: string }, string>({
      query: (id) => ({ url: `/reviews/${id}`, method: 'DELETE' }),
      invalidatesTags: (_result, _error, id) => [
        { type: 'Review', id },
        { type: 'Review', id: 'LIST' },
        'ReviewSummary',
        'Doctor',
        'Appointment',
      ],
    }),

    respondToReview: build.mutation<Review, { id: string; comment: string }>({
      query: ({ id, comment }) => ({
        url: `/reviews/${id}/respond`,
        method: 'POST',
        body: { comment },
      }),
      /* A reply does not change the rating, so the summary is left alone. */
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'Review', id },
        { type: 'Review', id: 'LIST' },
      ],
    }),

    moderateReview: build.mutation<Review, { id: string; body: ModerateReviewInput }>({
      query: ({ id, body }) => ({ url: `/reviews/${id}/moderate`, method: 'PATCH', body }),
      /* Hiding or restoring a review adds or removes it from the average. */
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'Review', id },
        { type: 'Review', id: 'LIST' },
        'ReviewSummary',
        'Doctor',
      ],
    }),

    markReviewHelpful: build.mutation<{ reviewId: string; helpfulCount: number }, string>({
      query: (id) => ({ url: `/reviews/${id}/helpful`, method: 'POST' }),

      /**
       * Optimistic, because the vote is idempotent server-side.
       *
       * `$addToSet` means a second click is a no-op rather than a double count,
       * so there is no correctness risk in showing the increment immediately —
       * and a "helpful" button that waits on a round trip feels broken.
       */
      async onQueryStarted(id, { dispatch, queryFulfilled }) {
        const patch = dispatch(
          reviewApi.util.updateQueryData('listReviews', undefined, (draft) => {
            const review = draft.items.find((item) => item.id === id);
            if (review) review.helpfulCount += 1;
          }),
        );

        try {
          await queryFulfilled;
        } catch {
          patch.undo();
        }
      },
    }),
  }),
});

export const {
  useListReviewsQuery,
  useGetReviewSummaryQuery,
  useCreateReviewMutation,
  useUpdateReviewMutation,
  useDeleteReviewMutation,
  useRespondToReviewMutation,
  useModerateReviewMutation,
  useMarkReviewHelpfulMutation,
} = reviewApi;
