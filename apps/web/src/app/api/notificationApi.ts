import type {
  CursorPaginated,
  Notification,
  NotificationCounts,
} from '@pawsitive/shared';
import { baseApi } from './baseApi';

export const notificationApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    /**
     * The notification feed, cursor-paginated and *accumulated*.
     *
     * `serializeQueryArgs` drops the cursor from the cache key, so every page
     * lands in one cache entry that `merge` appends to. That is what makes
     * "load more" work: without it each page would replace the previous one and
     * the list would flicker between pages instead of growing.
     */
    listNotifications: build.query<
      CursorPaginated<Notification>,
      { cursor?: string | null; limit?: number; unreadOnly?: boolean } | void
    >({
      query: (params) => ({
        url: '/notifications',
        params: {
          ...(params?.cursor ? { cursor: params.cursor } : {}),
          ...(params?.limit ? { limit: params.limit } : {}),
          ...(params?.unreadOnly ? { unreadOnly: 'true' } : {}),
        },
      }),

      serializeQueryArgs: ({ endpointName, queryArgs }) =>
        /* Unread-only is a genuinely different list, so it keeps its own entry;
           the cursor does not. */
        `${endpointName}-${queryArgs?.unreadOnly ? 'unread' : 'all'}`,

      merge: (existing, incoming, { arg }) => {
        /* No cursor means a fresh load or a refetch — replace rather than
           append, or a refetch would duplicate the first page. */
        if (!arg?.cursor) return incoming;

        const seen = new Set(existing.items.map((item) => item.id));

        return {
          items: [...existing.items, ...incoming.items.filter((item) => !seen.has(item.id))],
          nextCursor: incoming.nextCursor,
          hasMore: incoming.hasMore,
        };
      },

      forceRefetch: ({ currentArg, previousArg }) =>
        currentArg?.cursor !== previousArg?.cursor,

      providesTags: [{ type: 'Notification', id: 'LIST' }],
    }),

    getNotificationCounts: build.query<NotificationCounts, void>({
      query: () => '/notifications/counts',
      providesTags: [{ type: 'Notification', id: 'COUNTS' }],
    }),

    markNotificationRead: build.mutation<{ updated: boolean }, string>({
      query: (id) => ({ url: `/notifications/${id}/read`, method: 'POST' }),

      /**
       * Optimistic, and fired on scroll as items become visible.
       *
       * The endpoint is idempotent — marking an already-read notification
       * returns `updated: false` rather than an error — so there is nothing to
       * roll back on a duplicate, and the badge count drops the instant the
       * user sees the item.
       */
      async onQueryStarted(id, { dispatch, queryFulfilled }) {
        const listPatch = dispatch(
          notificationApi.util.updateQueryData('listNotifications', undefined, (draft) => {
            const item = draft.items.find((notification) => notification.id === id);
            if (item && !item.readAt) item.readAt = new Date().toISOString();
          }),
        );

        const countPatch = dispatch(
          notificationApi.util.updateQueryData('getNotificationCounts', undefined, (draft) => {
            if (draft.unread > 0) draft.unread -= 1;
          }),
        );

        try {
          await queryFulfilled;
        } catch {
          listPatch.undo();
          countPatch.undo();
        }
      },
    }),

    markAllNotificationsRead: build.mutation<{ updated: number }, void>({
      query: () => ({ url: '/notifications/read-all', method: 'POST' }),

      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        const now = new Date().toISOString();

        const listPatch = dispatch(
          notificationApi.util.updateQueryData('listNotifications', undefined, (draft) => {
            for (const item of draft.items) {
              item.readAt ??= now;
            }
          }),
        );

        const countPatch = dispatch(
          notificationApi.util.updateQueryData('getNotificationCounts', undefined, (draft) => {
            draft.unread = 0;
          }),
        );

        try {
          await queryFulfilled;
        } catch {
          listPatch.undo();
          countPatch.undo();
        }
      },
    }),
  }),
});

export const {
  useListNotificationsQuery,
  useGetNotificationCountsQuery,
  useMarkNotificationReadMutation,
  useMarkAllNotificationsReadMutation,
} = notificationApi;
