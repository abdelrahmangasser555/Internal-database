import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: dir,
  resolve: {
    alias: {
      '@': path.join(dir, 'src'),
    },
  },
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4780', changeOrigin: true },
    },
  },
  build: {
    outDir: path.join(dir, 'dist'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          flow: ['@xyflow/react', '@dagrejs/dagre'],
          motion: ['framer-motion'],
          charts: ['echarts', 'echarts/core', 'echarts/charts', 'echarts/components', 'echarts/renderers', 'motion/react'],
        },
      },
    },
  },
});
