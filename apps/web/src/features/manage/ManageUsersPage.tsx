import { motion } from 'framer-motion';
import { useState } from 'react';
import {
  ROLES,
  ROLE_LABELS,
  Role,
  USER_STATUSES,
  formatRelative,
  type Role as RoleType,
  type User,
  type UserStatus,
} from '@pawsitive/shared';
import {
  useReactivateUserMutation,
  useResendInviteMutation,
  useSuspendUserMutation,
} from '@/app/api/userApi';
import { useListUsersQuery } from '@/app/api/userApi';
import { useImpersonateMutation } from '@/app/api/authApi';
import { errorMessage } from '@/app/api/baseApi';
import { useAppDispatch, useAppSelector, useCan } from '@/app/hooks';
import { selectRole } from '@/app/slices/authSlice';
import { toastSuccess } from '@/app/slices/toastSlice';
import { Avatar } from '@/design/Avatar';
import { Badge } from '@/design/Badge';
import { Button } from '@/design/Button';
import { Card } from '@/design/Card';
import { EmptyState, ErrorState } from '@/design/EmptyState';
import { Modal } from '@/design/Modal';
import { PageHeader } from '@/design/PageHeader';
import { Pagination } from '@/design/Pagination';
import { SkeletonTable } from '@/design/Skeleton';
import { Textarea } from '@/design/Field';
import { FilterChips, SearchInput, Toolbar } from '@/design/Toolbar';
import { cn } from '@/lib/cn';
import { staggerContainer, staggerItem } from '@/lib/motion';
import { useNavigate } from 'react-router-dom';

const STATUS_TONES = {
  active: 'success',
  invited: 'info',
  suspended: 'danger',
  deactivated: 'neutral',
} as const;

const ROLE_TONES = {
  client: 'neutral',
  doctor: 'info',
  admin: 'primary',
  super_admin: 'accent',
} as const;

/**
 * User administration.
 *
 * Every destructive action here is gated twice: the button is hidden unless the
 * caller holds the permission, *and* the server re-checks rank — an admin
 * cannot suspend a peer or a super admin regardless of what the UI offers. The
 * hiding is courtesy; the server is the boundary.
 */
