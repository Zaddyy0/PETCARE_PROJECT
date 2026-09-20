import { useCallback, useState } from 'react';
import type { ZodTypeAny, z } from 'zod';
import { fieldErrors } from '@/app/api/baseApi';

/**
 * A form bound to a Zod schema — the *same* schema the API validates with.
 *
 * This is the payoff for putting schemas in `@pawsitive/shared`. The client and
 * the server cannot disagree about what is valid, so a user never gets past
 * client-side validation only to be rejected by the server for a rule the form
 * did not know about. Password policy, name characters, slot windows — one
 * definition, both sides.
 *
 * Deliberately not react-hook-form. This needs schema validation, per-field
 * errors, and merging server-side field errors back onto inputs; that is ~120
 * lines, against a dependency whose main value is uncontrolled-input
 * performance this app does not need.
 *
 * ## Validation timing
 *
 * Validate on **blur and submit**, never on every keystroke. Showing "invalid
 * email" while someone is still typing the second character is hostile — the
 * field is not wrong yet, it is unfinished. A field that has been touched *and*
 * blurred is fair game.
 */

export interface UseZodFormOptions<TSchema extends ZodTypeAny> {
  schema: TSchema;
  initialValues: z.input<TSchema>;
  onSubmit: (values: z.output<TSchema>) => Promise<void> | void;
}

export interface UseZodFormResult<TSchema extends ZodTypeAny> {
  values: z.input<TSchema>;
  errors: Record<string, string>;
  touched: Record<string, boolean>;
  submitting: boolean;
  /** Sets a value and clears that field's error. */
  setValue: <K extends keyof z.input<TSchema>>(field: K, value: z.input<TSchema>[K]) => void;
  /** Marks a field touched and validates it. Wire to `onBlur`. */
  handleBlur: (field: keyof z.input<TSchema>) => void;
  handleSubmit: (event?: React.FormEvent) => Promise<void>;
  /** Merges server-side field errors onto the inputs. */
  applyServerErrors: (error: unknown) => void;
  /** The error to display for a field — only once touched. */
  errorFor: (field: keyof z.input<TSchema>) => string | undefined;
  reset: () => void;
}

export function useZodForm<TSchema extends ZodTypeAny>({
  schema,
  initialValues,
  onSubmit,
}: UseZodFormOptions<TSchema>): UseZodFormResult<TSchema> {
  const [values, setValues] = useState<z.input<TSchema>>(initialValues);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);

  const setValue = useCallback(
    <K extends keyof z.input<TSchema>>(field: K, value: z.input<TSchema>[K]) => {
      setValues((current) => ({ ...current, [field]: value }));

      /* Clear the error as soon as the user edits the field. Leaving it up
         while they fix it is the thing that makes forms feel like they are
         arguing with you. */
      setErrors((current) => {
        if (!current[field as string]) return current;
        const next = { ...current };
        delete next[field as string];
        return next;
      });
    },
    [],
  );

  /**
   * Validate one field by parsing the whole object and keeping only this
   * field's issues.
   *
   * Parsing the whole form is necessary because cross-field rules exist —
   * "passwords must differ", "a custom period needs a start date" — and a
   * single field cannot be checked in isolation. Filtering the issues is what
   * keeps us from lighting up every empty field the moment one is blurred.
   */
  const validateField = useCallback(
    (field: keyof z.input<TSchema>) => {
      const result = schema.safeParse(values);
      if (result.success) return;

      const issue = result.error.issues.find((candidate) => candidate.path[0] === field);

      setErrors((current) => {
        const next = { ...current };
        if (issue) {
          next[field as string] = issue.message;
        } else {
          delete next[field as string];
        }
        return next;
      });
    },
    [schema, values],
  );

  const handleBlur = useCallback(
    (field: keyof z.input<TSchema>) => {
      setTouched((current) => ({ ...current, [field as string]: true }));
      validateField(field);
    },
    [validateField],
  );

  const handleSubmit = useCallback(
    async (event?: React.FormEvent) => {
      event?.preventDefault();

      const result = schema.safeParse(values);

      if (!result.success) {
        /* On submit, show everything and mark it all touched — at this point
           the user has declared the form finished, so every problem is
           relevant. */
        const collected: Record<string, string> = {};
        const allTouched: Record<string, boolean> = {};

        for (const issue of result.error.issues) {
          const key = issue.path.join('.') || '_root';
          collected[key] ??= issue.message;
          allTouched[key] = true;
        }

        setErrors(collected);
        setTouched((current) => ({ ...current, ...allTouched }));

        /**
         * Move focus to the first invalid field.
         *
         * On a long form the error may be off screen, and a submit that
         * appears to do nothing is indistinguishable from a broken button.
         */
        const firstKey = Object.keys(collected)[0];
        if (firstKey) {
          requestAnimationFrame(() => {
            const element = document.querySelector<HTMLElement>(`[name="${firstKey}"]`);
            element?.focus();
            element?.scrollIntoView({ block: 'center', behavior: 'smooth' });
          });
        }

        return;
      }

      setSubmitting(true);

      try {
        await onSubmit(result.data as z.output<TSchema>);
      } finally {
        /* Always clears, so a thrown error cannot leave the button spinning
           forever with no way to retry. */
        setSubmitting(false);
      }
    },
    [schema, values, onSubmit],
  );

  /**
   * Merge the server's field errors onto the form.
   *
   * The server validates with the same schema, so this normally only fires for
   * rules the client *cannot* check — an email already being taken, a slot
   * being claimed between render and submit.
   */
  const applyServerErrors = useCallback((error: unknown) => {
    const fields = fieldErrors(error);
    if (Object.keys(fields).length === 0) return;

    setErrors((current) => ({ ...current, ...fields }));
    setTouched((current) => ({
      ...current,
      ...Object.fromEntries(Object.keys(fields).map((key) => [key, true])),
    }));
  }, []);

  const errorFor = useCallback(
    (field: keyof z.input<TSchema>) =>
      touched[field as string] ? errors[field as string] : undefined,
    [errors, touched],
  );

  const reset = useCallback(() => {
    setValues(initialValues);
    setErrors({});
    setTouched({});
    setSubmitting(false);
  }, [initialValues]);

  return {
    values,
    errors,
    touched,
    submitting,
    setValue,
    handleBlur,
    handleSubmit,
    applyServerErrors,
    errorFor,
    reset,
  };
}
