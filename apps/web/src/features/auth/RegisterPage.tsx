import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { registerSchema, type RegisterInput } from '@pawsitive/shared';
import { useRegisterMutation } from '@/app/api/authApi';
import { errorCode, errorMessage } from '@/app/api/baseApi';
import { Button } from '@/design/Button';
import { Checkbox, Input } from '@/design/Field';
import { cn } from '@/lib/cn';
import { useZodForm } from '@/lib/useZodForm';

/**
 * Password strength, scored the way the policy actually works.
 *
 * Length is weighted far above character classes, matching the reasoning in the
 * shared `passwordSchema`: a long passphrase beats a short one with a symbol
 * bolted on. A meter that rewards `P@ss1!` over `correct horse battery` teaches
 * people the wrong lesson.
 */
function scorePassword(password: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  if (!password) return { score: 0, label: '' };

  let score = 0;

  if (password.length >= 10) score += 1;
  if (password.length >= 14) score += 1;
  if (password.length >= 20) score += 1;

  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) =>
    pattern.test(password),
  ).length;

  if (classes >= 3) score += 1;

  /* Obvious patterns cap the score regardless of length. */
  if (/^(.)\1+$/.test(password) || /^(012|123|abc|qwe|password)/i.test(password)) {
    score = 0;
  }

  const clamped = Math.min(4, score) as 0 | 1 | 2 | 3 | 4;
  const labels = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'] as const;

  return { score: clamped, label: labels[clamped] };
}

export default function RegisterPage() {
  const navigate = useNavigate();
  const [register, { isLoading, error }] = useRegisterMutation();
  const [showPassword, setShowPassword] = useState(false);

  const form = useZodForm({
    schema: registerSchema,
    initialValues: {
      firstName: '',
      lastName: '',
      email: '',
      password: '',
      acceptedTerms: false,
    } as unknown as RegisterInput,
    async onSubmit(values) {
      try {
        await register(values).unwrap();
        /* Straight into the app — a new client's next step is adding a pet. */
        navigate('/app/pets/new', { replace: true });
      } catch (submitError) {
        form.applyServerErrors(submitError);
      }
    },
  });

  const strength = useMemo(
    () => scorePassword(String(form.values.password ?? '')),
    [form.values.password],
  );

  const code = errorCode(error);

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-content">Create your account</h1>
      <p className="mt-1.5 text-sm text-content-muted">
        Free for pet parents. Takes about a minute.
      </p>

      {error && code !== 'VALIDATION_FAILED' && (
        <div
          role="alert"
          className="mt-5 rounded-lg border border-danger/25 bg-danger-soft px-3.5 py-3 text-sm text-danger"
        >
          {errorMessage(error, 'We could not create your account.')}

          {code === 'EMAIL_ALREADY_REGISTERED' && (
            <p className="mt-1 text-xs opacity-90">
              <Link to="/login" className="font-semibold underline">
                Sign in instead
              </Link>{' '}
              or reset your password.
            </p>
          )}
        </div>
      )}

      <form onSubmit={form.handleSubmit} className="mt-6 space-y-4" noValidate>
        <div className="grid grid-cols-2 gap-3">
          <Input
            name="firstName"
            label="First name"
            autoComplete="given-name"
            autoFocus
            required
            value={form.values.firstName}
            onChange={(event) => form.setValue('firstName', event.target.value)}
            onBlur={() => form.handleBlur('firstName')}
            error={form.errorFor('firstName')}
          />
          <Input
            name="lastName"
            label="Last name"
            autoComplete="family-name"
            required
            value={form.values.lastName}
            onChange={(event) => form.setValue('lastName', event.target.value)}
            onBlur={() => form.handleBlur('lastName')}
            error={form.errorFor('lastName')}
          />
        </div>

        <Input
          name="email"
          type="email"
          label="Email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          value={form.values.email}
          onChange={(event) => form.setValue('email', event.target.value)}
          onBlur={() => form.handleBlur('email')}
          error={form.errorFor('email')}
        />

        <div>
          <Input
            name="password"
            type={showPassword ? 'text' : 'password'}
            label="Password"
            autoComplete="new-password"
            required
            hint="At least 10 characters. Longer beats complicated."
            value={form.values.password}
            onChange={(event) => form.setValue('password', event.target.value)}
            onBlur={() => form.handleBlur('password')}
            error={form.errorFor('password')}
            trailingSlot={
              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="grid size-8 place-items-center rounded-md text-content-subtle hover:bg-surface-hover hover:text-content"
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="size-4">
                  <path d="M2 8s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4Zm6 1.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" strokeLinecap="round" />
                </svg>
              </button>
            }
          />

          {/* The meter appears only once there is something to measure. */}
          {form.values.password && (
            <div className="mt-2 flex items-center gap-2">
              <div className="flex flex-1 gap-1" aria-hidden>
                {[0, 1, 2, 3].map((segment) => (
                  <span
                    key={segment}
                    className={cn(
                      'h-1 flex-1 rounded-full transition-colors duration-base',
                      segment < strength.score
                        ? strength.score <= 1
                          ? 'bg-danger'
                          : strength.score === 2
                            ? 'bg-warning'
                            : strength.score === 3
                              ? 'bg-info'
                              : 'bg-success'
                        : 'bg-surface-sunken',
                    )}
                  />
                ))}
              </div>
              {/* `aria-live="polite"` so the verdict is announced without
                  interrupting typing. */}
              <span
                aria-live="polite"
                className={cn(
                  'w-16 text-right text-[0.6875rem] font-medium',
                  strength.score <= 1
                    ? 'text-danger'
                    : strength.score === 2
                      ? 'text-warning'
                      : strength.score === 3
                        ? 'text-info'
                        : 'text-success',
                )}
              >
                {strength.label}
              </span>
            </div>
          )}
        </div>

        <Checkbox
          name="acceptedTerms"
          checked={Boolean(form.values.acceptedTerms)}
          /**
           * Cast because the shared schema types this as `z.literal(true)`.
           *
           * That is correct for the *wire* contract — the API must only ever
           * accept `true` — but the checkbox has to be able to hold `false`
           * while unticked. The cast lets the form carry the intermediate
           * state, and the schema rejects `false` on submit, which is exactly
           * the behaviour we want.
           */
          onChange={(event) => form.setValue('acceptedTerms', event.target.checked as true)}
          error={form.errorFor('acceptedTerms')}
          label={
            <>
              I agree to the{' '}
              <Link to="/terms" className="font-medium text-primary hover:underline">
                terms of service
              </Link>{' '}
              and{' '}
              <Link to="/privacy" className="font-medium text-primary hover:underline">
                privacy policy
              </Link>
              .
            </>
          }
        />

        <Button type="submit" size="lg" fullWidth loading={isLoading || form.submitting}>
          Create account
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-content-muted">
        Already have an account?{' '}
        <Link to="/login" className="font-semibold text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
