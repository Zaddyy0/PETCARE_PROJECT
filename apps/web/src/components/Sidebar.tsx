import { AnimatePresence, motion } from 'framer-motion';
import { NavLink } from 'react-router-dom';
import { ROLE_LABELS } from '@pawsitive/shared';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectCurrentUser, selectPermissions, selectRole } from '@/app/slices/authSlice';
import {
  selectMobileNavOpen,
  selectSidebarCollapsed,
  setMobileNav,
  toggleSidebar,
} from '@/app/slices/uiSlice';
import { Avatar } from '@/design/Avatar';
import { cn } from '@/lib/cn';
import { backdrop, spring } from '@/lib/motion';
import { SETTINGS_ITEM, visibleSections, type NavItem } from '@/lib/nav';
import { Logo } from './Logo';

export interface SidebarBadges {
  pendingAppointments?: number;
  moderationQueue?: number;
  notifications?: number;
}

function NavIcon({ path }: { path: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-[1.125rem] shrink-0"
    >
      <path d={path} />
    </svg>
  );
}

function NavRow({
  item,
  collapsed,
  badge,
  onNavigate,
}: {
  item: NavItem;
  collapsed: boolean;
  badge?: number | undefined;
  onNavigate?: () => void;
}) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      /* `title` is the tooltip when collapsed; the label is still in the DOM
         for screen readers via the `sr-only` span below. */
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        cn(
          'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-fast',
          collapsed && 'justify-center px-0',
          isActive
            ? 'bg-primary-soft text-primary'
            : 'text-content-muted hover:bg-surface-hover hover:text-content',
        )
      }
    >
      {({ isActive }) => (
        <>
          {/* The active indicator is a shared-layout element, so it slides
              between rows rather than blinking out and in. */}
          {isActive && (
            <motion.span
              layoutId="sidebar-active"
              transition={spring}
              className="absolute inset-0 -z-10 rounded-lg bg-primary-soft"
            />
          )}

          <NavIcon path={item.iconPath} />

          {collapsed ? (
            <span className="sr-only">{item.label}</span>
          ) : (
            <span className="flex-1 truncate">{item.label}</span>
          )}

          {badge !== undefined && badge > 0 && (
            <span
              className={cn(
                'rounded-full px-1.5 py-0.5 text-[0.625rem] font-semibold tabular-nums',
                collapsed
                  ? 'absolute right-1 top-1 min-w-4 bg-accent text-accent-fg'
                  : 'bg-accent/15 text-accent',
              )}
            >
              {badge > 99 ? '99+' : badge}
              <span className="sr-only"> pending</span>
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

function SidebarBody({
  collapsed,
  badges,
  onNavigate,
}: {
  collapsed: boolean;
  badges: SidebarBadges;
  onNavigate?: () => void;
}) {
  const role = useAppSelector(selectRole);
  const permissions = useAppSelector(selectPermissions);
  const user = useAppSelector(selectCurrentUser);

  /* The nav is derived from the permission matrix, not from a per-role
     hardcoded list — see `lib/nav.ts`. */
  const sections = visibleSections(role, permissions);

  return (
    <>
      <nav aria-label="Main" className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
        {sections.map((section, index) => (
          <div key={section.title ?? `section-${index}`}>
            {section.title && !collapsed && (
              <h2 className="mb-1.5 px-3 text-[0.6875rem] font-semibold uppercase tracking-wider text-content-subtle">
                {section.title}
              </h2>
            )}
            {/* A visible divider stands in for the heading when collapsed. */}
            {section.title && collapsed && <div className="mx-auto mb-2 h-px w-6 bg-border" />}

            <div className="space-y-0.5">
              {section.items.map((item) => (
                <NavRow
                  key={item.to}
                  item={item}
                  collapsed={collapsed}
                  badge={item.badgeKey ? badges[item.badgeKey] : undefined}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-border px-3 py-3">
        <NavRow item={SETTINGS_ITEM} collapsed={collapsed} onNavigate={onNavigate} />

        {user && (
          <div
            className={cn(
              'mt-2 flex items-center gap-2.5 rounded-lg px-3 py-2',
              collapsed && 'justify-center px-0',
            )}
          >
            <Avatar name={user.fullName} src={user.avatar?.thumbnailUrl ?? user.avatar?.url} size="sm" />
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-content">{user.fullName}</p>
                <p className="truncate text-xs text-content-subtle">{ROLE_LABELS[user.role]}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

/**
 * The sidebar.
 *
 * Two distinct renderings from one body: a persistent rail from `lg` up, and an
 * overlay drawer below it. They are separate elements rather than one
 * responsive element because the drawer needs a backdrop, a focus trap and
 * different animation — folding both into one component produces something that
 * is subtly wrong on both.
 */
export function Sidebar({ badges = {} }: { badges?: SidebarBadges }) {
  const dispatch = useAppDispatch();
  const collapsed = useAppSelector(selectSidebarCollapsed);
  const mobileOpen = useAppSelector(selectMobileNavOpen);

  return (
    <>
      {/* ---- Desktop rail ------------------------------------------------ */}
      <motion.aside
        animate={{ width: collapsed ? 'var(--sidebar-width-collapsed)' : 'var(--sidebar-width)' }}
        transition={spring}
        className="sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-surface lg:flex"
      >
        <div
          className={cn(
            'flex h-header items-center border-b border-border px-4',
            collapsed && 'justify-center px-0',
          )}
        >
          <Logo collapsed={collapsed} />
        </div>

        <SidebarBody collapsed={collapsed} badges={badges} />

        <button
          type="button"
          onClick={() => dispatch(toggleSidebar())}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="flex h-10 items-center justify-center border-t border-border text-content-subtle transition-colors hover:bg-surface-hover hover:text-content"
        >
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            className={cn('size-4 transition-transform duration-base', collapsed && 'rotate-180')}
          >
            <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </motion.aside>

      {/* ---- Mobile drawer ---------------------------------------------- */}
      <AnimatePresence>
        {mobileOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <motion.div
              variants={backdrop}
              initial="hidden"
              animate="visible"
              exit="exit"
              aria-hidden
              onClick={() => dispatch(setMobileNav(false))}
              className="absolute inset-0 bg-sand-950/50 backdrop-blur-sm"
            />

            <motion.aside
              /* Slides from the left, matching where the trigger lives. */
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="relative flex h-full w-[17rem] flex-col border-r border-border bg-surface shadow-xl"
            >
              <div className="flex h-header items-center justify-between border-b border-border px-4">
                <Logo />
                <button
                  type="button"
                  onClick={() => dispatch(setMobileNav(false))}
                  aria-label="Close navigation"
                  className="grid size-8 place-items-center rounded-md text-content-subtle hover:bg-surface-hover"
                >
                  <svg aria-hidden viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" className="size-4">
                    <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
                  </svg>
                </button>
              </div>

              {/* Navigating closes the drawer — leaving it open over the page
                  the user just asked for is the classic mobile-nav bug. */}
              <SidebarBody
                collapsed={false}
                badges={badges}
                onNavigate={() => dispatch(setMobileNav(false))}
              />
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
