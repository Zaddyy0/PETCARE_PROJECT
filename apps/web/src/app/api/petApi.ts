import type {
  CreatePetInput,
  Paginated,
  Pet,
  PetListQuery,
  PetWithSummary,
  UpdatePetInput,
} from '@pawsitive/shared';
import { baseApi } from './baseApi';

/**
 * Strip undefined values before they reach the query string.
 *
 * RTK Query serialises params verbatim, so an unset filter becomes
 * `?species=undefined` — which the server's Zod schema then rejects as an
 * invalid enum. Cleaning here means components can pass a filter object with
 * holes in it and not think about this.
 *
 * It also keeps the cache key stable: `{ page: 1 }` and
 * `{ page: 1, species: undefined }` would otherwise be two different cache
 * entries for the same request.
 */
/*
 * Typed as `object`, not `Record<string, unknown>`.
 *
 * The query types in `@pawsitive/shared` are interfaces, and an interface has
 * no index signature — so it is not assignable to `Record<string, unknown>`
 * even though its values are perfectly enumerable. `object` accepts them and
 * `Object.entries` works the same either way.
 */
function clean(params: object | void | null): Record<string, unknown> {
  if (!params) return {};

  return Object.fromEntries(
    Object.entries(params).filter(
      ([, value]) => value !== undefined && value !== '' && value !== null,
    ),
  );
}

export const petApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    listPets: build.query<Paginated<PetWithSummary>, PetListQuery | void>({
      query: (params) => ({ url: '/pets', params: clean(params) }),

      /**
       * Tag each row individually plus a `LIST` sentinel.
       *
       * Updating one pet then invalidates only that pet's tag, so other cached
       * pages are untouched; creating or deleting invalidates `LIST`, which
       * refetches the collection because its membership changed.
       */
      providesTags: (result) =>
        result
          ? [
              ...result.items.map((pet) => ({ type: 'Pet' as const, id: pet.id })),
              { type: 'Pet' as const, id: 'LIST' },
            ]
          : [{ type: 'Pet' as const, id: 'LIST' }],
    }),

    getPet: build.query<PetWithSummary, string>({
      query: (id) => `/pets/${id}`,
      providesTags: (_result, _error, id) => [{ type: 'Pet', id }],
    }),

    createPet: build.mutation<Pet, CreatePetInput>({
      query: (body) => ({ url: '/pets', method: 'POST', body }),
      /* A new pet changes list membership and the client's dashboard counts. */
      invalidatesTags: [{ type: 'Pet', id: 'LIST' }, 'Analytics'],
    }),

    updatePet: build.mutation<Pet, { id: string; body: UpdatePetInput }>({
      query: ({ id, body }) => ({ url: `/pets/${id}`, method: 'PATCH', body }),

      /**
       * Optimistic update.
       *
       * Renaming a pet should feel instant — the round trip is dead time the
       * user has no reason to wait through. The patch is applied immediately
       * and `undo()` rolls it back if the request fails, so a rejected edit
       * visibly reverts rather than silently sticking.
       */
      async onQueryStarted({ id, body }, { dispatch, queryFulfilled }) {
        const patch = dispatch(
          petApi.util.updateQueryData('getPet', id, (draft) => {
            Object.assign(draft, body);
          }),
        );

        try {
          await queryFulfilled;
        } catch {
          patch.undo();
        }
      },

      invalidatesTags: (_result, _error, { id }) => [{ type: 'Pet', id }],
    }),

    archivePet: build.mutation<Pet, { id: string; deceased?: boolean; reason?: string }>({
      query: ({ id, ...body }) => ({ url: `/pets/${id}`, method: 'DELETE', body }),
      /* Archiving also cancels pending vaccinations and changes the dashboard. */
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'Pet', id },
        { type: 'Pet', id: 'LIST' },
        'Vaccination',
        'Analytics',
      ],
    }),

    restorePet: build.mutation<Pet, string>({
      query: (id) => ({ url: `/pets/${id}/restore`, method: 'POST' }),
      invalidatesTags: (_result, _error, id) => [
        { type: 'Pet', id },
        { type: 'Pet', id: 'LIST' },
      ],
    }),

    uploadPetPhoto: build.mutation<{ photo: Pet['photo'] }, { id: string; file: File }>({
      query: ({ id, file }) => {
        const form = new FormData();
        form.append('file', file);

        return {
          url: `/uploads/pets/${id}/photo`,
          method: 'POST',
          body: form,
          /**
           * No explicit Content-Type.
           *
           * `fetch` generates `multipart/form-data` *with the boundary token*
           * automatically for a FormData body. Setting the header by hand omits
           * the boundary and the server cannot parse the body at all — a
           * genuinely baffling failure to debug.
           */
        };
      },
      invalidatesTags: (_result, _error, { id }) => [{ type: 'Pet', id }],
    }),

    removePetPhoto: build.mutation<{ photo: null }, string>({
      query: (id) => ({ url: `/uploads/pets/${id}/photo`, method: 'DELETE' }),
      invalidatesTags: (_result, _error, id) => [{ type: 'Pet', id }],
    }),
  }),
});

export const {
  useListPetsQuery,
  useGetPetQuery,
  useCreatePetMutation,
  useUpdatePetMutation,
  useArchivePetMutation,
  useRestorePetMutation,
  useUploadPetPhotoMutation,
  useRemovePetPhotoMutation,
} = petApi;

export { clean as cleanParams };
