import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import manifest from "./manifest.json" with { type: "json" };

export default defineConfig({
    plugins: [
        // Beacon SDK + some Taquito deps reach for Node's crypto/stream/buffer/etc.
        // Polyfill them so the browser bundle actually runs.
        nodePolyfills({
            include: ["crypto", "stream", "buffer", "util", "events", "process"],
            globals: { Buffer: true, global: true, process: true },
        }),
        crx({ manifest }),
    ],
    build: {
        outDir: "dist",
        emptyOutDir: true,
        target: "esnext",
        // Disable Vite's module-preload helper. It prefetches dynamic-import
        // dependencies using an ABSOLUTE "/assets/…" path. In a content script
        // that path resolves against the PAGE origin (bsky.app), not the
        // extension, so Firefox fetches bsky's HTML → NS_ERROR_CORRUPTED_CONTENT /
        // "disallowed MIME type". With this off, dynamic imports resolve relative
        // to the importing module's real moz-extension:// / chrome-extension:// URL.
        modulePreload: false,
        rollupOptions: {
            output: {
                // Stable, hashless filenames. An extension is loaded from disk,
                // so content-hashing buys no caching benefit — but it actively
                // hurts the dev loop: crxjs's content-script loader dynamically
                // imports the content chunk BY NAME, and when a hash changes on
                // rebuild, any already-open tab's injected loader 404s on the now
                // deleted chunk. Stable names mean an old loader always resolves
                // to a file that still exists (with current code).
                entryFileNames: "assets/[name].js",
                chunkFileNames: "assets/[name].js",
                assetFileNames: "assets/[name].[ext]",
            },
        },
    },
    server: {
        port: 5173,
        strictPort: true,
        hmr: { port: 5173 },
    },
});
