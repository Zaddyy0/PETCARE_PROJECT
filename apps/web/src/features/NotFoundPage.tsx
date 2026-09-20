import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Logo } from '@/components/Logo';
import { fadeUp } from '@/lib/motion';

export default function NotFoundPage() {
  return (
    <div className="grid min-h-dvh place-items-center bg-canvas px-6">
      <motion.div
        variants={fadeUp}
        initial="hidden"
        animate="visible"
        className="w-full max-w-md text-center"
      >
        <Logo className="mb-8 justify-center" />

        <p aria-hidden className="text-6xl">
          🐕‍🦺
        </p>

        <h1 className="mt-6 text-display-sm text-content text-balance">
          This page has wandered off
        </h1>

        <p className="mt-2 text-sm leading-relaxed text-content-muted text-pretty">
          The link may be broken, or the page may have moved. Nothing has gone wrong with your
          account.
        </p>

        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            to="/app"
            className="h-10 rounded-lg bg-primary px-5 text-sm font-medium leading-10 text-primary-fg transition-colors hover:bg-primary-hover"
          >
            Back to dashboard
          </Link>
          {/* `history.back()` rather than a hardcoded path: whatever they came
              from is more useful than a guess. */}
          <button
            type="button"
            onClick={() => window.history.back()}
            className="h-10 rounded-lg border border-border px-5 text-sm font-medium text-content transition-colors hover:bg-surface-hover"
          >
            Go back
          </button>
        </div>
      </motion.div>
    </div>
  );
}
