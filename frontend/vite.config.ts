import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import os from 'node:os'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  cacheDir: path.join(os.tmpdir(), 'urbanfleet-frontend-vite-cache'),
})
