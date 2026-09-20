import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { Permission } from '@pawsitive/shared';
import type { AppDispatch, RootState } from './store';
import { selectPermissions } from './slices/authSlice';

/**
 * Typed Redux hooks.
 *
 * Always use these rather than the untyped `useDispatch` / `useSelector`. The
 * plain versions type state as `unknown`, so every selector needs a cast — and
 * a cast is exactly where a renamed slice stops being a compile error and
 * becomes a runtime `undefined`.
 */
export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();

/**
 * Capability check for rendering.
 *
 * Reads the same permission matrix the API enforces with, so a button appears
 * exactly when the server would accept the action behind it.
 *
 * This is a *rendering* concern only. Hiding a button is not security — the
 * server re-derives permissions from the database role on every request — it is
 * about not offering someone an action that is going to fail.
 */
export function useCan(permission: Permission): boolean {
  const permissions = useAppSelector(selectPermissions);
  return permissions.includes(permission);
}

export function useCanAny(...permissions: Permission[]): boolean {
  const granted = useAppSelector(selectPermissions);
  return permissions.some((permission) => granted.includes(permission));
}

/**
 * Debounce a rapidly-changing value.
 *
 * For search inputs: without it a ten-character query fires ten requests, and
 * because responses can arrive out of order the list may settle on results for
 * a *prefix* of what the user typed.
 */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    /* Clearing on every change is what makes it a debounce rather than a
       throttle — the timer only fires once typing pauses. */
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

/**
 * Run a callback on an interval without restarting it when the callback
 * identity changes.
 *
 * Used by the relative timestamps ("in 3 hours"), which need a periodic
 * re-render. The ref indirection is what stops an inline arrow function from
 * tearing down and recreating the interval on every render.
 */
export function useInterval(callback: () => void, delayMs: number | null): void {
  const saved = useRef(callback);

  useEffect(() => {
    saved.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delayMs === null) return;

    const timer = setInterval(() => saved.current(), delayMs);
    return () => clearInterval(timer);
  }, [delayMs]);
}

/** Track a media query, kept in sync with changes. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    /* Guarded for environments without `matchMedia`, and read lazily so the
       first render already has the right answer — reading it in an effect
       instead would render once at the wrong breakpoint. */
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;

    const list = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);

    /* Re-read on mount: the query may have changed between the lazy initial
       read and this effect. */
    setMatches(list.matches);
    list.addEventListener('change', onChange);

    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/**
 * Close something when a click lands outside it.
 *
 * Bound to `pointerdown` rather than `click`, so a dropdown closes as the press
 * begins. With `click` the menu is still open when the press completes, and the
 * element under the cursor receives the click too.
 */
export function useClickOutside<T extends HTMLElement>(
  onOutside: () => void,
  active = true,
): React.RefObject<T> {
  const ref = useRef<T>(null);
  const handler = useRef(onOutside);

  useEffect(() => {
    handler.current = onOutside;
  }, [onOutside]);

  useEffect(() => {
    if (!active) return;

    function onPointerDown(event: PointerEvent) {
      const element = ref.current;
      if (element && !element.contains(event.target as Node)) {
        handler.current();
      }
    }

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [active]);

  return ref;
}

/** Close on Escape. Paired with `useClickOutside` for menus and popovers. */
export function useEscapeKey(onEscape: () => void, active = true): void {
  const handler = useRef(onEscape);

  useEffect(() => {
    handler.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!active) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') handler.current();
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [active]);
}
