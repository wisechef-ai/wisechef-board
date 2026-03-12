import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { readFileSync } from 'fs'
import { execSync } from 'child_process'

function getVersion() {
  try {
    return execSync('git describe --tags --abbrev=0', { encoding: 'utf-8' }).trim().replace(/^v/, '')
  } catch {
    return JSON.parse(readFileSync('./package.json', 'utf-8')).version
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = env.VITE_API_TARGET || 'http://localhost:3333'

  return {
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(getVersion()),
      __BUILD_TS__: JSON.stringify(Date.now()),
      __WS_TARGET__: JSON.stringify(apiTarget !== 'http://localhost:3333' ? apiTarget : ''),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          secure: false,
        },
      }
    },
    build: {
      outDir: 'dist',
      rollupOptions: {
        output: {
          entryFileNames: `assets/[name]-[hash]-${Date.now()}.js`,
          chunkFileNames: `assets/[name]-[hash]-${Date.now()}.js`,
          assetFileNames: `assets/[name]-[hash]-${Date.now()}.[ext]`,
          manualChunks(id) {
            // Split large vendor libs into separate cacheable chunks
            if (id.includes('react-syntax-highlighter')) return 'chunk-syntax';
            if (id.includes('react-dom') || id.includes('react/')) return 'chunk-react';
            if (id.includes('@radix-ui') || id.includes('@dnd-kit')) return 'chunk-ui';
            if (id.includes('lucide-react')) return 'chunk-icons';
          },
        },
      },
    }
  }
})
