import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  server: {
    port: 5177,
    proxy: {
      "/api": "http://127.0.0.1:5178",
      "/media": "http://127.0.0.1:5178",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../src"),
      react: path.resolve(__dirname, "../node_modules/react"),
      "react-dom": path.resolve(__dirname, "../node_modules/react-dom"),
      remotion: path.resolve(__dirname, "../node_modules/remotion"),
      "@remotion/three": path.resolve(__dirname, "../node_modules/@remotion/three"),
      three: path.resolve(__dirname, "../node_modules/three"),
      zod: path.resolve(__dirname, "../node_modules/zod"),
    },
  },
});
