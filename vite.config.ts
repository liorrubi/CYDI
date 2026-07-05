import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Allow access via the Cloudflare quick-tunnel used for temporary public sharing.
    allowedHosts: ['.trycloudflare.com'],
  },
})
