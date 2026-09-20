import type {
  Appointment,
  AppointmentDetail,
  AppointmentListQuery,
  CalendarEntry,
  CreateAppointmentInput,
  Paginated,
  RescheduleAppointmentInput,
  TransitionAppointmentInput,
} from '@pawsitive/shared';
import { baseApi } from './baseApi';
import { cleanParams } from './petApi';

/**
 * Tags invalidated by any change to an appointment.
 *
 * Shared by every booking mutation, because they all have the same blast
 * radius: the appointment itself, the list, the calendar, the affected doctor's
 * slot grid, the pet's timeline, and the dashboard counts.
 *
 * Writing this out once is what stops the list from going stale after a
 * cancellation — the classic bug where an appointment lingers on screen after
 * the user just cancelled it.
 */
function bookingTags(doctorId?: string, appointmentId?: string) {
  return [
    ...(appointmentId ? [{ type: 'Appointment' as const, id: appointmentId }] : []),
    { type: 'Appointment' as const, id: 'LIST' },
    'Calendar' as const,
    ...(doctorId ? [{ type: 'Slots' as const, id: doctorId }] : []),
    'Pet' as const,
    'Analytics' as const,
  ];
}

export const appointmentApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    listAppointments: build.query<Paginated<AppointmentDetail>, AppointmentListQuery | void>({
      query: (params) => ({ url: '/appointments', params: cleanParams(params) }),
      providesTags: (result) =>
        result
          ? [
              ...result.items.map((appointment) => ({
                type: 'Appointment' as const,
                id: appointment.id,
              })),
              { type: 'Appointment' as const, id: 'LIST' },
            ]
          : [{ type: 'Appointment' as const, id: 'LIST' }],
    }),

    getAppointment: build.query<AppointmentDetail, string>({
      query: (id) => `/appointments/${id}`,
      providesTags: (_result, _error, id) => [{ type: 'Appointment', id }],
    }),

    getCalendar: build.query<
      CalendarEntry[],
      { from: string; to: string; doctorId?: string; clinicId?: string }
    >({
      query: (params) => ({ url: '/appointments/calendar', params: cleanParams(params) }),
      providesTags: ['Calendar'],
      /* A calendar being viewed is being actively watched, so keep it fresh. */
      keepUnusedDataFor: 20,
    }),

    bookAppointment: build.mutation<Appointment, CreateAppointmentInput>({
      query: (body) => ({ url: '/appointments', method: 'POST', body }),

      /**
       * No optimistic update here, deliberately.
       *
       * Booking can lose a race — the slot may be taken between the grid
       * loading and the click, which is exactly what the server's 409 is for.
       * Optimistically showing the appointment and then removing it again is a
       * far worse experience than a brief spinner followed by either a
       * confirmation or "that time was just taken".
       */
      invalidatesTags: (_result, _error, arg) => bookingTags(arg.doctorId),
    }),

    rescheduleAppointment: build.mutation<
      Appointment,
      { id: string; body: RescheduleAppointmentInput }
    >({
      query: ({ id, body }) => ({
        url: `/appointments/${id}/reschedule`,
        method: 'PATCH',
        body,
      }),
      /* Two slot grids may change if the doctor also moved, so invalidate the
         `Slots` tag broadly rather than for one id. */
      invalidatesTags: (_result, _error, { id }) => [
        ...bookingTags(undefined, id),
        'Slots' as const,
      ],
    }),

    transitionAppointment: build.mutation<
      Appointment,
      { id: string; body: TransitionAppointmentInput }
    >({
      query: ({ id, body }) => ({ url: `/appointments/${id}/status`, method: 'PATCH', body }),

      /**
       * Optimistic, unlike booking.
       *
       * A status change cannot lose a race in the same way: the state machine is
       * deterministic and the server either accepts the edge or rejects it. So
       * the badge flips instantly and rolls back on the rare rejection, which
       * makes a doctor working through a day's list feel responsive instead of
       * waiting on each tap.
       */
      async onQueryStarted({ id, body }, { dispatch, queryFulfilled }) {
        const patch = dispatch(
          appointmentApi.util.updateQueryData('getAppointment', id, (draft) => {
            draft.status = body.status;
          }),
        );

        try {
          await queryFulfilled;
        } catch {
          patch.undo();
        }
      },

      invalidatesTags: (_result, _error, { id }) => bookingTags(undefined, id),
    }),

    cancelAppointment: build.mutation<Appointment, { id: string; reason: string }>({
      query: ({ id, reason }) => ({
        url: `/appointments/${id}/cancel`,
        method: 'POST',
        body: { reason },
      }),
      /* A cancellation frees a slot, so the grid must be refetched — this is
         the tag that makes the freed time reappear for other clients. */
      invalidatesTags: (_result, _error, { id }) => [
        ...bookingTags(undefined, id),
        'Slots' as const,
      ],
    }),
  }),
});

export const {
  useListAppointmentsQuery,
  useGetAppointmentQuery,
  useGetCalendarQuery,
  useBookAppointmentMutation,
  useRescheduleAppointmentMutation,
  useTransitionAppointmentMutation,
  useCancelAppointmentMutation,
} = appointmentApi;
