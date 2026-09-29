import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Client build.
 *
 * The shared package is aliased to its TypeScript source, so the client typechecks
 * against exactly what the server compiles and there is no second build step to keep
 * in sync during development.
 *
 * In development, /api is proxied to the local API so the browser sees one origin.
 * That means the httpOnly session cookies work with no CORS exception and no
 * SameSite=None, which would be impossible over plain HTTP.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@speaking-coach/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env['VITE_API_TARGET'] ?? 'http://127.0.0.1:8080',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // Phone-first bundle: the practice screen is the only thing most learners open.
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
        },
      },
    },
  },
});
