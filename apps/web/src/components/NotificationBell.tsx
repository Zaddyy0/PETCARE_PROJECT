import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatRelative } from '@pawsitive/shared';
import {
  useGetNotificationCountsQuery,
  useListNotificationsQuery,
  useMarkAllNotificationsReadMutation,
  useMarkNotificationReadMutation,
} from '@/app/api/notificationApi';
import { useClickOutside, useEscapeKey } from '@/app/hooks';
import { EmptyState } from '@/design/EmptyState';
import { Skeleton } from '@/design/Skeleton';
import { cn } from '@/lib/cn';
import { popIn } from '@/lib/motion';

/** Emoji per notification type. Cheap, legible, and no icon set to ship. */
const TYPE_EMOJI: Record<string, string> = {
  appointment_booked: '📅',
  appointment_confirmed: '✅',
  appointment_cancelled: '❌',
  appointment_reminder: '⏰',
  appointment_completed: '🎉',
  vaccination_due: '💉',
  medical_record_added: '📋',
  review_received: '⭐',
  account_invited: '✉️',
  account_suspended: '🚫',
  system_announcement: '📣',
};

/**
 * The notification bell and its dropdown.
 *
 * The count query runs whenever the bell is mounted; the *list* is only fetched
 * once the panel opens (`skip: !open`). Loading a page of notifications on
 * every app load, for a panel most users never open, is a request nobody asked
 * for — the badge only needs a number.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const { data: counts } = useGetNotificationCountsQuery();
  const { data: feed, isLoading } = useListNotificationsQuery(
    { limit: 8 },
    { skip: !open },
  );

  const [markRead] = useMarkNotificationReadMutation();
  const [markAllRead, { isLoading: markingAll }] = useMarkAllNotificationsReadMutation();

  const panelRef = useClickOutside<HTMLDivElement>(() => setOpen(false), open);
  useEscapeKey(() => setOpen(false), open);

  const unread = counts?.unread ?? 0;

  return (
    <div ref={panelRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        className="relative grid size-10 place-items-center rounded-lg text-content-muted transition-colors hover:bg-surface-hover hover:text-content"
      >
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          className="size-5"
        >
          <path d="M18 9a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16S18 14 18 9ZM10.3 19a2 2 0 0 0 3.4 0" />
        </svg>

        {unread > 0 && (
          <motion.span
            /* Springs in when the count first appears, so a notification
               arriving over websocket is noticeable without being loud. */
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 20 }}
            className="absolute -right-0.5 -top-0.5 grid min-w-[1.125rem] place-items-center rounded-full bg-accent px-1 text-[0.625rem] font-bold tabular-nums text-accent-fg"
          >
            {unread > 9 ? '9+' : unread}
          </motion.span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="Notifications"
            variants={popIn}
            initial="hidden"
            animate="visible"
            exit="exit"
            /* Anchored to the trigger so the scale-in reads as an expansion
               from the bell rather than an arrival from nowhere. */
            style={{ transformOrigin: 'top right' }}
            className="absolute right-0 top-full z-50 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-surface-raised shadow-xl"
          >
            <header className="flex items-center justify-between border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold text-content">Notifications</h3>
              {unread > 0 && (
                <button
                  type="button"
                  onClick={() => void markAllRead()}
                  disabled={markingAll}
                  className="text-xs font-medium text-primary transition-opacity hover:underline disabled:opacity-50"
                >
                  Mark all read
                </button>
              )}
            </header>

            <div className="max-h-[22rem] overflow-y-auto">
              {isLoading && (
                <div className="space-y-3 p-4">
                  {Array.from({ length: 3 }, (_, index) => (
                    <div key={index} className="flex gap-3">
                      <Skeleton className="size-8 rounded-lg" />
                      <div className="flex-1 space-y-1.5">
                        <Skeleton className="h-3 w-3/4" />
                        <Skeleton className="h-2.5 w-1/2" />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!isLoading && feed?.items.length === 0 && (
                <EmptyState
                  compact
                  illustration="🔔"
                  title="Nothing new"
                  description="Appointment updates and reminders will appear here."
                />
              )}

              {feed?.items.map((notification) => {
                const isUnread = !notification.readAt;

                return (
                  <button
                    key={notification.id}
                    type="button"
                    onClick={() => {
                      /* Mark read on click regardless — the user has now seen
                         it, whether or not it has somewhere to navigate. */
                      if (isUnread) void markRead(notification.id);

                      if (notification.actionUrl) {
                        setOpen(false);
                        navigate(notification.actionUrl);
                      }
                    }}
                    className={cn(
                      'flex w-full gap-3 border-b border-border px-4 py-3 text-left transition-colors last:border-0',
                      'hover:bg-surface-hover',
                      isUnread && 'bg-primary-soft/40',
                    )}
                  >
                    <span
                      aria-hidden
                      className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-sunken text-sm"
                    >
                      {TYPE_EMOJI[notification.type] ?? '🔔'}
                    </span>

                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          'text-sm text-pretty',
                          isUnread ? 'font-semibold text-content' : 'text-content-muted',
                        )}
                      >
                        {notification.title}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-content-subtle text-pretty">
                        {notification.body}
                      </p>
                      <p className="mt-1 text-[0.6875rem] text-content-subtle">
                        {formatRelative(notification.createdAt)}
                      </p>
                    </div>

                    {isUnread && (
                      <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
                    )}
                  </button>
                );
              })}
            </div>

            {feed && feed.items.length > 0 && (
              <footer className="border-t border-border p-2">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    navigate('/app/notifications');
                  }}
                  className="w-full rounded-lg py-2 text-center text-xs font-medium text-primary transition-colors hover:bg-surface-hover"
                >
                  View all notifications
                </button>
              </footer>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
