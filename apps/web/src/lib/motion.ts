/**
 * Motion vocabulary.
 *
 * A small set of named variants, used everywhere. The alternative — each
 * component inventing its own durations and offsets — is what makes an
 * animated interface feel busy rather than polished: six slightly different
 * fade timings read as jitter, not personality.
 *
 * Three rules the values encode:
 *
 *   1. **Enter slow, exit fast.** Arrivals get ~220ms so the eye can follow
 *      them; departures get ~140ms because nobody wants to wait for something
 *      they just dismissed.
 *   2. **Move a little.** Offsets are 8–16px. Large translations look like a
 *      slideshow and cost a repaint of a bigger area.
 *   3. **Only animate transform and opacity.** Both are compositor-only, so
 *      they stay at 60fps. Animating `height` or `top` triggers layout on every
 *      frame and janks on a mid-range phone.
 */

import type { Transition, Variants } from 'framer-motion';

/* -------------------------------------------------------------------------- */
/*                                 Transitions                                */
/* -------------------------------------------------------------------------- */

/** The decelerating curve from the design tokens, as a Framer transition. */
export const easeOut: Transition = {
  duration: 0.22,
  ease: [0.16, 1, 0.3, 1],
};

export const easeOutFast: Transition = {
  duration: 0.14,
  ease: [0.16, 1, 0.3, 1],
};

/**
 * A spring for anything the user is directly manipulating.
 *
 * Springs feel right for drag, hover and press because they have momentum;
 * they feel wrong for a page transition, where a fixed duration is more
 * predictable. `damping: 30` is just short of critical, so there is a hint of
 * settle without a visible bounce.
 */
export const spring: Transition = {
  type: 'spring',
  stiffness: 380,
  damping: 30,
  mass: 0.8,
};

/** Softer spring for larger surfaces — modals, drawers, sheets. */
export const springSoft: Transition = {
  type: 'spring',
  stiffness: 260,
  damping: 28,
  mass: 0.9,
};

/* -------------------------------------------------------------------------- */
/*                                  Variants                                  */
/* -------------------------------------------------------------------------- */

export const fade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: easeOut },
  exit: { opacity: 0, transition: easeOutFast },
};

/** The default for content arriving in place — cards, list items, sections. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: easeOut },
  exit: { opacity: 0, y: -8, transition: easeOutFast },
};

export const fadeDown: Variants = {
  hidden: { opacity: 0, y: -12 },
  visible: { opacity: 1, y: 0, transition: easeOut },
  exit: { opacity: 0, y: -8, transition: easeOutFast },
};

/**
 * Scale-in for things anchored to a trigger — popovers, dropdowns, tooltips.
 *
 * Starting at 0.96 rather than 0 keeps it feeling like the panel *expanded*
 * from the button rather than flew in from nowhere. Pair with a
 * `transform-origin` matching the anchor.
 */
export const popIn: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: -4 },
  visible: { opacity: 1, scale: 1, y: 0, transition: spring },
  exit: { opacity: 0, scale: 0.97, y: -4, transition: easeOutFast },
};

/** Modal panel. Softer spring, slightly more travel, because it is larger. */
export const modalPanel: Variants = {
  hidden: { opacity: 0, scale: 0.97, y: 16 },
  visible: { opacity: 1, scale: 1, y: 0, transition: springSoft },
  exit: { opacity: 0, scale: 0.98, y: 8, transition: easeOutFast },
};

export const backdrop: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.18 } },
  exit: { opacity: 0, transition: { duration: 0.14 } },
};

/** Slide-over drawer, from the right. */
export const drawerRight: Variants = {
  hidden: { x: '100%' },
  visible: { x: 0, transition: springSoft },
  exit: { x: '100%', transition: { duration: 0.2, ease: [0.65, 0, 0.35, 1] } },
};

/** Toast, entering from the bottom-right stack. */
export const toastItem: Variants = {
  hidden: { opacity: 0, y: 16, scale: 0.96 },
  visible: { opacity: 1, y: 0, scale: 1, transition: spring },
  exit: { opacity: 0, x: 24, scale: 0.96, transition: easeOutFast },
};

/* -------------------------------------------------------------------------- */
/*                                  Stagger                                   */
/* -------------------------------------------------------------------------- */

/**
 * Container that reveals its children in sequence.
 *
 * 40ms apart is the useful range: enough to read as a cascade, short enough
 * that a twelve-item list finishes in under half a second. At 100ms the last
 * card arrives a second late and the page feels slow.
 */
export const staggerContainer = (stagger = 0.04, delayChildren = 0): Variants => ({
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: stagger, delayChildren },
  },
  exit: { opacity: 0 },
});

/** Child of a `staggerContainer`. Inherits timing from the parent. */
export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: easeOut },
  exit: { opacity: 0, y: -6, transition: easeOutFast },
};

/* -------------------------------------------------------------------------- */
/*                               Interaction                                  */
/* -------------------------------------------------------------------------- */

/**
 * Press feedback.
 *
 * A 2% scale-down on tap is the cheapest way to make a button feel physical.
 * Kept subtle deliberately: anything past ~4% looks like the button is
 * collapsing.
 */
export const pressable = {
  whileHover: { scale: 1.015 },
  whileTap: { scale: 0.985 },
  transition: spring,
} as const;

/** For cards that lift on hover. `y` only — scaling a card blurs its text. */
export const liftable = {
  whileHover: { y: -3 },
  transition: spring,
} as const;

/* -------------------------------------------------------------------------- */
/*                             Reduced motion                                 */
/* -------------------------------------------------------------------------- */

/**
 * Strip movement from a variant set while keeping the opacity fade.
 *
 * Called with the result of Framer's `useReducedMotion()`. A full opacity fade
 * is retained on purpose: the request is to reduce *motion*, not to remove all
 * feedback, and an element appearing with no transition at all is jarring in a
 * different way.
 */
export function respectMotion(variants: Variants, reduced: boolean | null): Variants {
  if (!reduced) return variants;

  const flattened: Variants = {};

  for (const [state, definition] of Object.entries(variants)) {
    if (typeof definition !== 'object' || definition === null) {
      flattened[state] = definition;
      continue;
    }

    /* Drop every spatial and scale property; keep opacity and timing. */
    const { x: _x, y: _y, scale: _scale, rotate: _rotate, ...rest } = definition as Record<
      string,
      unknown
    >;

    flattened[state] = { ...rest, transition: { duration: 0.12 } };
  }

  return flattened;
}
