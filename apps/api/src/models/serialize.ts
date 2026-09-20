/**
 * Document serialisation.
 *
 * Every model needs the same two things on the way out: `_id` renamed to `id`
 * (clients should not care that the store is Mongo, and `_id` is awkward in
 * JavaScript), and internal fields stripped.
 *
 * Mongoose types a transform's `ret` parameter as the *document* type, which
 * has no string index signature, so deleting keys from it does not typecheck.
 * That loosening is confined to this one function rather than repeated — and
 * silently re-derived — in all eleven models.
 */

/**
 * The minimum surface we need from a schema.
 *
 * Declared structurally rather than as `Schema<...>` because Mongoose's schema
 * type carries seven generic parameters that vary per model — a schema with
 * instance methods (`User`) does not unify with one without them (`Pet`), so
 * any concrete `Schema<A, B, C>` annotation rejects half the models. All this
 * helper actually touches is `set`.
 */
interface TransformableSchema {
  set(key: 'toJSON' | 'toObject', value: Record<string, unknown>): unknown;
}

/** Fields no model should ever emit. */
const ALWAYS_OMIT = ['__v'] as const;

export interface TransformOptions {
  /** Additional fields to drop for this model. */
  omit?: readonly string[];
  /** Include Mongoose virtuals such as `fullName`. Defaults to true. */
  virtuals?: boolean;
}

/**
 * Attach the standard `toJSON` / `toObject` transform to a schema.
 *
 * Applied to both because `toObject()` feeds the DTO mappers while `toJSON()`
 * feeds any accidental `res.json(doc)`. If only one were covered, the other
 * would be the leak.
 */
export function applyStandardTransform(
  schema: TransformableSchema,
  options: TransformOptions = {},
): void {
  const omit = [...ALWAYS_OMIT, ...(options.omit ?? [])];
  const virtuals = options.virtuals ?? true;

  /* eslint-disable @typescript-eslint/no-explicit-any -- see the file header. */
  const transform = (_doc: any, ret: any): any => {
    if (ret && typeof ret === 'object') {
      if (ret._id !== undefined) {
        ret.id = String(ret._id);
        delete ret._id;
      }

      for (const field of omit) {
        delete ret[field];
      }
    }

    return ret;
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */

  schema.set('toJSON', { virtuals, transform });
  schema.set('toObject', { virtuals, transform });
}
