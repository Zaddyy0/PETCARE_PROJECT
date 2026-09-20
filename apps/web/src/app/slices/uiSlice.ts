import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

/**
 * Presentational state.
 *
 * Theme and sidebar preference are persisted to `localStorage` — they are
 * genuinely per-device conveniences, not account settings, and they are exactly
 * the kind of thing browser storage is for. Every access is wrapped, because
 * `localStorage` *throws* in a private window with site data blocked, and a
 * theme preference must never be able to stop the app from booting.
 */

export type ThemeChoice = 'light' | 'dark' | 'system';

const THEME_KEY = 'pawsitive:theme';
const SIDEBAR_KEY = 'pawsitive:sidebar-collapsed';

function readTheme(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === 'true';
  } catch {
    return false;
  }
}

export interface UiState {
  theme: ThemeChoice;
  sidebarCollapsed: boolean;
  /** Mobile nav drawer. Never persisted — it must start closed on every load. */
  mobileNavOpen: boolean;
  /** Command palette / global search. */
  commandOpen: boolean;
}

const initialState: UiState = {
  theme: readTheme(),
  sidebarCollapsed: readSidebarCollapsed(),
  mobileNavOpen: false,
  commandOpen: false,
};

/**
 * Apply the theme to the document.
 *
 * Done here, in the reducer's neighbourhood rather than in a component effect,
 * so the class lands in the same tick as the state change — a `useEffect` would
 * paint one frame with the old theme.
 *
 * `data-theme` records that the choice was explicit, which is what lets the CSS
 * `prefers-color-scheme` rule defer to it.
 */
function applyTheme(choice: ThemeChoice): void {
  try {
    const root = document.documentElement;
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const dark = choice === 'dark' || (choice === 'system' && prefersDark);

    root.classList.toggle('dark', dark);

    if (choice === 'system') {
      root.removeAttribute('data-theme');
      localStorage.removeItem(THEME_KEY);
    } else {
      root.setAttribute('data-theme', choice);
      localStorage.setItem(THEME_KEY, choice);
    }
  } catch {
    /* A blocked storage API must not break theming. */
  }
}

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setTheme(state, action: PayloadAction<ThemeChoice>) {
      state.theme = action.payload;
      applyTheme(action.payload);
    },

    /** Cycles light → dark → system, which is what the toggle button does. */
    cycleTheme(state) {
      const next: ThemeChoice =
        state.theme === 'light' ? 'dark' : state.theme === 'dark' ? 'system' : 'light';

      state.theme = next;
      applyTheme(next);
    },

    toggleSidebar(state) {
      state.sidebarCollapsed = !state.sidebarCollapsed;
      try {
        localStorage.setItem(SIDEBAR_KEY, String(state.sidebarCollapsed));
      } catch {
        /* Not worth failing over. */
      }
    },

    setMobileNav(state, action: PayloadAction<boolean>) {
      state.mobileNavOpen = action.payload;
    },

    setCommandOpen(state, action: PayloadAction<boolean>) {
      state.commandOpen = action.payload;
    },
  },
});

export const { setTheme, cycleTheme, toggleSidebar, setMobileNav, setCommandOpen } =
  uiSlice.actions;

export default uiSlice.reducer;

interface RootLike {
  ui: UiState;
}

export const selectTheme = (state: RootLike) => state.ui.theme;
export const selectSidebarCollapsed = (state: RootLike) => state.ui.sidebarCollapsed;
export const selectMobileNavOpen = (state: RootLike) => state.ui.mobileNavOpen;
export const selectCommandOpen = (state: RootLike) => state.ui.commandOpen;

/**
 * Keep `system` in sync when the OS flips mid-session.
 *
 * Called once from the app root. Only acts while the choice is `system`, so an
 * explicit preference is never overridden by the OS changing.
 */
export function watchSystemTheme(getChoice: () => ThemeChoice): () => void {
  try {
    const query = window.matchMedia('(prefers-color-scheme: dark)');

    const onChange = () => {
      if (getChoice() === 'system') applyTheme('system');
    };

    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  } catch {
    return () => undefined;
  }
}
