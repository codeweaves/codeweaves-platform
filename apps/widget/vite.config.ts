import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [preact()],
  build: {
    // Target small bundle size for embeddable widget
    target: 'es2020',
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
      },
    },
    rollupOptions: {
      output: {
        // Single file output for easy embedding
        entryFileNames: 'widget.js',
        assetFileNames: 'widget.[ext]',
        manualChunks: undefined,
      },
    },
    // Report bundle size
    reportCompressedSize: true,
  },
  // Widget will be served from CDN/different domain
  base: './',
});
