/**
 * Settings popup.
 *
 * Sections:
 *   1. Enable/disable toggle
 *   2. Wallet — shows address connected via buy modal (synced via chrome.storage)
 *              Disconnect clears the stored address.
 *   3. Purchase history — confirmed buys with share-to-bsky buttons.
 */

import { getSettings, setSettings, onSettingsChanged } from "../lib/storage.js";
import { shortAddr } from "../lib/format.js";

const $ = (id) => document.getElementById(id);

async function init() {
    const manifest = chrome.runtime.getManifest();
    $("cn-version").textContent = `v${manifest.version}`;

    const data = await getSettings();

    // --- Enable toggle ---
    const toggle = $("activeToggle");
    toggle.checked = data.isEnabled !== false;
    toggle.addEventListener("change", (e) => {
        setSettings({ isEnabled: e.target.checked });
    });

    // --- Wallet ---
    renderWallet(data.connectedWallet);

    $("cn-disconnect").addEventListener("click", async () => {
        // Clear DAppClient beacon state from bsky.app's localStorage.
        // Wallet connect only works in-page (bsky.app), never from this popup —
        // so disconnect is the only wallet action we can perform here.
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.url?.startsWith("https://bsky.app")) {
            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                world: "MAIN",
                func: () => {
                    Object.keys(localStorage)
                        .filter(k => k.startsWith("beacon:"))
                        .forEach(k => localStorage.removeItem(k));
                },
            }).catch(() => {});
        }
        await setSettings({ connectedWallet: null });
        renderWallet(null);
    });

    // --- History ---
    renderHistory(data.purchaseHistory || []);

    // Live-update wallet + history if they change while popup is open
    onSettingsChanged((changes) => {
        if (changes.connectedWallet !== undefined) {
            renderWallet(changes.connectedWallet.newValue);
        }
        if (changes.purchaseHistory !== undefined) {
            renderHistory(changes.purchaseHistory.newValue || []);
        }
    });
}

// ---------------------------------------------------------------------------
// Wallet
// ---------------------------------------------------------------------------

function renderWallet(address) {
    const connected = $("cn-wallet-connected");
    const empty     = $("cn-wallet-empty");
    const addrEl    = $("cn-wallet-addr");

    if (address) {
        addrEl.textContent = shortAddr(address);
        addrEl.title = address;
        connected.classList.remove("hidden");
        empty.classList.add("hidden");
    } else {
        connected.classList.add("hidden");
        empty.classList.remove("hidden");
    }
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

function renderHistory(history) {
    const list  = $("cn-history-list");
    const empty = $("cn-history-empty");

    list.innerHTML = "";

    if (!history.length) {
        empty.classList.remove("hidden");
        return;
    }
    empty.classList.add("hidden");

    for (const entry of history) {
        list.appendChild(buildHistoryItem(entry));
    }
}

function buildHistoryItem(entry) {
    const item = document.createElement("div");
    item.className = "cn-history-item";

    // Thumbnail
    if (entry.thumb) {
        const img = document.createElement("img");
        img.className = "cn-history-thumb";
        img.src = entry.thumb;
        img.alt = "";
        img.onerror = () => img.replaceWith(thumbFallback());
        item.appendChild(img);
    } else {
        item.appendChild(thumbFallback());
    }

    // Meta
    const meta = document.createElement("div");
    meta.className = "cn-history-meta";

    const name = document.createElement("div");
    name.className = "cn-history-name";
    name.textContent = entry.tokenName;
    name.title = entry.tokenName;

    const detail = document.createElement("div");
    detail.className = "cn-history-detail";
    const market = entry.marketplace === "objkt" ? "objkt.com" : "teia.art";
    const date   = new Date(entry.timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    detail.textContent = `${entry.priceTez} ꜩ · ${market} · ${date}`;

    meta.appendChild(name);
    meta.appendChild(detail);
    item.appendChild(meta);

    // Actions
    const actions = document.createElement("div");
    actions.className = "cn-history-actions";

    const shareBtn = document.createElement("button");
    shareBtn.className = "cn-btn cn-btn-share";
    const shareIcon = document.createElement("img");
    shareIcon.className = "cn-bsky-icon";
    shareIcon.src = chrome.runtime.getURL("public/icons/bsky-logo.svg");
    shareIcon.alt = "";
    shareBtn.appendChild(shareIcon);
    shareBtn.appendChild(document.createTextNode("Share"));
    shareBtn.addEventListener("click", () => {
        const text = buildShareText(entry);
        const url  = `https://bsky.app/intent/compose?text=${encodeURIComponent(text)}`;
        chrome.tabs.create({ url });
    });

    const opBtn = document.createElement("a");
    opBtn.className = "cn-btn cn-btn-ghost";
    opBtn.textContent = "Op";
    opBtn.href = `https://tzkt.io/${entry.opHash}`;
    opBtn.target = "_blank";
    opBtn.rel = "noreferrer noopener";
    opBtn.style.textDecoration = "none";
    opBtn.style.display = "block";
    opBtn.style.textAlign = "center";

    actions.appendChild(shareBtn);
    actions.appendChild(opBtn);
    item.appendChild(actions);

    return item;
}

function thumbFallback() {
    const div = document.createElement("div");
    div.className = "cn-history-thumb-fb";
    div.textContent = "☁";
    return div;
}

function buildShareText(entry) {
    let text = `Just collected "${entry.tokenName}"`;
    if (entry.artist) {
        const { shortAddr: sa } = { shortAddr: (a) => a.slice(0, 5) + "…" + a.slice(-4) };
        const display = /^tz/.test(entry.artist) ? sa(entry.artist) : entry.artist;
        text += ` by ${display}`;
    }
    const market = entry.marketplace === "objkt" ? "objkt.com" : "teia.art";
    text += ` on ${market} ✨`;
    if (entry.tokenUrl) text += `\n\n${entry.tokenUrl}`;
    return text;
}

init();
