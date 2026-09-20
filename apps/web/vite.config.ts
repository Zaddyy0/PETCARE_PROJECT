import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      /* Mirrors the `paths` entry in tsconfig. Both are needed: TypeScript
         uses its own for checking, Vite uses this one at build time. */
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  server: {
    port: 5173,
    /**
     * The API is proxied rather than called cross-origin in development.
     *
     * That keeps the browser on a single origin, so the httpOnly refresh cookie
     * is first-party and `sameSite: lax` applies cleanly. Pointing the client
     * straight at `:5000` would make every request cross-site and the cookie
     * would be dropped by the browser — the session would appear to work until
     * the first refresh and then silently sign the user out.
     */
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      /* Socket.IO needs an upgrade-aware proxy entry of its own. */
      '/socket.io': {
        target: 'http://localhost:5000',
        ws: true,
        changeOrigin: true,
      },
    },
  },

  build: {
    outDir: 'dist',
    sourcemap: true,
    /* Warn earlier than Vite's 500kB default so a bundle regression is visible
       in CI rather than discovered by a user on mobile data. */
    chunkSizeWarningLimit: 400,
    rollupOptions: {
      output: {
        /**
         * Split the heavy, rarely-changing dependencies out of the app chunk.
         *
         * React, Redux and Framer Motion change only when we upgrade them, so
         * giving them their own hashed chunks means an ordinary app deploy does
         * not invalidate ~200kB of vendor code in everyone's cache.
         */
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          redux: ['@reduxjs/toolkit', 'react-redux'],
          motion: ['framer-motion'],
        },
      },
    },
  },
});
