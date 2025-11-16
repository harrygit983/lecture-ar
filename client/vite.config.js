import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0', // optional, but nice if you want to hit it from LAN too
    port: 5173,
    allowedHosts: [
      'stemmed-noncash-ginger.ngrok-free.dev', // your ngrok URL host
    ],
  },
})
