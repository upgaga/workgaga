import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { createReadStream } from 'fs';
import { readFileSync } from 'fs';
import { cp, stat } from 'fs/promises';
import { extname, resolve } from 'path';
import type { Stats } from 'fs';
import type { Plugin } from 'vite';

// 读取 package.json 获取版本号
const packageJson = JSON.parse(readFileSync(resolve(__dirname, './package.json'), 'utf-8'));

const host = process.env.TAURI_DEV_HOST;
const modelsSourceDir = resolve(__dirname, './models');

const localModelsPlugin = (): Plugin => {
  let outputDir = resolve(__dirname, './dist');

  return {
    name: 'serve-and-copy-local-models',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const requestUrl = request.url?.split('?')[0];
        if (!requestUrl?.startsWith('/models/keyword/')) {
          next();
          return;
        }

        const relativePath = decodeURIComponent(requestUrl.slice('/models/'.length));
        const filePath = resolve(modelsSourceDir, relativePath);
        if (!filePath.startsWith(`${modelsSourceDir}/`)) {
          next();
          return;
        }

        let fileStats: Stats;
        try {
          fileStats = await stat(filePath);
          if (!fileStats.isFile()) {
            next();
            return;
          }
        } catch {
          next();
          return;
        }

        response.statusCode = 200;
        response.setHeader('Content-Length', fileStats.size);
        response.setHeader('Content-Type',
          extname(filePath) === '.json'
            ? 'application/json'
            : extname(filePath) === '.txt'
              ? 'text/plain; charset=utf-8'
              : 'application/octet-stream',
        );
        if (request.method === 'HEAD') {
          response.end();
          return;
        }
        createReadStream(filePath).pipe(response);
      });
    },
    configResolved(config) {
      outputDir = config.build.outDir;
    },
    async generateBundle() {
      await cp(resolve(modelsSourceDir, 'keyword'), resolve(outputDir, 'models/keyword'), {
        recursive: true,
      });
    },
  };
};

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [vue(), localModelsPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ['**/src-tauri/**'],
    },
  },
  // 添加optimizeDeps配置来解决katex依赖优化问题
  optimizeDeps: {
    include: ['katex', 'echarts'],
    exclude: ['workgaga'],
  },
}));
