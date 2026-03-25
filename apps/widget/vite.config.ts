import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { visualizer } from 'rollup-plugin-visualizer';

const analyze = process.env.ANALYZE === 'true';

export default defineConfig({
  plugins: [
    preact(),
    ...(analyze
      ? [
          visualizer({
            filename: 'dist/stats.html',
            gzipSize: true,
            brotliSize: true,
          }),
        ]
      : []),
  ],
  build: {
    target: 'es2020',
    sourcemap: 'hidden',
    rollupOptions: {
      input: 'src/main.tsx',
      output: {
        format: 'iife',
        name: 'CodeWeavesWidget',
        entryFileNames: 'codeweaves-widget.js',
        inlineDynamicImports: true,
      },
    },
    cssCodeSplit: false,
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
      },
    },
  },
  base: './',
});
