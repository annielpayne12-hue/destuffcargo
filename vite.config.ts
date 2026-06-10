import { defineConfig } from "vite";
import { miaodaDevPlugin } from "miaoda-sc-plugin";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import path from "path";
import { createRequire } from "module";
import { copyFileSync } from "fs";

const require = createRequire(import.meta.url);

// Resolve the pdfjs worker path via Node module resolution (works with pnpm hoisting)
function resolvePdfjsWorker(): string {
  try {
    return require.resolve("pdfjs-dist/build/pdf.worker.min.mjs");
  } catch {
    // Fallback: walk pnpm store
    return path.resolve(
      __dirname,
      "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
    );
  }
}

/**
 * Vite plugin — copies the pdfjs worker as pdf.worker.js into public/.
 *
 * WHY: The hosting CDN (Cloudflare Pages) serves .mjs files as
 * application/octet-stream.  Browsers enforce strict MIME checking for
 * module workers AND for dynamic import(), so both the real Worker and the
 * pdfjs fake-worker fallback crash.  Renaming the file to .js causes the CDN
 * to serve it as application/javascript — the problem disappears entirely.
 *
 * This runs at buildStart so the file is always present in the public/
 * directory during dev (vite dev) and is copied verbatim to dist/ for prod.
 */
const copyPdfjsWorkerPlugin = {
  name: "copy-pdfjs-worker",
  buildStart() {
    try {
      copyFileSync(
        resolvePdfjsWorker(),
        path.resolve(__dirname, "public/pdf.worker.js"),
      );
    } catch (e) {
      console.warn("[copy-pdfjs-worker] Could not copy worker:", e);
    }
  },
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    copyPdfjsWorkerPlugin,
    react(),
    miaodaDevPlugin(),
    svgr({
      svgrOptions: {
        icon: true,
        exportType: "named",
        namedExport: "ReactComponent",
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // Raise the inline-asset threshold slightly so small icons/fonts are inlined
    assetsInlineLimit: 4096,
    rollupOptions: {
      output: {
        // Split heavy vendor libs into separate cached chunks so the main app
        // shell stays small and repeat visits only re-download what changed.
        manualChunks(id) {
          // PDF.js — ~2.5 MB — loaded on demand, never in the app shell
          if (id.includes('pdfjs-dist')) return 'vendor-pdfjs';
          // SheetJS (xlsx) — ~500 KB — loaded on demand
          if (id.includes('node_modules/xlsx')) return 'vendor-xlsx';
          // Recharts + D3 — only needed on Reports page
          if (id.includes('recharts') || id.includes('d3-') || id.includes('victory-')) return 'vendor-charts';
          // Radix UI primitives — shared across all pages but cache independently
          if (id.includes('@radix-ui')) return 'vendor-radix';
          // Supabase client
          if (id.includes('@supabase')) return 'vendor-supabase';
          // React core
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) return 'vendor-react';
        },
      },
    },
  },
});
