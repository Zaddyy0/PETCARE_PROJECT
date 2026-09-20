import type {
  CreateMedicalRecordInput,
  CreateVaccinationInput,
  MedicalRecord,
  MedicalRecordListQuery,
  Paginated,
  UpdateMedicalRecordInput,
  UpdateVaccinationInput,
  Vaccination,
  VaccinationDetail,
  VaccinationListQuery,
  VaccinationScheduleItem,
} from '@pawsitive/shared';
import { baseApi } from './baseApi';
import { cleanParams } from './petApi';

export const medicalApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    listRecords: build.query<Paginated<MedicalRecord>, MedicalRecordListQuery | void>({
      query: (params) => ({ url: '/medical/records', params: cleanParams(params) }),
      providesTags: (result) =>
        result
          ? [
              ...result.items.map((record) => ({ type: 'MedicalRecord' as const, id: record.id })),
              { type: 'MedicalRecord' as const, id: 'LIST' },
            ]
          : [{ type: 'MedicalRecord' as const, id: 'LIST' }],
    }),

    getRecord: build.query<MedicalRecord, string>({
      query: (id) => `/medical/records/${id}`,
      providesTags: (_result, _error, id) => [{ type: 'MedicalRecord', id }],
    }),

    /** A pet's full clinical timeline, for the pet detail page. */
    getPetTimeline: build.query<MedicalRecord[], string>({
      query: (petId) => `/medical/pets/${petId}/timeline`,
      providesTags: (_result, _error, petId) => [
        { type: 'MedicalRecord', id: `pet-${petId}` },
        { type: 'MedicalRecord', id: 'LIST' },
      ],
    }),

    createRecord: build.mutation<MedicalRecord, CreateMedicalRecordInput>({
      query: (body) => ({ url: '/medical/records', method: 'POST', body }),
      /* Writing up a visit marks the appointment and may update the pet's
         recorded weight, so both are invalidated alongside the record list. */
      invalidatesTags: (_result, _error, arg) => [
        { type: 'MedicalRecord', id: 'LIST' },
        { type: 'MedicalRecord', id: `pet-${arg.petId}` },
        { type: 'Pet', id: arg.petId },
        'Appointment',
        'Analytics',
      ],
    }),

    updateRecord: build.mutation<MedicalRecord, { id: string; body: UpdateMedicalRecordInput }>({
      query: ({ id, body }) => ({ url: `/medical/records/${id}`, method: 'PATCH', body }),

      /**
       * No optimistic update.
       *
       * An edit here may be accepted as a free correction or rejected as
       * needing an amendment reason, and the server decides which. Showing the
       * new text before knowing would mean displaying a version of a clinical
       * record that was never saved — the one place in this app where that is
       * genuinely unacceptable.
       */
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'MedicalRecord', id },
        { type: 'MedicalRecord', id: 'LIST' },
      ],
    }),

    lockRecord: build.mutation<MedicalRecord, string>({
      query: (id) => ({ url: `/medical/records/${id}/lock`, method: 'POST' }),
      invalidatesTags: (_result, _error, id) => [{ type: 'MedicalRecord', id }],
    }),

    /* ---------------------------- Vaccinations --------------------------- */

    listVaccinations: build.query<Paginated<VaccinationDetail>, VaccinationListQuery | void>({
      query: (params) => ({ url: '/medical/vaccinations', params: cleanParams(params) }),
      providesTags: (result) =>
        result
          ? [
              ...result.items.map((dose) => ({ type: 'Vaccination' as const, id: dose.id })),
              { type: 'Vaccination' as const, id: 'LIST' },
            ]
          : [{ type: 'Vaccination' as const, id: 'LIST' }],
    }),

    getVaccinationSchedule: build.query<VaccinationScheduleItem[], { withinDays?: number } | void>({
      query: (params) => ({
        url: '/medical/vaccinations/schedule',
        params: cleanParams(params),
      }),
      providesTags: [{ type: 'Vaccination', id: 'SCHEDULE' }],
    }),

    createVaccination: build.mutation<Vaccination, CreateVaccinationInput>({
      query: (body) => ({ url: '/medical/vaccinations', method: 'POST', body }),
      invalidatesTags: (_result, _error, arg) => [
        { type: 'Vaccination', id: 'LIST' },
        { type: 'Vaccination', id: 'SCHEDULE' },
        { type: 'Pet', id: arg.petId },
      ],
    }),

    updateVaccination: build.mutation<Vaccination, { id: string; body: UpdateVaccinationInput }>({
      query: ({ id, body }) => ({ url: `/medical/vaccinations/${id}`, method: 'PATCH', body }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'Vaccination', id },
        { type: 'Vaccination', id: 'LIST' },
        { type: 'Vaccination', id: 'SCHEDULE' },
        'Pet',
      ],
    }),
  }),
});

export const {
  useListRecordsQuery,
  useGetRecordQuery,
  useGetPetTimelineQuery,
  useCreateRecordMutation,
  useUpdateRecordMutation,
  useLockRecordMutation,
  useListVaccinationsQuery,
  useGetVaccinationScheduleQuery,
  useCreateVaccinationMutation,
  useUpdateVaccinationMutation,
} = medicalApi;