export default function ManageUsersPage() {
  const viewerRole = useAppSelector(selectRole);
  const canSuspend = useCan('user:suspend');
  const canInvite = useCan('user:create');
  const canImpersonate = useCan('user:impersonate');

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<RoleType | 'all'>('all');
  const [status, setStatus] = useState<UserStatus | 'all'>('all');

  const [suspending, setSuspending] = useState<User | null>(null);

  const { data, isLoading, isFetching, error, refetch } = useListUsersQuery({
    page,
    limit: 20,
    ...(search ? { search } : {}),
    ...(role !== 'all' ? { role } : {}),
    ...(status !== 'all' ? { status } : {}),
  });

  const resetAndSet = <T,>(setter: (value: T) => void) => (value: T) => {
    setPage(1);
    setter(value);
  };

  return (
    <div>
      <PageHeader
        title="People"
        description="Clients, clinicians and administrators."
        actions={
          canInvite && (
            <Button variant="primary" disabled>
              Invite someone
            </Button>
          )
        }
      />

      <Toolbar>
        <SearchInput
          value={search}
          onChange={resetAndSet(setSearch)}
          placeholder="Search by name or email…"
          loading={isFetching && !isLoading}
          className="sm:max-w-xs"
        />

        <FilterChips
          label="Role"
          options={[
            { value: 'all' as const, label: 'All roles' },
            ...ROLES.map((value) => ({ value, label: ROLE_LABELS[value] })),
          ]}
          value={role}
          onChange={resetAndSet(setRole)}
        />

        <select
          value={status}
          onChange={(event) => resetAndSet(setStatus)(event.target.value as UserStatus | 'all')}
          aria-label="Filter by status"
          className="h-10 rounded-lg border border-border bg-surface px-3 text-sm text-content sm:ml-auto"
        >
          <option value="all">Any status</option>
          {USER_STATUSES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </Toolbar>

      {isLoading && <SkeletonTable rows={8} columns={5} />}

      {error && (
        <ErrorState
          title="We could not load the list"
          description={errorMessage(error)}
          onRetry={() => void refetch()}
        />
      )}

      {data && data.items.length === 0 && (
        <EmptyState illustration="🔍" title="Nobody matches those filters" />
      )}

      {data && data.items.length > 0 && (
        <>
          {/**
           * A card list, not a `<table>`.
           *
           * A five-column table is unusable below ~700px, and the horizontal
           * scroll every admin console falls back to is worse than stacking.
           * Cards reflow; the desktop layout still reads as rows.
           */}
          <motion.ul
            variants={staggerContainer(0.02)}
            initial="hidden"
            animate="visible"
            className="space-y-2"
          >
            {data.items.map((user) => (
              <motion.li key={user.id} variants={staggerItem}>
                <UserRow
                  user={user}
                  viewerRole={viewerRole}
                  canSuspend={canSuspend}
                  canImpersonate={canImpersonate}
                  onRequestSuspend={() => setSuspending(user)}
                />
              </motion.li>
            ))}
          </motion.ul>

          <Pagination pagination={data.pagination} onPageChange={setPage} />
        </>
      )}

      <SuspendDialog user={suspending} onClose={() => setSuspending(null)} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function UserRow({
  user,
  viewerRole,
  canSuspend,
  canImpersonate,
  onRequestSuspend,
}: {
  user: User;
  viewerRole: RoleType | null;
  canSuspend: boolean;
  canImpersonate: boolean;
  onRequestSuspend: () => void;
}) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  const [reactivate, { isLoading: reactivating }] = useReactivateUserMutation();
  const [resendInvite, { isLoading: resending }] = useResendInviteMutation();
  const [impersonate, { isLoading: impersonating }] = useImpersonateMutation();

  /**
   * Mirror the server's rank rule locally.
   *
   * Strictly-greater rank, with a super admin outranking everyone. Getting this
   * wrong here only means offering a button that 403s, but that is still a
   * worse experience than not showing it.
   */
  const rank = { client: 10, doctor: 20, admin: 30, super_admin: 40 } as const;
  const canActOnThisUser =
    viewerRole === Role.SUPER_ADMIN ||
    (viewerRole ? rank[viewerRole] > rank[user.role] : false);

  return (
    <Card padding="sm" className="flex flex-wrap items-center gap-3">
      <Avatar name={user.fullName} src={user.avatar?.thumbnailUrl} size="md" />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-medium text-content">{user.fullName}</p>
          <Badge tone={ROLE_TONES[user.role]} size="sm">
            {ROLE_LABELS[user.role]}
          </Badge>
          <Badge tone={STATUS_TONES[user.status]} size="sm" dot>
            {user.status}
          </Badge>
        </div>

        <p className="truncate text-xs text-content-subtle">{user.email}</p>
      </div>

      <div className="hidden text-right text-xs text-content-subtle lg:block">
        <p>
          {user.lastLoginAt
            ? `Last seen ${formatRelative(user.lastLoginAt)}`
            : 'Never signed in'}
        </p>
        <p>Joined {new Date(user.createdAt).toLocaleDateString()}</p>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {/* Only offered for an account that is actually waiting on one. */}
        {user.status === 'invited' && canSuspend && canActOnThisUser && (
          <Button
            size="sm"
            variant="ghost"
            loading={resending}
            onClick={async () => {
              const result = await resendInvite(user.id).unwrap().catch(() => null);
              if (result) {
                dispatch(
                  toastSuccess(
                    result.delivered ? 'Invitation resent' : 'Invitation regenerated',
                    result.delivered ? undefined : 'Email delivery is not configured.',
                  ),
                );
              }
            }}
          >
            Resend invite
          </Button>
        )}

        {canImpersonate && user.role !== Role.SUPER_ADMIN && (
          <Button
            size="sm"
            variant="ghost"
            loading={impersonating}
            onClick={async () => {
              const reason = window.prompt(
                `Why are you viewing as ${user.fullName}? This is recorded in the audit log.`,
              );

              /* The reason is mandatory server-side, so an empty prompt is
                 abandoned rather than sent. */
              if (!reason || reason.trim().length < 10) return;

              const session = await impersonate({ userId: user.id, reason: reason.trim() })
                .unwrap()
                .catch(() => null);

              if (session) navigate('/app');
            }}
          >
            View as
          </Button>
        )}

        {canSuspend &&
          canActOnThisUser &&
          (user.status === 'suspended' ? (
            <Button
              size="sm"
              variant="outline"
              loading={reactivating}
              onClick={async () => {
                await reactivate(user.id).unwrap().catch(() => undefined);
                dispatch(toastSuccess(`${user.firstName} can sign in again`));
              }}
            >
              Reactivate
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={onRequestSuspend}>
              Suspend
            </Button>
          ))}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

function SuspendDialog({ user, onClose }: { user: User | null; onClose: () => void }) {
  const dispatch = useAppDispatch();
  const [reason, setReason] = useState('');
  const [suspend, { isLoading }] = useSuspendUserMutation();

  async function onConfirm() {
    if (!user || reason.trim().length < 5) return;

    const result = await suspend({ id: user.id, reason: reason.trim() })
      .unwrap()
      .catch(() => null);

    if (result) {
      /* Surfacing the session count makes the immediacy concrete — the admin
         sees that the suspension took effect now, not at token expiry. */
      dispatch(
        toastSuccess(
          `${user.firstName} has been suspended`,
          `${result.revokedSessions} active session${result.revokedSessions === 1 ? '' : 's'} ended immediately.`,
        ),
      );
      setReason('');
      onClose();
    }
  }

  return (
    <Modal
      open={Boolean(user)}
      onClose={onClose}
      title={user ? `Suspend ${user.fullName}?` : 'Suspend'}
      description="They will be signed out of every device immediately and cannot sign in again until reactivated."
      size="sm"
      dismissible={!isLoading}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={isLoading}
            disabled={reason.trim().length < 5}
            onClick={() => void onConfirm()}
          >
            Suspend account
          </Button>
        </>
      }
    >
      <Textarea
        name="reason"
        label="Reason"
        required
        rows={3}
        maxLength={300}
        showCount
        placeholder="Repeated no-shows despite reminders."
        hint="Recorded in the audit log and emailed to the account holder."
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />

      {user?.role === Role.DOCTOR && (
        <p className="mt-3 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning text-pretty">
          This clinician will also stop accepting new bookings. Existing appointments are not
          cancelled — reassign them separately.
        </p>
      )}
    </Modal>
  );
}
