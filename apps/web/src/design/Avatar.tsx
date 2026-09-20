import { useState } from 'react';
import { DEFAULT_PET_EMOJI, initials, type MediaAsset, type PetSpecies } from '@pawsitive/shared';
import { cn } from '@/lib/cn';

const SIZES = {
  xs: 'size-6 text-[0.625rem]',
  sm: 'size-8 text-xs',
  md: 'size-10 text-sm',
  lg: 'size-14 text-base',
  xl: 'size-20 text-xl',
  '2xl': 'size-28 text-3xl',
} as const;

export type AvatarSize = keyof typeof SIZES;

export interface AvatarProps {
  src?: string | undefined;
  name?: string;
  size?: AvatarSize;
  className?: string;
  /** Adds a ring — used to mark the signed-in user in a list. */
  ringed?: boolean;
}

/**
 * Derive a stable colour from a name.
 *
 * The same person always gets the same tint, which makes a list of initials
 * scannable rather than uniformly grey. Hashing the name means no colour has to
 * be stored, and it cannot drift from the record.
 */
function hueFor(name: string): number {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) % 360;
  }
  return hash;
}

export function Avatar({ src, name = '', size = 'md', className, ringed }: AvatarProps) {
  /**
   * Track image failure explicitly.
   *
   * A broken `<img>` renders as the browser's placeholder icon, which looks
   * like a bug. Falling back to initials on `onError` means a deleted or
   * expired asset degrades to something that still looks designed.
   */
  const [failed, setFailed] = useState(false);

  const parts = name.trim().split(/\s+/);
  const monogram = initials(parts[0] ?? '', parts[1] ?? parts[0] ?? '');
  const hue = hueFor(name || 'anonymous');

  return (
    <span
      className={cn(
        'relative inline-grid shrink-0 select-none place-items-center overflow-hidden rounded-full font-semibold',
        SIZES[size],
        ringed && 'ring-2 ring-primary ring-offset-2 ring-offset-surface',
        className,
      )}
      style={
        src && !failed
          ? undefined
          : {
              backgroundColor: `hsl(${hue} 68% 92%)`,
              color: `hsl(${hue} 55% 32%)`,
            }
      }
    >
      {src && !failed ? (
        <img
          src={src}
          /* Empty alt plus the name on the wrapper: the avatar is decorative
             next to a name that is already in the DOM, so announcing it twice
             is noise. */
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      ) : (
        <span aria-hidden>{monogram}</span>
      )}
      {name && <span className="sr-only">{name}</span>}
    </span>
  );
}

/**
 * A pet's photo, falling back to a species emoji.
 *
 * Better than generic initials for a pet: "BR" for Bruno means nothing, but a
 * 🐕 immediately says what kind of animal is in the row.
 */
export function PetAvatar({
  photo,
  name,
  species,
  size = 'md',
  className,
}: {
  photo?: MediaAsset | undefined;
  name: string;
  species: PetSpecies;
  size?: AvatarSize;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const url = photo?.thumbnailUrl ?? photo?.url;

  return (
    <span
      className={cn(
        'relative inline-grid shrink-0 select-none place-items-center overflow-hidden rounded-xl bg-surface-sunken',
        SIZES[size],
        className,
      )}
    >
      {url && !failed ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      ) : (
        <span aria-hidden className="leading-none" style={{ fontSize: '1.4em' }}>
          {DEFAULT_PET_EMOJI[species] ?? '🐾'}
        </span>
      )}
      <span className="sr-only">{name}</span>
    </span>
  );
}

/**
 * An overlapping stack, with a `+n` overflow chip.
 *
 * Reversed flex direction plus explicit `zIndex` puts the *first* avatar on
 * top, so the leftmost face is fully visible rather than half-covered by its
 * neighbour.
 */
export function AvatarStack({
  people,
  max = 4,
  size = 'sm',
}: {
  people: { name: string; src?: string | undefined }[];
  max?: number;
  size?: AvatarSize;
}) {
  const shown = people.slice(0, max);
  const overflow = people.length - shown.length;

  return (
    <div className="flex flex-row-reverse items-center justify-end">
      {overflow > 0 && (
        <span
          className={cn(
            'inline-grid place-items-center rounded-full border-2 border-surface bg-surface-sunken font-semibold text-content-muted',
            SIZES[size],
          )}
        >
          +{overflow}
        </span>
      )}
      {[...shown].reverse().map((person, index) => (
        <Avatar
          key={`${person.name}-${index}`}
          name={person.name}
          src={person.src}
          size={size}
          className="-mr-2 border-2 border-surface"
        />
      ))}
    </div>
  );
}
