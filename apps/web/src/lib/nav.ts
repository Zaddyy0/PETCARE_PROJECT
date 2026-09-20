import { Role, type Permission } from '@pawsitive/shared';
import type { ReactNode } from 'react';

/**
 * The navigation model.
 *
 * Each item declares the permission it needs, and the sidebar filters against
 * the signed-in user's resolved permissions. The nav therefore reshapes itself
 * per role from the *same* matrix the API enforces with — nobody is shown a
 * link to a page that would 403.
 *
 * The alternative, a `switch (role)` returning four hardcoded arrays, drifts
 * the moment a permission changes: the API starts refusing a route while the
 * nav keeps advertising it.
 */

export interface NavItem {
  label: string;
  to: string;
  /** Rendered inline; kept as a raw path so this file has no JSX. */
  iconPath: string;
  /** Hidden unless the user holds at least one of these. Empty = always shown. */
  requires?: Permission[];
  /** Restricts to specific roles where the rule is about identity, not capability. */
  roles?: Role[];
  /** Key into the badge counts the sidebar is given. */
  badgeKey?: 'notifications' | 'pendingAppointments' | 'moderationQueue';
  end?: boolean;
}

export interface NavSection {
  /** Omitted for the first group, which needs no heading. */
  title?: string;
  items: NavItem[];
}

/* Icon paths are 24×24 stroke geometry, drawn by the sidebar. */
const ICONS = {
  home: 'M3 10.5 12 3l9 7.5M5.25 9.75V20a1 1 0 0 0 1 1h3.5v-5.5h4.5V21h3.5a1 1 0 0 0 1-1V9.75',
  paw: 'M12 13.5c2.5 0 4.5 1.8 4.5 4 0 1.4-1.1 2.5-2.5 2.5h-4c-1.4 0-2.5-1.1-2.5-2.5 0-2.2 2-4 4.5-4ZM6.5 9.5a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5Zm11 0a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5ZM9.75 6.5a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5Zm4.5 0a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5Z',
  calendar:
    'M7 3v3m10-3v3M3.5 9.5h17M5 6.5h14a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 19 20.5H5A1.5 1.5 0 0 1 3.5 19V8A1.5 1.5 0 0 1 5 6.5Z',
  stethoscope:
    'M6 3v5a4 4 0 0 0 8 0V3M10 12v3a4 4 0 0 0 8 0v-2M18 10.5a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5Z',
  clipboard:
    'M9 3.5h6M8 5.5H6.5A1.5 1.5 0 0 0 5 7v12a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V7a1.5 1.5 0 0 0-1.5-1.5H16M8.5 3.5h7v3h-7v-3ZM8.5 11h7M8.5 15h4',
  syringe:
    'M14 5l5 5M16.5 2.5 21.5 7.5M12.5 6.5 17.5 11.5 8 21H3v-5l9.5-9.5ZM10 9l2 2M7.5 11.5l2 2',
  star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.2 1 5.9L12 17l-5.2 2.8 1-5.9L3.5 9.7l5.9-.8L12 3.5Z',
  chart: 'M4 20V10m5 10V4m5 16v-7m5 7V7',
  users:
    'M15.5 20v-1.5a3.5 3.5 0 0 0-3.5-3.5H7a3.5 3.5 0 0 0-3.5 3.5V20M9.5 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm11 8.5v-1.5a3.5 3.5 0 0 0-2.6-3.4M16 4.6a3.5 3.5 0 0 1 0 6.8',
  building:
    'M4 20.5h16M6 20.5V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v15.5M14 9.5h3a1 1 0 0 1 1 1v10M8.5 8h3m-3 3.5h3m-3 3.5h3',
  shield:
    'M12 3.5l7.5 3v5.5c0 4.2-3 7.7-7.5 9-4.5-1.3-7.5-4.8-7.5-9V6.5L12 3.5Zm-2.5 8.5 2 2 3.5-3.5',
  settings:
    'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm8.5-3.5c0 .6-.05 1.15-.15 1.7l2 1.55-2 3.45-2.35-.95c-.85.7-1.85 1.25-2.9 1.6L14.75 22h-4l-.35-2.65a8.3 8.3 0 0 1-2.9-1.6L5.15 18.7l-2-3.45 2-1.55A9 9 0 0 1 5 12c0-.6.05-1.15.15-1.7l-2-1.55 2-3.45 2.35.95c.85-.7 1.85-1.25 2.9-1.6L10.75 2h4l.35 2.65c1.05.35 2.05.9 2.9 1.6l2.35-.95 2 3.45-2 1.55c.1.55.15 1.1.15 1.7Z',
  bell: 'M18 9a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16S18 14 18 9ZM10.3 19a2 2 0 0 0 3.4 0',
} as const;

