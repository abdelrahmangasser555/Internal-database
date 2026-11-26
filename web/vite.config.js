import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const API = process.env.BACKUP_API_URL || 'http://127.0.0.1:4780';

function attachApiProxy(proxy) {
  let lastLog = 0;
  proxy.on('error', (_err, _req, res) => {
    const now = Date.now();
    if (now - lastLog > 2500) {
      console.warn('[vite] API not reachable yet (restarting?) — returning 503 to the browser');
      lastLog = now;
    }
    if (res && !res.headersSent) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'API unavailable — retry shortly.' }));
    }
  });
}

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
      '/api': {
        target: API,
        changeOrigin: true,
        configure: attachApiProxy,
      },
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
