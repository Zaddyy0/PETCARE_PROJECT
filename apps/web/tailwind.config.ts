import type { Config } from 'tailwindcss';

/**
 * Tailwind configuration.
 *
 * Every colour here resolves to a **semantic** token from `tokens.css` — there
 * is deliberately no `violet-500` in the Tailwind palette. A component can only
 * say `bg-surface` or `text-muted`, never `bg-violet-500`, which is what makes
 * dark mode a token swap rather than a per-component audit.
 *
 * The `<alpha-value>` placeholder is why the tokens store bare HSL channels:
 * it lets `bg-primary/10` work, which a hex token cannot support.
 */

const withAlpha = (token: string) => `hsl(var(${token}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],

  /* Class-based, not media-based: the theme toggle sets `.dark` on <html>, so a
     user's explicit choice overrides their OS setting. */
  darkMode: 'class',

  theme: {
    extend: {
      colors: {
        canvas: withAlpha('--canvas'),
        surface: {
          DEFAULT: withAlpha('--surface'),
          raised: withAlpha('--surface-raised'),
          sunken: withAlpha('--surface-sunken'),
          hover: withAlpha('--surface-hover'),
        },
        border: {
          DEFAULT: withAlpha('--border'),
          strong: withAlpha('--border-strong'),
        },
        content: {
          DEFAULT: withAlpha('--text'),
          muted: withAlpha('--text-muted'),
          subtle: withAlpha('--text-subtle'),
          inverse: withAlpha('--text-inverse'),
        },
        primary: {
          DEFAULT: withAlpha('--primary'),
          hover: withAlpha('--primary-hover'),
          soft: withAlpha('--primary-soft'),
          fg: withAlpha('--primary-fg'),
        },
        accent: {
          DEFAULT: withAlpha('--accent'),
          hover: withAlpha('--accent-hover'),
          soft: withAlpha('--accent-soft'),
          fg: withAlpha('--accent-fg'),
        },
        success: {
          DEFAULT: withAlpha('--success'),
          soft: withAlpha('--success-soft'),
          fg: withAlpha('--success-fg'),
        },
        warning: {
          DEFAULT: withAlpha('--warning'),
          soft: withAlpha('--warning-soft'),
          fg: withAlpha('--warning-fg'),
        },
        danger: {
          DEFAULT: withAlpha('--danger'),
          hover: withAlpha('--danger-hover'),
          soft: withAlpha('--danger-soft'),
          fg: withAlpha('--danger-fg'),
        },
        info: {
          DEFAULT: withAlpha('--info'),
          soft: withAlpha('--info-soft'),
          fg: withAlpha('--info-fg'),
        },
        ring: withAlpha('--ring'),
      },

      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        '2xl': 'var(--radius-2xl)',
      },

      boxShadow: {
        xs: 'var(--shadow-xs)',
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        xl: 'var(--shadow-xl)',
        glow: 'var(--shadow-glow)',
      },

      fontFamily: {
        /**
         * A variable font with a system-UI fallback stack.
         *
         * The fallbacks are listed in the order each platform prefers, so the
         * first paint before the webfont loads still looks native rather than
         * dropping to Times.
         */
        sans: [
          '"Inter var"',
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          '"Segoe UI"',
          'Roboto',
          '"Helvetica Neue"',
          'sans-serif',
        ],
        /* Used for appointment references and IDs, where character shapes must
           be unambiguous when read aloud. */
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },

      fontSize: {
        /* A tighter-than-default display scale. Tailwind's `text-5xl` upward is
           built for marketing pages; an application needs less shouting. */
        'display-sm': ['1.75rem', { lineHeight: '2.125rem', letterSpacing: '-0.02em', fontWeight: '650' }],
        'display-md': ['2.25rem', { lineHeight: '2.625rem', letterSpacing: '-0.025em', fontWeight: '650' }],
        'display-lg': ['3rem', { lineHeight: '3.375rem', letterSpacing: '-0.03em', fontWeight: '700' }],
      },

      transitionTimingFunction: {
        out: 'var(--ease-out)',
        'in-out': 'var(--ease-in-out)',
      },

      transitionDuration: {
        fast: 'var(--duration-fast)',
        base: 'var(--duration-base)',
        slow: 'var(--duration-slow)',
      },

      spacing: {
        header: 'var(--header-height)',
        sidebar: 'var(--sidebar-width)',
        'sidebar-collapsed': 'var(--sidebar-width-collapsed)',
      },

      backgroundImage: {
        /* The brand gradient, for hero surfaces and the auth split panel. */
        'brand-gradient':
          'linear-gradient(135deg, hsl(var(--violet-600)) 0%, hsl(var(--violet-500)) 45%, hsl(var(--coral-500)) 100%)',
        'brand-mesh':
          'radial-gradient(at 20% 20%, hsl(var(--violet-500) / 0.35) 0px, transparent 55%), radial-gradient(at 80% 15%, hsl(var(--coral-400) / 0.28) 0px, transparent 50%), radial-gradient(at 60% 85%, hsl(var(--teal-400) / 0.22) 0px, transparent 50%)',
        /* Drives the skeleton shimmer. */
        shimmer:
          'linear-gradient(90deg, transparent 0%, hsl(var(--surface-hover) / 0.9) 50%, transparent 100%)',
      },

      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        /* A gentle breathing pulse for "live" indicators — far less
           attention-grabbing than Tailwind's default `animate-pulse`. */
        breathe: {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.72', transform: 'scale(0.96)' },
        },
      },

      animation: {
        'fade-in': 'fade-in var(--duration-base) var(--ease-out) both',
        'slide-up': 'slide-up var(--duration-base) var(--ease-out) both',
        shimmer: 'shimmer 1.6s infinite',
        breathe: 'breathe 2.4s var(--ease-in-out) infinite',
      },
    },
  },

  plugins: [],
} satisfies Config;