/**
 * The full navigation, filtered per user.
 *
 * Every role reads the *same* structure; the permission filter is what makes a
 * client see four items and a super admin see twelve.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { label: 'Overview', to: '/app', iconPath: ICONS.home, end: true },
    ],
  },
  {
    title: 'Care',
    items: [
      {
        label: 'My pets',
        to: '/app/pets',
        iconPath: ICONS.paw,
        /* Only a pet owner has pets. A doctor reaches animals through their
           appointments, not through a "my pets" list. */
        requires: ['pet:create'],
      },
      {
        label: 'Appointments',
        to: '/app/appointments',
        iconPath: ICONS.calendar,
        requires: ['appointment:read:own', 'appointment:read:clinic', 'appointment:read:any'],
        badgeKey: 'pendingAppointments',
      },
      {
        label: 'Find a vet',
        to: '/app/doctors',
        iconPath: ICONS.stethoscope,
        /* Clients browse and book; staff use the clinic's own roster instead. */
        roles: [Role.CLIENT],
        requires: ['doctor:read:public'],
      },
      {
        label: 'Medical records',
        to: '/app/records',
        iconPath: ICONS.clipboard,
        requires: [
          'medical_record:read:own',
          'medical_record:read:clinic',
          'medical_record:read:any',
        ],
      },
      {
        label: 'Vaccinations',
        to: '/app/vaccinations',
        iconPath: ICONS.syringe,
        requires: ['vaccination:read:own', 'vaccination:read:clinic'],
      },
    ],
  },
  {
    title: 'Clinic',
    items: [
      {
        label: 'Schedule',
        to: '/app/schedule',
        iconPath: ICONS.calendar,
        /* Clinic-side calendar — a client's own bookings live under
           "Appointments" instead. */
        requires: ['appointment:transition'],
      },
      {
        label: 'Doctors',
        to: '/app/manage/doctors',
        iconPath: ICONS.stethoscope,
        requires: ['doctor:create', 'doctor:update:any'],
      },
      {
        label: 'People',
        to: '/app/manage/users',
        iconPath: ICONS.users,
        requires: ['user:read:clinic', 'user:read:any'],
      },
      {
        label: 'Reviews',
        to: '/app/manage/reviews',
        iconPath: ICONS.star,
        requires: ['review:moderate'],
        badgeKey: 'moderationQueue',
      },
      {
        label: 'My reviews',
        to: '/app/reviews',
        iconPath: ICONS.star,
        /* A doctor's own reviews, which is a different page from moderation. */
        roles: [Role.DOCTOR],
        requires: ['analytics:read:own'],
      },
      {
        label: 'Analytics',
        to: '/app/analytics',
        iconPath: ICONS.chart,
        requires: ['analytics:read:own', 'analytics:read:clinic', 'analytics:read:global'],
      },
    ],
  },
  {
    title: 'Platform',
    items: [
      {
        label: 'Clinics',
        to: '/app/platform/clinics',
        iconPath: ICONS.building,
        requires: ['clinic:read:any', 'clinic:create'],
      },
      {
        label: 'Audit log',
        to: '/app/platform/audit',
        iconPath: ICONS.shield,
        requires: ['audit:read'],
      },
    ],
  },
];

export const SETTINGS_ITEM: NavItem = {
  label: 'Settings',
  to: '/app/settings',
  iconPath: ICONS.settings,
};

export { ICONS as NAV_ICONS };

/**
 * Filter the nav for a user.
 *
 * Sections with no surviving items are dropped, so a client never sees an empty
 * "Platform" heading — which would advertise the existence of features they
 * cannot reach and look like a bug.
 */
export function visibleSections(
  role: Role | null,
  permissions: Permission[],
): NavSection[] {
  if (!role) return [];

  const granted = new Set(permissions);

  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => {
      if (item.roles && !item.roles.includes(role)) return false;
      if (!item.requires || item.requires.length === 0) return true;
      return item.requires.some((permission) => granted.has(permission));
    }),
  })).filter((section) => section.items.length > 0);
}

export type IconRenderer = (path: string) => ReactNode;
