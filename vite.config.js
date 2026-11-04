import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "src",
  base: "./",
  plugins: [react()],
  server: {
    proxy: { "/api": "http://127.0.0.1:3001" },
    fs: { allow: [".."] },
  },
  build: {
    // The production CSP permits same-origin fonts, not data: font URLs.
    assetsInlineLimit: (filePath) =>
      /\.(?:woff2?|ttf|otf)$/i.test(filePath) ? false : undefined,
    outDir: "../dist",
    emptyOutDir: true,
  },
});
