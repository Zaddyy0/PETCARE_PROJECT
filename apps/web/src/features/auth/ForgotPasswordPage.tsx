import { Link } from 'react-router-dom';
import { forgotPasswordSchema, maskEmail } from '@pawsitive/shared';
import { useForgotPasswordMutation } from '@/app/api/authApi';
import { Button } from '@/design/Button';
import { Input } from '@/design/Field';
import { useZodForm } from '@/lib/useZodForm';

export default function ForgotPasswordPage() {
  const [requestReset, { isLoading, isSuccess }] = useForgotPasswordMutation();

  const form = useZodForm({
    schema: forgotPasswordSchema,
    initialValues: { email: '' },
    async onSubmit(values) {
      /* Deliberately unguarded: this endpoint always succeeds, whether or not
         the address is registered. See the confirmation copy below. */
      await requestReset(values).unwrap().catch(() => undefined);
    },
  });

  /**
   * The confirmation never says whether the account exists.
   *
   * The API is careful not to reveal that, and it would be undone entirely by a
   * client that showed "no account found" — so the copy is written to be true
   * either way. The masked address is echoed purely so someone who mistyped
   * their own email can spot it.
   */
  if (isSuccess) {
    return (
      <div>
        <div
          aria-hidden
          className="mb-5 grid size-12 place-items-center rounded-xl bg-success-soft text-2xl"
        >
          ✉️
        </div>

        <h1 className="text-2xl font-semibold tracking-tight text-content">Check your inbox</h1>

        <p className="mt-2 text-sm leading-relaxed text-content-muted text-pretty">
          If <span className="font-medium text-content">{maskEmail(String(form.values.email))}</span>{' '}
          has a Pawsitive account, a password reset link is on its way. It expires in 30 minutes
          and can be used once.
        </p>

        <p className="mt-4 text-sm text-content-subtle text-pretty">
          Nothing arrived? Check your spam folder, or{' '}
          <button
            type="button"
            onClick={() => void form.handleSubmit()}
            className="font-medium text-primary hover:underline"
          >
            send it again
          </button>
          .
        </p>

        <Link
          to="/login"
          className="mt-8 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          <span aria-hidden>←</span> Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-content">Reset your password</h1>
      <p className="mt-1.5 text-sm text-content-muted text-pretty">
        Enter your email and we will send you a link to choose a new one.
      </p>

      <form onSubmit={form.handleSubmit} className="mt-6 space-y-4" noValidate>
        <Input
          name="email"
          type="email"
          label="Email"
          autoComplete="email"
          autoFocus
          required
          placeholder="you@example.com"
          value={form.values.email}
          onChange={(event) => form.setValue('email', event.target.value)}
          onBlur={() => form.handleBlur('email')}
          error={form.errorFor('email')}
        />

        <Button type="submit" size="lg" fullWidth loading={isLoading || form.submitting}>
          Send reset link
        </Button>
      </form>

      <Link
        to="/login"
        className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-content-muted hover:text-content"
      >
        <span aria-hidden>←</span> Back to sign in
      </Link>
    </div>
  );
}
