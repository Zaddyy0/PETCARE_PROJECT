import { motion } from 'framer-motion';
import { Outlet } from 'react-router-dom';
import { APP_NAME, APP_TAGLINE } from '@pawsitive/shared';
import { Logo } from '@/components/Logo';
import { fadeUp, staggerContainer, staggerItem } from '@/lib/motion';

/**
 * The unauthenticated shell.
 *
 * A split layout: the form on the left, a brand panel on the right that is
 * hidden below `lg`. The panel is decorative, so it collapses rather than
 * stacking — nobody needs to scroll past a gradient to reach the sign-in form
 * on a phone.
 */
export function AuthLayout() {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      {/* ---- Form side --------------------------------------------------- */}
      <div className="flex flex-col justify-center px-6 py-10 sm:px-12 lg:px-16">
        <div className="mx-auto w-full max-w-sm">
          <Logo className="mb-8" />

          <motion.div variants={fadeUp} initial="hidden" animate="visible">
            <Outlet />
          </motion.div>
        </div>
      </div>

      {/* ---- Brand side -------------------------------------------------- */}
      <div className="relative hidden overflow-hidden bg-brand-gradient lg:block">
        {/* A soft mesh over the gradient, so the panel has depth rather than
            reading as a flat colour block. */}
        <div aria-hidden className="absolute inset-0 bg-brand-mesh opacity-70" />

        <motion.div
          variants={staggerContainer(0.08, 0.15)}
          initial="hidden"
          animate="visible"
          className="relative flex h-full flex-col justify-center px-16 text-white"
        >
          <motion.h2
            variants={staggerItem}
            className="max-w-md text-display-md text-balance text-white"
          >
            {APP_TAGLINE}
          </motion.h2>

          <motion.p variants={staggerItem} className="mt-4 max-w-md text-lg text-white/85 text-pretty">
            {APP_NAME} keeps your pet&rsquo;s appointments, vaccinations and medical history
            in one place — and puts a vet a few taps away.
          </motion.p>

          <motion.ul variants={staggerItem} className="mt-10 space-y-3">
            {[
              'Book with a real-time availability calendar',
              'Vaccination reminders before they fall due',
              'Every visit, diagnosis and prescription in one timeline',
              'Verified reviews from real appointments',
            ].map((feature) => (
              <li key={feature} className="flex items-start gap-3 text-white/90">
                <span
                  aria-hidden
                  className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-white/20 text-xs"
                >
                  ✓
                </span>
                <span className="text-[0.9375rem] text-pretty">{feature}</span>
              </li>
            ))}
          </motion.ul>
        </motion.div>

        {/* Decorative paws, low opacity. `select-none` so they cannot be
            dragged or highlighted. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 select-none">
          <span className="absolute left-[8%] top-[12%] text-6xl opacity-10">🐾</span>
          <span className="absolute right-[12%] top-[62%] text-7xl opacity-[0.08]">🐾</span>
          <span className="absolute bottom-[8%] left-[22%] text-5xl opacity-[0.09]">🐾</span>
        </div>
      </div>
    </div>
  );
}
