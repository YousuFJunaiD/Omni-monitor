import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          // Phase 14: keep jsPDF + autotable in the lazy reportPdf chunk so the
          // ~250 KB cost is only paid when a CEO actually clicks Download PDF.
          // Returning undefined lets rollup follow the dynamic-import boundary.
          if (id.includes('jspdf')) return undefined
          if (id.includes('react') || id.includes('react-router-dom')) return 'react'
          if (id.includes('lucide-react')) return 'icons'
          if (id.includes('@supabase')) return 'supabase'
          return 'vendor'
        }
      }
    }
  }
})
