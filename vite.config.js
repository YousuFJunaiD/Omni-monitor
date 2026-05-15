import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'

// Standard React/Vite config.
//
// Notes for future maintainers (Phase 14 follow-up):
//
//   • `optimizeDeps.include` explicitly pre-bundles jspdf and jspdf-autotable
//     during dev. Without this, Vite's dep-optimizer walks into the jspdf
//     package directory, where it can encounter HTML demo files. The
//     vite:import-analysis plugin then tries to parse those HTML files as JS
//     and fails at `<title>...</title>` with: "Failed to parse source for
//     import analysis ... content contains invalid JS syntax". This made
//     `npx vercel dev` crash before any code ran. Listing jspdf in
//     optimizeDeps.include short-circuits the scan and routes the package
//     through the proper bundler path.
//
//   • `manualChunks` only runs at build time, not dev. The defensive
//     extension check ensures the function never returns a chunk name for
//     anything that isn't a JS-like module — protecting against any future
//     bundler quirks where non-JS paths leak into the callback.
//
//   • Keeping `id.includes('jspdf')` → undefined lets rollup follow the
//     dynamic-import boundary in src/lib/reportPdf.js so the ~370 kB PDF
//     code stays in a lazy chunk that only loads when a CEO clicks Download.
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ['jspdf', 'jspdf-autotable']
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Defensive: never chunk anything that isn't a JS-like module.
          if (!/\.(?:js|mjs|cjs|jsx|ts|tsx)(?:\?|$)/.test(id)) return undefined
          if (!id.includes('node_modules')) return undefined
          // jsPDF + autotable stay in the lazy reportPdf chunk.
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
