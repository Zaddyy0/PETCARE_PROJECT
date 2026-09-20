import { EmptyState } from '@/design/EmptyState';

/**
 * A stand-in for pages built in phase 4.
 *
 * Deliberately explicit that the route exists and is not yet implemented,
 * rather than a blank screen or a 404. A route that resolves to nothing is
 * indistinguishable from a bug, and this way the navigation can be walked and
 * reviewed end to end before the pages behind it are written.
 */
export function PlaceholderPage({
  title,
  description,
  illustration = '🚧',
}: {
  title: string;
  description?: string;
  illustration?: string;
}) {
  return (
    <EmptyState
      illustration={illustration}
      title={title}
      description={
        description ??
        'This screen is next up. The API behind it is complete and tested — the interface lands in the next phase.'
      }
    />
  );
}

/* One factory per route, so the route table stays declarative. */
export const makePlaceholder = (title: string, illustration?: string) =>
  function Placeholder() {
    return <PlaceholderPage title={title} {...(illustration ? { illustration } : {})} />;
  };
