// Post-build manifest cleanup.
//
// crxjs injects `use_dynamic_url` into each web_accessible_resources entry.
// It's a Chrome-only key; Firefox logs "An unexpected property was found in
// the WebExtension manifest" and AMO flags it. Removing it is safe for Chrome
// too — false is the default behavior — so one cleaned build serves both stores.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const manifestPath = resolve(import.meta.dirname, "../dist/manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

let stripped = 0;
for (const entry of manifest.web_accessible_resources ?? []) {
    if ("use_dynamic_url" in entry) {
        delete entry.use_dynamic_url;
        stripped++;
    }
}

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`postbuild: stripped use_dynamic_url from ${stripped} WAR entr${stripped === 1 ? "y" : "ies"}`);
