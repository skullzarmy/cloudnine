/**
 * Wallet-list pipeline for our headless pairing picker.
 *
 * This mirrors octez.connect-ui's `useWallets` hook so our own picker shows the
 * same wallets and connect methods as the SDK's built-in dialog — without us
 * hand-maintaining a wallet list. Data comes from the SDK's bundled registry
 * (instant) with a best-effort refresh from the same GitHub/jsDelivr source the
 * SDK uses. We render our own UI only because the SDK's dialog can't read the
 * pairing promises from a Firefox content script (see
 * docs/octez-connect-firefox-issue.md); the wallet *data/logic* is reused.
 *
 * Vendored (not imported) from @tezos-x/octez.connect-ui/src/utils/wallets.ts
 * because that module isn't part of the package's public exports.
 */

import bundledRegistry from "@tezos-x/octez.connect-ui/data/tezos.json";
import { PostMessageTransport } from "@tezos-x/octez.connect-transport-postmessage";

// Indices into MergedWallet.links — mirrors octez.connect-ui's OSLink enum.
export const OSLink = { WEB: 0, IOS: 1, DESKTOP: 2, EXTENSION: 3 };

const JSDELIVR_URL =
    "https://cdn.jsdelivr.net/gh/airgap-it/beacon-wallet-list@latest/dist/tezos.json";
const FETCH_TIMEOUT_MS = 5000;
// Same default featured ordering the SDK uses.
const FEATURED = ["kukai", "temple", "plenty", "umami"];

export const getTzip10Link = (url, payload) =>
    `${url}?type=tzip10&data=${payload}`;

// --- vendored from octez.connect-ui/src/utils/wallets.ts ---------------------

function parseWallets(wallets) {
    const tokens = ["Web", "web", "App", "app", "Mobile", "mobile"];
    return wallets.map((w) => {
        let name = w.name ?? "";
        for (const t of tokens) if (name.includes(t)) name = name.replace(t, "");
        return { ...w, name: name.trim() };
    });
}

function setWalletLink(merged, w) {
    const choice =
        w.type === "web" ? OSLink.WEB
        : w.type === "extension" ? OSLink.EXTENSION
        : w.type === "ios" ? OSLink.IOS
        : OSLink.DESKTOP;
    merged.links[choice] = w.type === "ios" ? (w.deepLink ?? w.link) : w.link;
}

function mergeWallets(wallets) {
    const merged = [];
    for (const w of wallets) {
        const i = merged.findIndex((m) => m.name === w.name);
        if (i >= 0) {
            if (!merged[i].descriptions.includes(w.description)) {
                setWalletLink(merged[i], w);
                merged[i].descriptions.push(w.description);
            }
            merged[i].types.push(w.type);
            merged[i].deepLink = w.deepLink ?? merged[i].deepLink;
            if (w.key.includes("firefox")) merged[i].firefoxId = w.id;
        } else {
            const nm = {
                ...w,
                descriptions: [w.description],
                links: ["", "", "", ""],
                types: [w.type],
                firefoxId: w.key.includes("firefox") ? w.id : undefined,
            };
            setWalletLink(nm, w);
            merged.push(nm);
        }
    }
    return merged;
}

function arrangeTopWallets(arr, ids) {
    const front = ids.slice(0, 4);
    const top = [];
    const rest = [];
    for (const item of arr) {
        let pos;
        front.some((id, idx) => {
            const is = item.key.startsWith(id);
            if (is) pos = idx;
            return is;
        });
        if (pos !== undefined) top[pos] = item;
        else rest.push(item);
    }
    rest.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return [...top.filter(Boolean), ...rest];
}

// --- transform raw registry → Wallet[] (mirrors useWallets) ------------------

function toMergedWallets(reg, availableExtensions) {
    const extensions = (reg.extensionList || []).map((w) => ({
        id: w.id, key: w.key, name: w.shortName, image: w.logo,
        description: "Browser Extension",
        supportedInteractionStandards: w.supportedInteractionStandards,
        type: "extension", link: w.link, deprecated: w.deprecated,
    }));
    const desktop = (reg.desktopList || [])
        .filter((w) => !availableExtensions.some((e) => w.name === e.name))
        .map((w) => ({
            id: w.key, key: w.key, name: w.shortName, image: w.logo,
            description: "Desktop App",
            supportedInteractionStandards: w.supportedInteractionStandards,
            type: "desktop", link: w.downloadLink, deepLink: w.deepLink,
            deprecated: w.deprecated,
        }));
    const ios = (reg.iOSList || []).map((w) => ({
        id: w.key, key: w.key, name: w.shortName, image: w.logo,
        description: "Mobile App",
        supportedInteractionStandards: w.supportedInteractionStandards,
        type: "ios", link: w.universalLink, deepLink: w.deepLink,
        deprecated: w.deprecated,
    }));
    const web = (reg.webList || []).map((w) => ({
        id: w.key, key: w.key, name: w.shortName, image: w.logo,
        description: "Web App",
        supportedInteractionStandards: w.supportedInteractionStandards,
        type: "web", link: w.links?.mainnet, deprecated: w.deprecated,
    }));
    // Extensions actually detected on the page that aren't in the static list.
    const detected = (availableExtensions || [])
        .filter((e) => !(reg.extensionList || []).some((w) => w.id === e.id))
        .map((e) => ({
            id: e.id, key: e.id, name: e.shortName ?? e.name ?? "",
            image: e.iconUrl ?? "", description: "Browser Extension",
            type: "extension", link: e.link ?? "",
        }));

    const all = [...desktop, ...extensions, ...ios, ...web, ...detected];
    const merged = mergeWallets(parseWallets(all)).filter((wl) => {
        if (!wl.deprecated) return true;
        // Keep deprecated extensions only if actually installed.
        if (wl.types.includes("extension"))
            return availableExtensions.some(
                (e) => e.id === wl.id || e.id === wl.firefoxId,
            );
        return true;
    });
    return arrangeTopWallets(merged, FEATURED);
}

async function fetchGithubRegistry() {
    try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
        const res = await fetch(JSDELIVR_URL, { signal: ctrl.signal, cache: "default" });
        clearTimeout(t);
        return res.ok ? await res.json() : null;
    } catch {
        return null; // offline / blocked → fall back to bundled
    }
}

let _walletsPromise = null;

/**
 * Resolve the merged wallet list once per page session. Uses the freshest data
 * available (GitHub if reachable, else the SDK's bundled registry) and folds in
 * any browser extensions detected on the page.
 */
export function loadWallets() {
    if (!_walletsPromise) {
        _walletsPromise = (async () => {
            const [github, exts] = await Promise.all([
                fetchGithubRegistry(),
                PostMessageTransport.getAvailableExtensions().catch(() => []),
            ]);
            return toMergedWallets(github || bundledRegistry, exts || []);
        })();
    }
    return _walletsPromise;
}
