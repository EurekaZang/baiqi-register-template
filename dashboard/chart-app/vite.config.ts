import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import path from "node:path"

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, "../static/chart"),
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: path.resolve(__dirname, "src/main.tsx"),
      formats: ["es"],
      fileName: () => "usage-chart.js",
    },
    rollupOptions: {
      // Bundle react/react-dom/motion/d3 into the single ES module (no CDN).
      external: [],
      output: {
        assetFileNames: (info) =>
          info.name && info.name.endsWith(".css")
            ? "usage-chart.css"
            : "assets/[name][extname]",
        inlineDynamicImports: true,
      },
    },
    target: "es2022",
    sourcemap: true,
  },
})
