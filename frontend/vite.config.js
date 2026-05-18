import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: [],
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        ws: true,
        configure: (proxy) => {
          proxy.on("error", (err) => {
            if (err.code !== "EPIPE" && err.code !== "ECONNREFUSED") {
              console.error("[proxy]", err.message);
            }
          });
        },
      },
    },
  },
});
