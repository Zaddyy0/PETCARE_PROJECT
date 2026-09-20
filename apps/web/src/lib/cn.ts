/**
 * Class-name composition.
 *
 * Deliberately *not* `clsx` + `tailwind-merge`. Those two packages add ~8kB to
 * solve a problem this codebase does not have: conflicting Tailwind classes
 * only arise when a component both sets a default and accepts an override for
 * the same property. The components here take variant props instead, so the
 * caller picks a variant rather than fighting the base classes.
 *
 * Where an override genuinely is needed, the component documents which classes
 * are safe to pass.
 */
export type ClassValue =
  | string
  | number
  | null
  | undefined
  | false
  | ClassValue[]
  | Record<string, boolean | null | undefined>;

export function cn(...values: ClassValue[]): string {
  const classes: string[] = [];

  for (const value of values) {
    if (!value) continue;

    if (typeof value === 'string' || typeof value === 'number') {
      classes.push(String(value));
      continue;
    }

    if (Array.isArray(value)) {
      const nested = cn(...value);
      if (nested) classes.push(nested);
      continue;
    }

    for (const [key, enabled] of Object.entries(value)) {
      if (enabled) classes.push(key);
    }
  }

  return classes.join(' ');
}
