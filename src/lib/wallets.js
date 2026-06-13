/**
 * Wallet-list pipeline for our headless pairing picker.
 *
 * The wallet list comes from the octez.connect SDK we already ship: the
 * DAppClient populates octez.connect-ui's list getters from its own compiled
 * Tezos registry (@tezos-x/octez.connect-blockchain-tezos). We read those
 * getters and reuse the SDK's merge logic, so our picker shows exactly the
 * wallets the installed SDK version knows about — no airgap fetch, no CDN, no
 * separate snapshot to go stale. We render our own UI only because the SDK's
 * built-in dialog can't read the pairing promises from a Firefox content script.
 *
 * The merge/transform helpers below are vendored from
 * @tezos-x/octez.connect-ui/src/utils/wallets.ts (not part of its public exports).
 */

import {
    getExtensionList,
    getWebList,
    getDesktopList,
    getiOSList,
} from "@tezos-x/octez.connect-ui";

// Indices into MergedWallet.links — mirrors octez.connect-ui's OSLink enum.
export const OSLink = { WEB: 0, IOS: 1, DESKTOP: 2, EXTENSION: 3 };

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

/**
 * Read the SDK's per-OS wallet lists. The DAppClient fills these getters from its
 * compiled Tezos registry when it initialises its blockchain; the picker only
 * opens during a pairing request (after the client exists), so they're normally
 * ready — but poll briefly in case the modal wins the race.
 */
async function readSdkRegistry() {
    for (let i = 0; i < 20; i++) {
        const extensionList = getExtensionList() || [];
        const webList = getWebList() || [];
        if (extensionList.length || webList.length) {
            return {
                extensionList,
                webList,
                desktopList: getDesktopList() || [],
                iOSList: getiOSList() || [],
            };
        }
        await new Promise((r) => setTimeout(r, 50));
    }
    return {
        extensionList: getExtensionList() || [],
        webList: getWebList() || [],
        desktopList: getDesktopList() || [],
        iOSList: getiOSList() || [],
    };
}

let _walletsPromise = null;

/**
 * Resolve the merged wallet list once per page session, from the installed SDK's
 * own registry. If it's somehow empty the picker still shows the QR, which pairs
 * any wallet without needing the list.
 */
export function loadWallets() {
    if (!_walletsPromise) {
        _walletsPromise = (async () => toMergedWallets(await readSdkRegistry(), []))();
    }
    return _walletsPromise;
}
