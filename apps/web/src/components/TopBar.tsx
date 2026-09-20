import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ROLE_LABELS } from '@pawsitive/shared';
import { useLogoutMutation } from '@/app/api/authApi';
import { useAppDispatch, useAppSelector, useClickOutside, useEscapeKey } from '@/app/hooks';
import { selectCurrentUser, selectIsImpersonating } from '@/app/slices/authSlice';
import { cycleTheme, selectTheme, setMobileNav } from '@/app/slices/uiSlice';
import { Avatar } from '@/design/Avatar';
import { cn } from '@/lib/cn';
import { popIn } from '@/lib/motion';
import { NotificationBell } from './NotificationBell';

const THEME_ICON = {
  light: 'M12 4.5v-2m0 19v-2M4.5 12h-2m19 0h-2M6.3 6.3 4.9 4.9m14.2 14.2-1.4-1.4M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  dark: 'M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z',
  system:
    'M4 5.5h16v10H4v-10Zm5 13h6m-3-3v3',
} as const;

export function TopBar({ title }: { title?: string }) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const user = useAppSelector(selectCurrentUser);
  const theme = useAppSelector(selectTheme);
  const impersonating = useAppSelector(selectIsImpersonating);

  const [logout, { isLoading: signingOut }] = useLogoutMutation();
  const [menuOpen, setMenuOpen] = useState(false);

  const menuRef = useClickOutside<HTMLDivElement>(() => setMenuOpen(false), menuOpen);
  useEscapeKey(() => setMenuOpen(false), menuOpen);

  return (
    <>
      {/**
       * Impersonation banner.
       *
       * Loud and unmissable on purpose. A support session where the operator
       * forgets they are acting as someone else is how a note gets written to
       * the wrong record, so the state is never allowed to be subtle.
       */}
      {impersonating && (
        <div
          role="status"
          className="flex items-center justify-center gap-2 bg-accent px-4 py-2 text-center text-xs font-semibold text-accent-fg"
        >
          <span aria-hidden>👁</span>
          Viewing as {user?.fullName}. Actions you take are recorded against this account.
          <button
            type="button"
            onClick={() => void logout()}
            className="ml-1 underline underline-offset-2 hover:no-underline"
          >
            End session
          </button>
        </div>
      )}

      <header className="sticky top-0 z-30 flex h-header items-center gap-3 border-b border-border bg-surface/80 px-4 backdrop-blur-lg lg:px-6">
        {/* Drawer trigger, below `lg` only. */}
        <button
          type="button"
          onClick={() => dispatch(setMobileNav(true))}
          aria-label="Open navigation"
          className="grid size-10 place-items-center rounded-lg text-content-muted transition-colors hover:bg-surface-hover lg:hidden"
        >
          <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="size-5">
            <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
          </svg>
        </button>

        {title && (
          /* `h1` — one per page, and this is it. The route sets the text. */
          <h1 className="truncate text-base font-semibold text-content">{title}</h1>
        )}

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => dispatch(cycleTheme())}
            /* Names the *current* state rather than the action, since the
               button cycles through three values and "toggle theme" would be
               misleading. */
            aria-label={`Theme: ${theme}. Change theme.`}
            title={`Theme: ${theme}`}
            className="grid size-10 place-items-center rounded-lg text-content-muted transition-colors hover:bg-surface-hover hover:text-content"
          >
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-5"
            >
              <path d={THEME_ICON[theme]} />
            </svg>
          </button>

          <NotificationBell />

          {/* ---- Account menu -------------------------------------------- */}
          <div ref={menuRef} className="relative ml-1">
            <button
              type="button"
              onClick={() => setMenuOpen((current) => !current)}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-label="Account menu"
              className="flex items-center gap-2 rounded-lg p-1 transition-colors hover:bg-surface-hover"
            >
              <Avatar
                name={user?.fullName ?? ''}
                src={user?.avatar?.thumbnailUrl ?? user?.avatar?.url}
                size="sm"
              />
              <svg
                aria-hidden
                viewBox="0 0 16 16"
                className={cn(
                  'hidden size-3.5 text-content-subtle transition-transform duration-fast sm:block',
                  menuOpen && 'rotate-180',
                )}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
              >
                <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  role="menu"
                  variants={popIn}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  style={{ transformOrigin: 'top right' }}
                  className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-xl border border-border bg-surface-raised shadow-xl"
                >
                  <div className="border-b border-border px-4 py-3">
                    <p className="truncate text-sm font-semibold text-content">
                      {user?.fullName}
                    </p>
                    <p className="truncate text-xs text-content-subtle">{user?.email}</p>
                    {user && (
                      <p className="mt-1 inline-block rounded-full bg-primary-soft px-2 py-0.5 text-[0.625rem] font-semibold text-primary">
                        {ROLE_LABELS[user.role]}
                      </p>
                    )}
                  </div>

                  <div className="p-1">
                    <Link
                      to="/app/settings"
                      role="menuitem"
                      onClick={() => setMenuOpen(false)}
                      className="block rounded-lg px-3 py-2 text-sm text-content-muted transition-colors hover:bg-surface-hover hover:text-content"
                    >
                      Settings
                    </Link>
                    <Link
                      to="/app/settings/security"
                      role="menuitem"
                      onClick={() => setMenuOpen(false)}
                      className="block rounded-lg px-3 py-2 text-sm text-content-muted transition-colors hover:bg-surface-hover hover:text-content"
                    >
                      Password & sessions
                    </Link>
                  </div>

                  <div className="border-t border-border p-1">
                    <button
                      type="button"
                      role="menuitem"
                      disabled={signingOut}
                      onClick={async () => {
                        setMenuOpen(false);
                        await logout();
                        /* `replace`, so Back does not return to an
                           authenticated page that will now bounce. */
                        navigate('/login', { replace: true });
                      }}
                      className="block w-full rounded-lg px-3 py-2 text-left text-sm text-danger transition-colors hover:bg-danger-soft disabled:opacity-50"
                    >
                      {signingOut ? 'Signing out…' : 'Sign out'}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>
    </>
  );
}
