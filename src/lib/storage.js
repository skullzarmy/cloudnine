/**
 * Settings + history storage.
 *
 *   isEnabled:       bool     — master on/off switch
 *   refWallet:       tz1...   — FAFOlab referrer wallet (hardcoded, not user-settable)
 *   connectedWallet: tz1... | null — wallet address last connected via buy modal
 *   purchaseHistory: array   — recent confirmed purchases (max 20)
 *   network:         "mainnet"
 *   rpc:             RPC URL
 */

export const DEFAULTS = {
    isEnabled: true,
    refWallet: "tz1ZzSmVcnVaWNZKJradtrDnjSjzTp6qjTEW", // FAFOlab — not user-settable
    connectedWallet: null,
    purchaseHistory: [],
    network: "mainnet",
    rpc: "https://mainnet.smartpy.io",
};

const STORAGE_KEYS = Object.keys(DEFAULTS);
const MAX_HISTORY = 20;

export async function getSettings() {
    return new Promise((resolve) => {
        chrome.storage.local.get(STORAGE_KEYS, (data) => {
            resolve({ ...DEFAULTS, ...data });
        });
    });
}

export async function setSettings(patch) {
    return new Promise((resolve) => {
        chrome.storage.local.set(patch, () => resolve());
    });
}

export function onSettingsChanged(callback) {
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local") return;
        callback(changes);
    });
}

/**
 * @param {{
 *   tokenName: string,
 *   priceTez: string,
 *   opHash: string,
 *   tokenUrl: string|null,
 *   marketplace: string,
 *   artist: string|null,
 *   thumb: string|null,
 *   timestamp: number
 * }} entry
 */
export async function addPurchase(entry) {
    const data = await getSettings();
    const history = Array.isArray(data.purchaseHistory) ? data.purchaseHistory : [];
    history.unshift(entry);
    if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
    await setSettings({ purchaseHistory: history });
}
