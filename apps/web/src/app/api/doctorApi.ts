import type {
  AvailableSlot,
  CreateDoctorInput,
  Doctor,
  DoctorAvailability,
  DoctorListQuery,
  Paginated,
  UpdateAvailabilityInput,
  UpdateDoctorInput,
} from '@pawsitive/shared';
import { baseApi } from './baseApi';
import { cleanParams } from './petApi';

export interface SlotsResponse {
  doctorId: string;
  timezone: string;
  slots: AvailableSlot[];
}

export const doctorApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    listDoctors: build.query<Paginated<Doctor>, DoctorListQuery | void>({
      query: (params) => ({ url: '/doctors', params: cleanParams(params) }),
      providesTags: (result) =>
        result
          ? [
              ...result.items.map((doctor) => ({ type: 'Doctor' as const, id: doctor.id })),
              { type: 'Doctor' as const, id: 'LIST' },
            ]
          : [{ type: 'Doctor' as const, id: 'LIST' }],
    }),

    getDoctor: build.query<Doctor, string>({
      query: (id) => `/doctors/${id}`,
      providesTags: (_result, _error, id) => [{ type: 'Doctor', id }],
    }),

    /**
     * The bookable slot grid.
     *
     * The most cache-sensitive query in the app. Slots go stale the instant
     * anyone else books, so:
     *
     *   • it is tagged `Slots` per doctor, and every booking mutation
     *     invalidates that doctor's tag;
     *   • `keepUnusedDataFor` is cut to 15s, because a cached grid from a
     *     minute ago will happily offer a slot that is already taken — the user
     *     clicks, gets a 409, and rightly concludes the app is broken.
     */
    getSlots: build.query<SlotsResponse, { doctorId: string; from: string; to: string }>({
      query: ({ doctorId, from, to }) => ({
        url: `/doctors/${doctorId}/slots`,
        params: { from, to },
      }),
      providesTags: (_result, _error, { doctorId }) => [{ type: 'Slots', id: doctorId }],
      keepUnusedDataFor: 15,
    }),

    createDoctor: build.mutation<Doctor, CreateDoctorInput>({
      query: (body) => ({ url: '/doctors', method: 'POST', body }),
      invalidatesTags: [{ type: 'Doctor', id: 'LIST' }, 'User', 'Analytics'],
    }),

    updateDoctor: build.mutation<Doctor, { id: string; body: UpdateDoctorInput }>({
      query: ({ id, body }) => ({ url: `/doctors/${id}`, method: 'PATCH', body }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'Doctor', id },
        { type: 'Doctor', id: 'LIST' },
      ],
    }),

    updateAvailability: build.mutation<
      { availability: DoctorAvailability; appointmentsOutsideNewHours: number },
      { id: string; body: UpdateAvailabilityInput }
    >({
      query: ({ id, body }) => ({ url: `/doctors/${id}/availability`, method: 'PUT', body }),
      /* Changing hours changes the whole grid, so the slot cache must go. */
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'Doctor', id },
        { type: 'Slots', id },
      ],
    }),

    deactivateDoctor: build.mutation<{ doctorId: string; isActive: boolean }, string>({
      query: (id) => ({ url: `/doctors/${id}`, method: 'DELETE' }),
      invalidatesTags: (_result, _error, id) => [
        { type: 'Doctor', id },
        { type: 'Doctor', id: 'LIST' },
        'User',
      ],
    }),
  }),
});

export const {
  useListDoctorsQuery,
  useGetDoctorQuery,
  useGetSlotsQuery,
  useCreateDoctorMutation,
  useUpdateDoctorMutation,
  useUpdateAvailabilityMutation,
  useDeactivateDoctorMutation,
} = doctorApi;
