import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.BASE_PATH || "/chess-review/",
  worker: { format: "es" },
});
