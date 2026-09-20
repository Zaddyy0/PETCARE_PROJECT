import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { APP_NAME, passwordSchema } from '@pawsitive/shared';
import { useAcceptInviteMutation } from '@/app/api/authApi';
import { errorCode, errorMessage } from '@/app/api/baseApi';
import { Button } from '@/design/Button';
import { Input } from '@/design/Field';
import { useZodForm } from '@/lib/useZodForm';

const formSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string().min(1, 'Please re-enter your password'),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

/**
 * Invitation acceptance — how doctors and admins get their accounts.
 *
 * Note there is no name or email field. Whoever invited them already set those,
 * and re-asking invites a typo that would quietly diverge from the clinic's
 * own records. All this page collects is a password.
 */
export default function AcceptInvitePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [acceptInvite, { isLoading, error }] = useAcceptInviteMutation();

  const token = searchParams.get('token') ?? '';

  const form = useZodForm({
    schema: formSchema,
    initialValues: { password: '', confirmPassword: '' },
    async onSubmit(values) {
      try {
        await acceptInvite({ token, password: values.password }).unwrap();
        /* The mutation establishes the session, so they land signed in. */
        navigate('/app', { replace: true });
      } catch (submitError) {
        form.applyServerErrors(submitError);
      }
    },
  });

  if (!token) {
    return (
      <div>
        <div aria-hidden className="mb-5 grid size-12 place-items-center rounded-xl bg-danger-soft text-2xl">
          🔗
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-content">
          This invitation link is incomplete
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-content-muted text-pretty">
          Ask whoever invited you to send a fresh invitation.
        </p>
        <Link
          to="/login"
          className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          <span aria-hidden>←</span> Back to sign in
        </Link>
      </div>
    );
  }

  const code = errorCode(error);

  return (
    <div>
      <div aria-hidden className="mb-5 grid size-12 place-items-center rounded-xl bg-primary-soft text-2xl">
        🎉
      </div>

      <h1 className="text-2xl font-semibold tracking-tight text-content">
        Welcome to {APP_NAME}
      </h1>
      <p className="mt-1.5 text-sm text-content-muted text-pretty">
        Set a password to activate your account.
      </p>

      {error && (
        <div
          role="alert"
          className="mt-5 rounded-lg border border-danger/25 bg-danger-soft px-3.5 py-3 text-sm text-danger"
        >
          {errorMessage(error)}

          {/* An already-used invitation is the common case here — somebody
              clicking the email a second time. Point them at sign-in rather
              than leaving them stuck. */}
          {(code === 'INVITE_INVALID' || code === 'INVITE_EXPIRED') && (
            <p className="mt-1 text-xs opacity-90">
              If you have already set a password,{' '}
              <Link to="/login" className="font-semibold underline">
                sign in instead
              </Link>
              .
            </p>
          )}
        </div>
      )}

      <form onSubmit={form.handleSubmit} className="mt-6 space-y-4" noValidate>
        <Input
          name="password"
          type="password"
          label="Choose a password"
          autoComplete="new-password"
          autoFocus
          required
          hint="At least 10 characters."
          value={form.values.password}
          onChange={(event) => form.setValue('password', event.target.value)}
          onBlur={() => form.handleBlur('password')}
          error={form.errorFor('password')}
        />

        <Input
          name="confirmPassword"
          type="password"
          label="Confirm password"
          autoComplete="new-password"
          required
          value={form.values.confirmPassword}
          onChange={(event) => form.setValue('confirmPassword', event.target.value)}
          onBlur={() => form.handleBlur('confirmPassword')}
          error={form.errorFor('confirmPassword')}
        />

        <Button type="submit" size="lg" fullWidth loading={isLoading || form.submitting}>
          Activate my account
        </Button>
      </form>
    </div>
  );
}
