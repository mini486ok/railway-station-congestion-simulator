import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: './' → GitHub Pages 의 어떤 저장소 경로(/<repo>/)에서도 상대경로로 동작.
// 워커는 module 형식으로 빌드(Pyodide 는 ESM 동적 import 로 로드).
export default defineConfig({
  base: "./",
  plugins: [react()],
  worker: { format: "es" },
  build: { target: "es2020", chunkSizeWarningLimit: 1500 },
});
