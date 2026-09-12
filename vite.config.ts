import { defineConfig } from "vite";

export default defineConfig({
  server: { proxy: { "/api": "http://127.0.0.1:4187" } },
  build: { rollupOptions: { input: { home: "index.html", play: "play.html" } } },
});
