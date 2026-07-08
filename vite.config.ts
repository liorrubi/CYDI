import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const configDir = dirname(fileURLToPath(import.meta.url))

// Identifies exactly which build is running, shown in Settings for support/debugging.
// Distinct from SaveData's schemaVersion, which describes the save file format, not the build.
function resolveAppBuild(): string {
  try {
    // Resolve relative to this config file, not process.cwd() - some launchers
    // (e.g. the local dev preview) spawn vite from a parent folder that isn't the git repo.
    return execSync('git rev-parse --short HEAD', { cwd: configDir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    // No git history available in this build environment - fall back to a timestamp.
    return new Date().toISOString().slice(0, 16).replace('T', ' ')
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_BUILD__: JSON.stringify(resolveAppBuild()),
  },
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
