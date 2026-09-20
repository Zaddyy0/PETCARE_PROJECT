import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { loginSchema, type LoginInput } from '@pawsitive/shared';
import { useLoginMutation } from '@/app/api/authApi';
import { errorCode, errorMessage } from '@/app/api/baseApi';
import { Button } from '@/design/Button';
import { Checkbox, Input } from '@/design/Field';
import { useZodForm } from '@/lib/useZodForm';

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [login, { isLoading, error }] = useLoginMutation();
  const [showPassword, setShowPassword] = useState(false);

  /* Set by `RequireAuth` when an unauthenticated user hit a protected URL. */
  const returnTo = (location.state as { from?: { pathname: string } } | null)?.from?.pathname;

  const form = useZodForm({
    schema: loginSchema,
    initialValues: { email: '', password: '', rememberMe: false } as LoginInput,
    async onSubmit(values) {
      try {
        await login(values).unwrap();
        navigate(returnTo ?? '/app', { replace: true });
      } catch (submitError) {
        form.applyServerErrors(submitError);
      }
    },
  });

  const code = errorCode(error);

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-content">Welcome back</h1>
      <p className="mt-1.5 text-sm text-content-muted">
        Sign in to manage your pets and appointments.
      </p>

      {/**
       * A form-level error, above the fields.
       *
       * Shown only for failures that are not field-specific. Invalid
       * credentials is deliberately *not* attached to either input — the server
       * will not say which one was wrong (that would be a user-enumeration
       * oracle), so pinning it to the password field would be a guess.
       */}
      {error && !code?.includes('VALIDATION') && (
        <div
          role="alert"
          className="mt-5 rounded-lg border border-danger/25 bg-danger-soft px-3.5 py-3 text-sm text-danger"
        >
          {errorMessage(error, 'We could not sign you in.')}

          {/* A locked account needs a next step, not just a refusal. */}
          {code === 'ACCOUNT_LOCKED' && (
            <p className="mt-1 text-xs opacity-90">
              You can{' '}
              <Link to="/forgot-password" className="font-semibold underline">
                reset your password
              </Link>{' '}
              to regain access immediately.
            </p>
          )}
        </div>
      )}

      <form onSubmit={form.handleSubmit} className="mt-6 space-y-4" noValidate>
        <Input
          name="email"
          type="email"
          label="Email"
          /* `username` rather than `email`, which is what password managers
             look for when pairing with a password field. */
          autoComplete="username"
          autoFocus
          required
          placeholder="you@example.com"
          value={form.values.email}
          onChange={(event) => form.setValue('email', event.target.value)}
          onBlur={() => form.handleBlur('email')}
          error={form.errorFor('email')}
          leadingIcon={
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d="M2 4.5h12v7H2v-7Zm0 .5 6 4 6-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          }
        />

        <Input
          name="password"
          type={showPassword ? 'text' : 'password'}
          label="Password"
          autoComplete="current-password"
          required
          placeholder="••••••••••"
          value={form.values.password}
          onChange={(event) => form.setValue('password', event.target.value)}
          onBlur={() => form.handleBlur('password')}
          error={form.errorFor('password')}
          leadingIcon={
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path
                d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2M3.5 7h9v6h-9V7Z"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          }
          trailingSlot={
            <button
              type="button"
              onClick={() => setShowPassword((current) => !current)}
              /* A genuine accessibility win on mobile, where typos in a masked
                 field are common and invisible. */
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="grid size-8 place-items-center rounded-md text-content-subtle transition-colors hover:bg-surface-hover hover:text-content"
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="size-4">
                {showPassword ? (
                  <path d="M2 8s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4Zm6 1.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM2.5 2.5l11 11" strokeLinecap="round" />
                ) : (
                  <path d="M2 8s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4Zm6 1.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" strokeLinecap="round" />
                )}
              </svg>
            </button>
          }
        />

        <div className="flex items-center justify-between">
          <Checkbox
            name="rememberMe"
            label="Keep me signed in"
            checked={form.values.rememberMe ?? false}
            onChange={(event) => form.setValue('rememberMe', event.target.checked)}
          />

          <Link
            to="/forgot-password"
            className="text-sm font-medium text-primary transition-colors hover:underline"
          >
            Forgot password?
          </Link>
        </div>

        <Button type="submit" size="lg" fullWidth loading={isLoading || form.submitting}>
          Sign in
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-content-muted">
        New to Pawsitive?{' '}
        <Link to="/register" className="font-semibold text-primary hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
