import type {
  CreateUserInput,
  Paginated,
  Role,
  UpdateUserInput,
  User,
  UserListQuery,
} from '@pawsitive/shared';
import { baseApi } from './baseApi';
import { cleanParams } from './petApi';

/** The admin detail view adds a couple of derived counts. */
export interface UserDetail extends User {
  petCount: number;
}

export const userApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    listUsers: build.query<Paginated<User>, UserListQuery | void>({
      query: (params) => ({ url: '/users', params: cleanParams(params) }),
      providesTags: (result) =>
        result
          ? [
              ...result.items.map((user) => ({ type: 'User' as const, id: user.id })),
              { type: 'User' as const, id: 'LIST' },
            ]
          : [{ type: 'User' as const, id: 'LIST' }],
    }),

    getUser: build.query<UserDetail, string>({
      query: (id) => `/users/${id}`,
      providesTags: (_result, _error, id) => [{ type: 'User', id }],
    }),

    createUser: build.mutation<User, CreateUserInput>({
      query: (body) => ({ url: '/users', method: 'POST', body }),
      invalidatesTags: [{ type: 'User', id: 'LIST' }, 'Analytics'],
    }),

    updateUser: build.mutation<User, { id: string; body: UpdateUserInput }>({
      query: ({ id, body }) => ({ url: `/users/${id}`, method: 'PATCH', body }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'User', id },
        { type: 'User', id: 'LIST' },
      ],
    }),

    changeUserRole: build.mutation<
      User,
      { id: string; role: Role; clinicId?: string; reason: string }
    >({
      query: ({ id, ...body }) => ({ url: `/users/${id}/role`, method: 'PATCH', body }),
      /* A role change also revokes the user's sessions and may add or remove a
         doctor profile, so `Doctor` goes too. */
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'User', id },
        { type: 'User', id: 'LIST' },
        'Doctor',
        'Analytics',
      ],
    }),

    suspendUser: build.mutation<
      User & { revokedSessions: number },
      { id: string; reason: string; until?: string }
    >({
      query: ({ id, ...body }) => ({ url: `/users/${id}/suspend`, method: 'POST', body }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'User', id },
        { type: 'User', id: 'LIST' },
        /* A suspended doctor stops accepting patients, which changes the
           directory and their slot grid. */
        'Doctor',
        'Slots',
      ],
    }),

    reactivateUser: build.mutation<User, string>({
      query: (id) => ({ url: `/users/${id}/reactivate`, method: 'POST' }),
      invalidatesTags: (_result, _error, id) => [
        { type: 'User', id },
        { type: 'User', id: 'LIST' },
        'Doctor',
        'Slots',
      ],
    }),

    resendInvite: build.mutation<{ email: string; delivered: boolean }, string>({
      query: (id) => ({ url: `/users/${id}/resend-invite`, method: 'POST' }),
      /* Nothing cached changes — the invite token is not exposed to the client. */
    }),

    uploadAvatar: build.mutation<{ avatar: User['avatar'] }, File>({
      query: (file) => {
        const form = new FormData();
        form.append('file', file);
        /* No Content-Type header — `fetch` must generate the multipart
           boundary itself. */
        return { url: '/uploads/me/avatar', method: 'POST', body: form };
      },
      invalidatesTags: ['Auth', { type: 'User', id: 'LIST' }],
    }),
  }),
});

export const {
  useListUsersQuery,
  useGetUserQuery,
  useCreateUserMutation,
  useUpdateUserMutation,
  useChangeUserRoleMutation,
  useSuspendUserMutation,
  useReactivateUserMutation,
  useResendInviteMutation,
  useUploadAvatarMutation,
} = userApi;
