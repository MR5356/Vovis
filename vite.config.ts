import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "vite";
export default defineConfig({
  plugins: [
    tailwindcss(),
    {
      name: "pdfjs-offline-resources",
      generateBundle() {
        const root = fileURLToPath(
          new URL("./node_modules/pdfjs-dist/", import.meta.url),
        );
        for (const directory of ["cmaps", "standard_fonts", "iccs", "wasm"]) {
          for (const entry of readdirSync(join(root, directory), {
            withFileTypes: true,
          })) {
            if (entry.isFile())
              this.emitFile({
                type: "asset",
                fileName: `pdfjs/${directory}/${entry.name}`,
                source: readFileSync(join(root, directory, entry.name)),
              });
          }
        }
        this.emitFile({
          type: "asset",
          fileName: "pdfjs/LICENSE",
          source: readFileSync(join(root, "LICENSE")),
        });
      },
    },
  ],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    rollupOptions: {
      // Client-only Vite deliberately ignores Next/RSC directives in upstream UI packages.
      onwarn(warning, warn) {
        if (
          warning.code === "MODULE_LEVEL_DIRECTIVE" &&
          warning.message.includes("use client")
        )
          return;
        if (
          warning.code === "INVALID_ANNOTATION" &&
          warning.id?.includes("node_modules/zod/")
        )
          return;
        warn(warning);
      },
      output: {
        manualChunks(id) {
          if (
            id.includes("node_modules/mediabunny") ||
            id.includes("node_modules/html2canvas-pro")
          )
            return "video-export";
          if (id.includes("pdfjs-dist")) return "pdf";
          if (
            id.includes("/@radix-ui/") ||
            id.includes("/radix-ui/") ||
            id.includes("/sonner/")
          )
            return "primitives";
          if (id.includes("node_modules/zod")) return "validation";
          if (
            id.includes("react-dom/server") ||
            id.includes("react-dom-server")
          )
            return "slide-html";
          if (id.includes("node_modules")) return "vendor";
        },
      },
    },
  },
});
