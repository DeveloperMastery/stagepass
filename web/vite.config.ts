import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    // In development, send /api calls to the API running on port 3000.
    // In production, Nginx does this job.
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
