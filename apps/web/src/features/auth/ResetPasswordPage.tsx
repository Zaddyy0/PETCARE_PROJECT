import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { passwordSchema } from '@pawsitive/shared';
import { useResetPasswordMutation } from '@/app/api/authApi';
import { errorCode, errorMessage } from '@/app/api/baseApi';
import { Button } from '@/design/Button';
import { Input } from '@/design/Field';
import { useZodForm } from '@/lib/useZodForm';

/**
 * Extends the shared schema with a confirmation field.
 *
 * The confirmation is a client-only concern — the API has no use for it, so it
 * does not belong in the shared schema. Composing locally keeps the strength
 * policy shared while the UX affordance stays here.
 */
const formSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string().min(1, 'Please re-enter your password'),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [resetPassword, { isLoading, error }] = useResetPasswordMutation();
  const [done, setDone] = useState(false);

  const token = searchParams.get('token') ?? '';

  const form = useZodForm({
    schema: formSchema,
    initialValues: { password: '', confirmPassword: '' },
    async onSubmit(values) {
      try {
        await resetPassword({ token, password: values.password }).unwrap();
        setDone(true);
      } catch (submitError) {
        form.applyServerErrors(submitError);
      }
    },
  });

  /**
   * A missing token is caught before the form is rendered.
   *
   * Someone who lands here without one — a truncated email link, a copy-paste
   * that dropped the query string — should be told that plainly rather than
   * filling in a form that cannot possibly succeed.
   */
  if (!token) {
    return (
      <div>
        <div aria-hidden className="mb-5 grid size-12 place-items-center rounded-xl bg-danger-soft text-2xl">
          🔗
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-content">
          This link is incomplete
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-content-muted text-pretty">
          The reset link appears to have been cut short. Email clients sometimes break long links —
          try copying the whole thing, or request a new one.
        </p>
        <Link
          to="/forgot-password"
          className="mt-6 inline-block rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-fg hover:bg-primary-hover"
        >
          Request a new link
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div>
        <div aria-hidden className="mb-5 grid size-12 place-items-center rounded-xl bg-success-soft text-2xl">
          ✅
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-content">Password updated</h1>
        <p className="mt-2 text-sm leading-relaxed text-content-muted text-pretty">
          {/* Worth stating explicitly — the server revokes every session on a
              password change, and a user who was signed in elsewhere should
              know why they have been signed out. */}
          For your security we signed you out everywhere. Sign in with your new password to
          continue.
        </p>
        <Button size="lg" fullWidth className="mt-6" onClick={() => navigate('/login')}>
          Go to sign in
        </Button>
      </div>
    );
  }

  const code = errorCode(error);

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-content">Choose a new password</h1>
      <p className="mt-1.5 text-sm text-content-muted">
        Make it long. Length matters more than symbols.
      </p>

      {error && (
        <div
          role="alert"
          className="mt-5 rounded-lg border border-danger/25 bg-danger-soft px-3.5 py-3 text-sm text-danger"
        >
          {errorMessage(error)}
          {code === 'PASSWORD_RESET_INVALID' && (
            <p className="mt-1 text-xs opacity-90">
              <Link to="/forgot-password" className="font-semibold underline">
                Request a fresh link
              </Link>{' '}
              — reset links expire after 30 minutes and work only once.
            </p>
          )}
        </div>
      )}

      <form onSubmit={form.handleSubmit} className="mt-6 space-y-4" noValidate>
        <Input
          name="password"
          type="password"
          label="New password"
          autoComplete="new-password"
          autoFocus
          required
          value={form.values.password}
          onChange={(event) => form.setValue('password', event.target.value)}
          onBlur={() => form.handleBlur('password')}
          error={form.errorFor('password')}
        />

        <Input
          name="confirmPassword"
          type="password"
          label="Confirm new password"
          autoComplete="new-password"
          required
          value={form.values.confirmPassword}
          onChange={(event) => form.setValue('confirmPassword', event.target.value)}
          onBlur={() => form.handleBlur('confirmPassword')}
          error={form.errorFor('confirmPassword')}
        />

        <Button type="submit" size="lg" fullWidth loading={isLoading || form.submitting}>
          Update password
        </Button>
      </form>
    </div>
  );
}
