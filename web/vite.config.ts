import { createLogger, defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { lanIPv4 } from '../server/src/config.js';

const apiPort = process.env.LANDROP_PORT || '6861';
const webPort = Number(process.env.VITE_WEB_PORT || '6862');
const target = `http://127.0.0.1:${apiPort}`;

const logger = createLogger();
let lanIp: string | null = null;
try {
  lanIp = lanIPv4();
} catch {
  // 没有内网时只提示，不回退到 localhost。
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'landrop-lan-url',
      configureServer(server) {
        server.printUrls = () => {
          if (lanIp) {
            logger.info(`  ➜  局域网: http://${lanIp}:${webPort}/`);
          } else {
            logger.warn('  未检测到局域网地址，请检查网络连接');
          }
        };
      },
    },
  ],
  customLogger: logger,
  server: {
    host: true,
    port: webPort,
    strictPort: true,
    proxy: {
      '/api': target,
      '/uploads': target,
      '/socket.io': { target, ws: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
