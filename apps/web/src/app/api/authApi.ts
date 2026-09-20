import type {
  AcceptInviteInput,
  ChangePasswordInput,
  CurrentUser,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
  UpdateProfileInput,
  User,
} from '@pawsitive/shared';
import { baseApi } from './baseApi';
import { sessionEstablished, signedOut } from '../slices/authSlice';

interface SessionResponse {
  user: CurrentUser;
  tokens: { accessToken: string; expiresIn: number; tokenType: 'Bearer' };
}

export const authApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    login: build.mutation<SessionResponse, LoginInput>({
      query: (body) => ({ url: '/auth/login', method: 'POST', body }),

      /**
       * The session is written to the store here rather than in the component.
       *
       * Putting it in `onQueryStarted` means *every* caller of this mutation
       * establishes the session identically — a second sign-in form, or a
       * redirect flow, cannot forget to dispatch it.
       */
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(
            sessionEstablished({
              user: data.user,
              accessToken: data.tokens.accessToken,
              expiresIn: data.tokens.expiresIn,
            }),
          );
        } catch {
          /* The component surfaces the error; nothing to do to the store. */
        }
      },
    }),

    register: build.mutation<SessionResponse, RegisterInput>({
      query: (body) => ({ url: '/auth/register', method: 'POST', body }),
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(
            sessionEstablished({
              user: data.user,
              accessToken: data.tokens.accessToken,
              expiresIn: data.tokens.expiresIn,
            }),
          );
        } catch {
          /* Handled by the caller. */
        }
      },
    }),

    /**
     * The boot refresh.
     *
     * Called once on app start to turn the httpOnly cookie into an access
     * token. This is what makes a page reload keep the user signed in without
     * ever storing a token where a script could read it.
     */
    refresh: build.mutation<SessionResponse, void>({
      query: () => ({ url: '/auth/refresh', method: 'POST', body: {} }),
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(
            sessionEstablished({
              user: data.user,
              accessToken: data.tokens.accessToken,
              expiresIn: data.tokens.expiresIn,
            }),
          );
        } catch {
          /* No valid cookie — a normal anonymous visit, not an error. */
          dispatch(signedOut());
        }
      },
    }),

    logout: build.mutation<null, void>({
      query: () => ({ url: '/auth/logout', method: 'POST' }),

      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        /**
         * Clear local state whether or not the request succeeds.
         *
         * If the network is down, the user still pressed "sign out" and must
         * end up signed out locally. Leaving them in the app because a POST
         * failed is the wrong failure direction for this particular action.
         */
        try {
          await queryFulfilled;
        } finally {
          dispatch(signedOut());
          /* Drop every cached query, so the next user of this browser cannot
             see the previous one's data flash on screen. */
          dispatch(baseApi.util.resetApiState());
        }
      },
    }),

    logoutEverywhere: build.mutation<{ revokedSessions: number }, void>({
      query: () => ({ url: '/auth/logout-all', method: 'POST' }),
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          await queryFulfilled;
        } finally {
          dispatch(signedOut());
          dispatch(baseApi.util.resetApiState());
        }
      },
    }),

    me: build.query<CurrentUser, void>({
      query: () => '/auth/me',
      providesTags: ['Auth'],
    }),

    forgotPassword: build.mutation<{ email: string }, { email: string }>({
      query: (body) => ({ url: '/auth/forgot-password', method: 'POST', body }),
    }),

    resetPassword: build.mutation<null, ResetPasswordInput>({
      query: (body) => ({ url: '/auth/reset-password', method: 'POST', body }),
    }),

    changePassword: build.mutation<null, ChangePasswordInput>({
      query: (body) => ({ url: '/auth/change-password', method: 'POST', body }),

      /* The server revokes every session on a password change, so the local
         one is already dead — reflect that rather than leaving a broken UI. */
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          await queryFulfilled;
          dispatch(signedOut());
          dispatch(baseApi.util.resetApiState());
        } catch {
          /* Wrong current password; the form shows it. */
        }
      },
    }),

    acceptInvite: build.mutation<SessionResponse, AcceptInviteInput>({
      query: (body) => ({ url: '/auth/accept-invite', method: 'POST', body }),
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(
            sessionEstablished({
              user: data.user,
              accessToken: data.tokens.accessToken,
              expiresIn: data.tokens.expiresIn,
            }),
          );
        } catch {
          /* Invalid or expired invitation; the page explains. */
        }
      },
    }),

    impersonate: build.mutation<SessionResponse, { userId: string; reason: string }>({
      query: (body) => ({ url: '/auth/impersonate', method: 'POST', body }),
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(
            sessionEstablished({
              user: data.user,
              accessToken: data.tokens.accessToken,
              expiresIn: data.tokens.expiresIn,
            }),
          );
          /* Everything cached belongs to the *previous* identity. */
          dispatch(baseApi.util.resetApiState());
        } catch {
          /* Refused; the admin console shows why. */
        }
      },
    }),

    updateProfile: build.mutation<User, UpdateProfileInput>({
      query: (body) => ({ url: '/users/me', method: 'PATCH', body }),
      invalidatesTags: ['Auth', 'User'],
    }),
  }),
});

export const {
  useLoginMutation,
  useRegisterMutation,
  useRefreshMutation,
  useLogoutMutation,
  useLogoutEverywhereMutation,
  useMeQuery,
  useForgotPasswordMutation,
  useResetPasswordMutation,
  useChangePasswordMutation,
  useAcceptInviteMutation,
  useImpersonateMutation,
  useUpdateProfileMutation,
} = authApi;
