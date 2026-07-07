import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Keep the dep-optimizer cache outside the Dropbox-synced folder —
  // Dropbox locks files mid-sync and breaks Vite's cache directory rename (EBUSY).
  cacheDir: join(tmpdir(), 'vite-cache-cydi'),
  server: {
    // Bind to all interfaces so the game is reachable from other machines on the LAN.
    host: true,
    // Allow access via the Cloudflare quick-tunnel used for temporary public sharing.
    allowedHosts: ['.trycloudflare.com'],
  },
})
