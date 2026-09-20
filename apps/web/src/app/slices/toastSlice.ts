import { createSlice, nanoid, type PayloadAction } from '@reduxjs/toolkit';

/**
 * Toast notifications.
 *
 * In Redux rather than React context so that non-component code can raise
 * one — specifically the RTK Query error middleware, which needs to surface a
 * failed mutation and has no component to hang a hook off.
 */

export type ToastTone = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
  /** Milliseconds before auto-dismiss. `null` keeps it until dismissed. */
  duration: number | null;
  /** Shown as a button — "Undo", "View", "Retry". */
  action?: { label: string; href?: string };
}

export interface ToastState {
  items: Toast[];
}

const initialState: ToastState = { items: [] };

/**
 * Hard cap on visible toasts.
 *
 * A burst — a failed bulk action, a dropped connection retrying — would
 * otherwise stack until the whole screen is toast. Oldest is dropped first, so
 * the most recent (and most relevant) stays visible.
 */
const MAX_VISIBLE = 4;

const toastSlice = createSlice({
  name: 'toast',
  initialState,
  reducers: {
    toastPushed: {
      reducer(state, action: PayloadAction<Toast>) {
        /* De-duplicate identical consecutive messages. Three failed saves of
           the same form should read as one problem, not three. */
        const last = state.items[state.items.length - 1];
        if (last && last.title === action.payload.title && last.tone === action.payload.tone) {
          return;
        }

        state.items.push(action.payload);

        if (state.items.length > MAX_VISIBLE) {
          state.items.splice(0, state.items.length - MAX_VISIBLE);
        }
      },

      /* `prepare` generates the id, so callers pass only the message. */
      prepare(input: Omit<Toast, 'id' | 'duration'> & { duration?: number | null }) {
        return {
          payload: {
            id: nanoid(8),
            /**
             * Errors default to a longer life than successes.
             *
             * A success is confirmation of something the user just did and can
             * be glanced at; an error may carry instructions, and snatching it
             * away after two seconds is how people end up not knowing what
             * went wrong.
             */
            duration:
              input.duration !== undefined
                ? input.duration
                : input.tone === 'error'
                  ? 7000
                  : 4000,
            ...input,
          } satisfies Toast,
        };
      },
    },

    toastDismissed(state, action: PayloadAction<string>) {
      state.items = state.items.filter((toast) => toast.id !== action.payload);
    },

    toastsCleared(state) {
      state.items = [];
    },
  },
});

export const { toastPushed, toastDismissed, toastsCleared } = toastSlice.actions;
export default toastSlice.reducer;

interface RootLike {
  toast: ToastState;
}

export const selectToasts = (state: RootLike) => state.toast.items;

/* Convenience creators, so call sites read as one line. */
export const toastSuccess = (title: string, description?: string) =>
  toastPushed({ tone: 'success', title, ...(description ? { description } : {}) });

export const toastError = (title: string, description?: string) =>
  toastPushed({ tone: 'error', title, ...(description ? { description } : {}) });

export const toastInfo = (title: string, description?: string) =>
  toastPushed({ tone: 'info', title, ...(description ? { description } : {}) });

export const toastWarning = (title: string, description?: string) =>
  toastPushed({ tone: 'warning', title, ...(description ? { description } : {}) });
