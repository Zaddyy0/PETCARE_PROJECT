import type { AnalyticsQuery, Clinic, RoleDashboard } from '@pawsitive/shared';
import { baseApi } from './baseApi';
import { cleanParams } from './petApi';

export const analyticsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    /**
     * The role-scoped dashboard.
     *
     * Returns a discriminated union tagged with `scope`, so a component
     * narrows on `data.scope` and TypeScript then knows exactly which shape
     * `data.data` has. The client never asks for a scope — the server derives
     * it from permissions — which is why there is no scope parameter here.
     */
    getDashboard: build.query<RoleDashboard, AnalyticsQuery | void>({
      query: (params) => ({ url: '/analytics/dashboard', params: cleanParams(params) }),
      providesTags: ['Analytics'],
      /* Aggregations are expensive and a dashboard is glanced at, not watched.
         Five minutes avoids re-running a dozen `$group` pipelines every time
         somebody navigates back to the home page. */
      keepUnusedDataFor: 300,
    }),

    listClinics: build.query<Clinic[], void>({
      query: () => '/users/clinics',
      providesTags: ['Clinic'],
    }),
  }),
});

export const { useGetDashboardQuery, useListClinicsQuery } = analyticsApi;
