import { motion } from 'framer-motion';
import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { spring } from '@/lib/motion';

export interface TabItem<T extends string> {
  value: T;
  label: string;
  /** Rendered as a pill after the label — a count, usually. */
  badge?: number | string;
  icon?: ReactNode;
}

export interface TabsProps<T extends string> {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

/**
 * Tab strip with an animated active indicator.
 *
 * The indicator is a single element shared across tabs via Framer's
 * `layoutId`, so it *slides* from one tab to the next rather than
 * disappearing and reappearing. That continuity is what makes the control feel
 * connected — the eye follows the bar and understands the relationship.
 *
 * Roving `tabIndex` plus arrow-key handling is what makes it a real tab list
 * rather than a row of buttons: a keyboard user Tabs *to* the group once, then
 * moves between tabs with arrows.
 */
export function Tabs<T extends string>({ items, value, onChange, className }: TabsProps<T>) {
  const groupId = useId();

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    const directions: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: 1,
      ArrowUp: -1,
    };

    if (event.key === 'Home') {
      event.preventDefault();
      const first = items[0];
      if (first) onChange(first.value);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      const last = items[items.length - 1];
      if (last) onChange(last.value);
      return;
    }

    const step = directions[event.key];
    if (step === undefined) return;

    event.preventDefault();
    /* Wraps at both ends, which is the expected behaviour for a tab list. */
    const next = items[(index + step + items.length) % items.length];
    if (next) onChange(next.value);
  }

  return (
    <div
      role="tablist"
      /* `no-scrollbar` keeps the strip horizontally scrollable on a phone
         without a visible bar eating 10px of a 44px-tall control. */
      className={cn('flex gap-1 overflow-x-auto no-scrollbar border-b border-border', className)}
    >
      {items.map((item, index) => {
        const selected = item.value === value;

        return (
          <button
            key={item.value}
            role="tab"
            id={`${groupId}-tab-${item.value}`}
            aria-selected={selected}
            aria-controls={`${groupId}-panel-${item.value}`}
            /* Only the selected tab is in the tab order. */
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              'relative shrink-0 px-3.5 py-2.5 text-sm font-medium transition-colors duration-fast',
              'hover:text-content',
              selected ? 'text-primary' : 'text-content-muted',
            )}
          >
            <span className="inline-flex items-center gap-1.5">
              {item.icon && (
                <span aria-hidden className="[&>svg]:size-4">
                  {item.icon}
                </span>
              )}
              {item.label}
              {item.badge !== undefined && item.badge !== 0 && (
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-[0.625rem] font-semibold tabular-nums',
                    selected ? 'bg-primary-soft text-primary' : 'bg-surface-sunken text-content-muted',
                  )}
                >
                  {item.badge}
                </span>
              )}
            </span>

            {selected && (
              <motion.span
                /* The shared id is what makes it slide between tabs. */
                layoutId={`${groupId}-indicator`}
                transition={spring}
                className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

/** The panel for a tab. Must be rendered only when its tab is selected. */
export function TabPanel({
  id,
  groupId,
  children,
}: {
  id: string;
  groupId: string;
  children: ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      id={`${groupId}-panel-${id}`}
      aria-labelledby={`${groupId}-tab-${id}`}
      /* Focusable so a keyboard user can Tab from the tab into its content. */
      tabIndex={0}
      className="focus-visible:outline-none"
    >
      {children}
    </div>
  );
}
