import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// `import.meta.dirname` (not __dirname): package.json sets "type": "module",
// and native config loading will break __dirname in a future vite version.
const here = import.meta.dirname;

export default defineConfig({
  root: here,
  plugins: [react()],
  // Serve the Remotion public/ dir so <Player> preview can resolve
  // staticFile("sfx/…") audio in the browser.
  publicDir: resolve(here, "../public"),
  server: {
    port: 5177,
    strictPort: true, // never silently jump to another port (e.g. onto the API's 5178!)
    proxy: {
      "/api": "http://127.0.0.1:5178",
      "/media": "http://127.0.0.1:5178",
    },
  },
  resolve: {
    alias: {
      "@": resolve(here, "../src"),
      react: resolve(here, "../node_modules/react"),
      "react-dom": resolve(here, "../node_modules/react-dom"),
      remotion: resolve(here, "../node_modules/remotion"),
      "@remotion/three": resolve(here, "../node_modules/@remotion/three"),
      three: resolve(here, "../node_modules/three"),
      zod: resolve(here, "../node_modules/zod"),
    },
  },
});
