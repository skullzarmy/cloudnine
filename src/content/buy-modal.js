/**
 * In-page buy modal.
 *
 * Runs in the content-script context on bsky.app — NOT in a chrome-extension://
 * popup. This means:
 *   - Temple Wallet's content script is present on the same page
 *   - window.postMessage reaches the wallet extension's bridge
 *   - octez.connect DAppClient pairing works (browser extension detected, no QR fallback)
 *
 * Dynamically imported from content.js when the user clicks a Buy button so
 * the 3MB Taquito + octez.connect chunk is only fetched on demand.
 */

import { TezosToolkit } from "@taquito/taquito";
import {
    DAppClient,
    NetworkType,
    TezosOperationType,
    PermissionScope,
    BeaconEvent,
} from "@tezos-x/octez.connect-sdk";

import QRCode from "qrcode-svg";

import { getDescriptorForListing, HEN_OBJKTS_FA2 } from "../lib/contracts.js";
import { resolveListing } from "../lib/resolver.js";
import { getSettings, setSettings, addPurchase } from "../lib/storage.js";
import { shortAddr, formatTez, isTzAddress } from "../lib/format.js";
import { loadWallets, OSLink, getTzip10Link } from "../lib/wallets.js";

const TZKT_API = "https://api.tzkt.io/v1";
const DEFAULT_RPC = "https://mainnet.smartpy.io";
const MODAL_HOST_ID = "cn-buy-modal-host";

// ---------------------------------------------------------------------------
// Singletons — survive across modal opens within the same page session
// ---------------------------------------------------------------------------

// Headless pairing — Firefox content-script workaround ------------------------
// octez.connect's own pairing dialog runs in a different JS realm than our
// content script, so on Firefox it can't read the peer-info promises it's handed
// ("Permission denied to access property 'then'") and web wallets never pair.
// We override ONLY the PAIR_INIT event, read those promises in our own
// compartment (verified working on Firefox), and render our own wallet chooser.
// Every other default event/UI (permission, operation, success/error) is left
// intact. See docs/octez-connect-firefox-issue.md.
// The open modal registers a callback here so this module-scope handler can hand
// the resolved sync codes back to it for rendering. Only one modal is open at a
// time, so a single slot is enough.
let _onPairInit = null;

async function pairInitHandler(data) {
    loadWallets(); // warm the wallet list while the transports connect
    // These awaits are the whole point: they run in our content-script compartment
    // (same realm that created the promises), where reading them is permitted —
    // unlike the SDK's injected UI.
    let p2pCode = "";
    let postCode = "";
    try { p2pCode = await data.p2pPeerInfo; }
    catch (e) { console.warn("Cloudnine pairing: P2P sync code unavailable", e); }
    try { postCode = await data.postmessagePeerInfo; }
    catch (e) { console.warn("Cloudnine pairing: postMessage sync code unavailable", e); }
    _onPairInit?.({ p2pCode, postCode, abort: data.abortedHandler });
}

let _client = null;
function getClient() {
    if (!_client) {
        _client = new DAppClient({
            name: "Cloudnine",
            network: { type: NetworkType.MAINNET },
            // We never use WalletConnect — pairing here is postMessage/P2P only.
            // The WC transport throws in Firefox's isolated content-script ("Xray")
            // compartment. Skipping it leaves postMessage/P2P working on both
            // browsers. See docs/octez-connect-firefox-issue.md.
            disableWalletConnect: true,
            // Replace only the pairing UI with our own headless chooser (above).
            eventHandlers: {
                [BeaconEvent.PAIR_INIT]: { handler: pairInitHandler },
            },
        });
    }
    return _client;
}

let _tezos = null;
function getTezos(rpc) {
    if (!_tezos) _tezos = new TezosToolkit(rpc || DEFAULT_RPC);
    return _tezos;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function openBuyModal({ parsed, listing, settings: settingsOverride }) {
    // Remove any previously open modal
    document.getElementById(MODAL_HOST_ID)?.remove();

    const settings = { ...(await getSettings()), ...(settingsOverride || {}) };

    // Backdrop (click outside = close)
    const backdrop = document.createElement("div");
    backdrop.id = MODAL_HOST_ID;
    backdrop.className = "cn-modal-backdrop";
    backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) backdrop.remove();
    });

    // Dialog
    const dialog = document.createElement("div");
    dialog.className = "cn-modal-dialog";
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    // Render static HTML structure
    buildModalHTML(dialog, listing, parsed, settings);

    // Wire up all interactive logic
    await initLogic(dialog, { parsed, listing, settings });
}

// ---------------------------------------------------------------------------
// HTML builder
// ---------------------------------------------------------------------------

// Escape values that flow into innerHTML. Token name / artist / thumb come from
// third-party marketplace APIs and render inside bsky.app's page, so an unescaped
// `<img onerror=…>` in a token name would be XSS. Static markup stays literal;
// only untrusted values pass through here.
function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
    );
}

function buildModalHTML(dialog, listing, parsed, settings) {
    const name = listing?.token?.name || "Tezos NFT";
    const artist = listing?.token?.artist ?? null;
    const artistDisplay = artist
        ? (isTzAddress(artist) ? shortAddr(artist) : artist)
        : "";
    const sourceLabel =
        parsed?.source === "objkt" ? "objkt.com" :
        parsed?.source === "teia"  ? "teia.art"  : "";
    const priceDisplay = listing ? formatTez(listing.price_tez) : "—";
    const isOpenEdition = listing?.kind === "open_edition";
    const editionsHTML = isOpenEdition
        ? `<div class="cn-modal-row">
               <span class="cn-modal-label">Available</span>
               <span class="cn-modal-value">Open edition</span>
           </div>`
        : listing?.editions != null
        ? `<div class="cn-modal-row">
               <span class="cn-modal-label">Available</span>
               <span class="cn-modal-value">${listing.editions}</span>
           </div>`
        : "";

    dialog.innerHTML = `
        <div class="cn-modal-header">
            <div class="cn-modal-brand">
                <img class="cn-modal-logo-mark" src="${chrome.runtime.getURL('public/icons/cloud9-logo.svg')}" alt="" />
                <img class="cn-modal-logo-text" src="${chrome.runtime.getURL('public/icons/cloud9-text.svg')}" alt="Cloudnine" />
            </div>
            <button class="cn-modal-x" id="cn-mx" aria-label="Close">✕</button>
        </div>

        <div class="cn-modal-body">
            <div class="cn-modal-token">
                <div class="cn-modal-thumb" id="cn-m-thumb"><span class="cn-modal-thumb-fb">…</span></div>
                <div class="cn-modal-meta">
                    <div class="cn-modal-title">${escapeHtml(name)}</div>
                    ${artistDisplay ? `<div class="cn-modal-artist">${escapeHtml(artistDisplay)}</div>` : ""}
                    ${sourceLabel  ? `<div class="cn-modal-source">${sourceLabel}</div>` : ""}
                </div>
            </div>

            <div class="cn-modal-row cn-modal-price-row">
                <span class="cn-modal-label">Price</span>
                <span class="cn-modal-price" id="cn-m-price">${priceDisplay}</span>
            </div>
            ${editionsHTML}

            <div class="cn-modal-row cn-modal-wallet-row">
                <span class="cn-modal-label">Wallet</span>
                <div class="cn-modal-wallet-right">
                    <span class="cn-modal-addr" id="cn-m-addr">Not connected</span>
                    <div class="cn-modal-wallet-btns">
                        <button class="cn-modal-mini" id="cn-m-connect">Connect</button>
                        <button class="cn-modal-mini cn-modal-mini-danger hidden" id="cn-m-disconnect">Disconnect</button>
                        <button class="cn-modal-mini hidden" id="cn-m-change">Change</button>
                    </div>
                </div>
            </div>

            <div class="cn-modal-status hidden" id="cn-m-status"></div>

            <div class="cn-modal-actions">
                <button class="cn-modal-btn cn-modal-btn-ghost" id="cn-m-cancel">Cancel</button>
                <button class="cn-modal-btn cn-modal-btn-primary" id="cn-m-buy" disabled>
                    ${listing ? (listing.kind === "open_edition" ? `Mint ${listing.price_tez} ꜩ` : `Buy ${listing.price_tez} ꜩ`) : "Loading…"}
                </button>
            </div>

            <div class="cn-modal-receipt hidden" id="cn-m-receipt">
                <span class="cn-modal-label">Op</span>
                <a id="cn-m-ophash" class="cn-modal-link" target="_blank" rel="noreferrer noopener"></a>
            </div>
        </div>

        <footer class="cn-modal-footer">
            &lt;&lt; a FAFO<s>lab</s> joint &gt;&gt;
        </footer>
    `;

    // Thumbnail
    if (listing?.token?.thumb) {
        const wrap = dialog.querySelector("#cn-m-thumb");
        const img = document.createElement("img");
        img.src = listing.token.thumb;
        img.alt = "";
        img.onerror = () => { wrap.innerHTML = '<span class="cn-modal-thumb-fb">?</span>'; };
        wrap.innerHTML = "";
        wrap.appendChild(img);
    }

    // Close triggers
    dialog.querySelector("#cn-mx").addEventListener("click", () =>
        document.getElementById(MODAL_HOST_ID)?.remove()
    );
    dialog.querySelector("#cn-m-cancel").addEventListener("click", () =>
        document.getElementById(MODAL_HOST_ID)?.remove()
    );
}

// ---------------------------------------------------------------------------
// Interactive logic
// ---------------------------------------------------------------------------

async function initLogic(dialog, { parsed, listing: initialListing, settings }) {
    const client = getClient();
    const Tezos = getTezos(settings.rpc);

    let liveListing = initialListing;
    let activeAddress = null;

    const q = (id) => dialog.querySelector(`#${id}`);

    // --- Wallet state helpers ---

    function renderWallet(addr) {
        const el = q("cn-m-addr");
        if (addr) {
            if (el) { el.textContent = shortAddr(addr); el.title = addr; }
            q("cn-m-connect")   ?.classList.add("hidden");
            q("cn-m-disconnect")?.classList.remove("hidden");
            q("cn-m-change")    ?.classList.remove("hidden");
        } else {
            if (el) { el.textContent = "Not connected"; el.removeAttribute("title"); }
            q("cn-m-connect")   ?.classList.remove("hidden");
            q("cn-m-disconnect")?.classList.add("hidden");
            q("cn-m-change")    ?.classList.add("hidden");
        }
    }

    // "Mint" for open editions, "Buy" for secondary listings.
    const verb = () => (liveListing?.kind === "open_edition" ? "Mint" : "Buy");

    function updateBuyBtn() {
        const btn = q("cn-m-buy");
        if (!btn) return;
        if (!liveListing) { btn.disabled = true; btn.textContent = "No listing"; return; }
        btn.disabled = false;
        btn.textContent = activeAddress
            ? `${verb()} ${liveListing.price_tez} ꜩ`
            : `Connect & ${verb()}`;
    }

    function setStatus(text, kind = "") {
        const el = q("cn-m-status");
        if (!el) return;
        el.textContent = text;
        el.className = `cn-modal-status${kind ? ` cn-modal-status-${kind}` : ""}`;
        el.classList.remove("hidden");
    }

    function clearStatus() { q("cn-m-status")?.classList.add("hidden"); }

    // --- Headless wallet chooser (replaces octez.connect's injected pairing UI) ---

    // Children of the modal body we hide while the picker is up, restored on close.
    let _pairHidden = [];

    function removePairingPanel() {
        dialog.querySelector("#cn-m-pair")?.remove();
        for (const el of _pairHidden) el.style.display = "";
        _pairHidden = [];
    }

    // Full wallet picker — parity with octez.connect's built-in dialog, populated
    // from the same wallet registry (see ../lib/wallets.js). We render it instead
    // of the SDK's UI only because that UI can't read the pairing promises from a
    // Firefox content script; the connect actions below mirror the SDK's per-type
    // handling (extension postMessage / web + desktop tzip10 link / QR).
    async function renderPairingPanel({ p2pCode, postCode, abort }) {
        removePairingPanel();
        const body = dialog.querySelector(".cn-modal-body");
        if (!body) return;

        _pairHidden = Array.from(body.children);
        for (const el of _pairHidden) el.style.display = "none";

        const panel = document.createElement("div");
        panel.id = "cn-m-pair";
        panel.className = "cn-pair";
        panel.innerHTML = `
            <div class="cn-pair-head">
                <span class="cn-pair-title">Connect a wallet</span>
                <button class="cn-modal-mini" id="cn-pair-cancel">Cancel</button>
            </div>
            <div class="cn-pair-qr-top">
                <div class="cn-pair-qr" id="cn-pair-qr"></div>
                <div class="cn-pair-qr-hint" id="cn-pair-qr-hint"></div>
            </div>
            <div class="cn-pair-status" id="cn-pair-status"></div>
            <input class="cn-pair-search" id="cn-pair-search" type="text"
                   placeholder="Search wallets…" autocomplete="off" spellcheck="false" />
            <div class="cn-pair-list" id="cn-pair-list">
                <div class="cn-pair-empty">Loading wallets…</div>
            </div>
        `;
        body.appendChild(panel);

        const pstatus = (text, on = false) => {
            const el = panel.querySelector("#cn-pair-status");
            if (el) {
                el.textContent = text || "";
                el.classList.toggle("cn-pair-status-on", !!text && on);
            }
        };

        panel.querySelector("#cn-pair-cancel").addEventListener("click", () => {
            removePairingPanel();
            try { abort?.(); } catch { /* ignore */ }
        });

        const openTab = (url) => {
            // Plain anchor — never touch the new tab's .opener (that was the Firefox
            // SecurityError in the SDK's own redirect path).
            const a = document.createElement("a");
            a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer";
            a.click();
        };

        // --- QR, always visible at the top -----------------------------------
        const isMobile =
            window.matchMedia?.("(any-pointer:coarse)")?.matches ||
            /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        const tezosLink = getTzip10Link("tezos://", p2pCode);
        const qrEl = panel.querySelector("#cn-pair-qr");
        const qrHint = panel.querySelector("#cn-pair-qr-hint");
        if (p2pCode) {
            qrEl.innerHTML = new QRCode({
                content: tezosLink,
                padding: 0, width: 190, height: 190,
                color: "#000000", background: "#ffffff",
                // High error correction so the centre c9 logo doesn't break scans.
                ecl: "H",
                // viewBox output so the drawing scales + centers inside the
                // responsive white box (plain "svg" anchors it top-left).
                container: "svg-viewbox",
            }).svg();
            const qrLogo = document.createElement("div");
            qrLogo.className = "cn-pair-qr-logo";
            const qrLogoImg = document.createElement("img");
            qrLogoImg.src = chrome.runtime.getURL("public/icons/cloud9-logo.svg");
            qrLogoImg.alt = "";
            qrLogo.appendChild(qrLogoImg);
            qrEl.appendChild(qrLogo);
            if (isMobile) {
                // No second device to scan with — tapping fires the tezos: deep
                // link so the OS opens whichever wallet is set to handle it (or
                // shows its app picker).
                qrEl.classList.add("cn-pair-qr-tap");
                qrEl.setAttribute("role", "button");
                qrEl.setAttribute("tabindex", "0");
                qrEl.title = "Open in your wallet app";
                const openNative = () => {
                    const a = document.createElement("a");
                    a.href = tezosLink;
                    a.click();
                    pstatus("Opening your wallet app…", true);
                };
                qrEl.addEventListener("click", openNative);
                qrEl.addEventListener("keydown", (e) => {
                    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openNative(); }
                });
                qrHint.textContent = "Tap to open your wallet — or scan from another device";
            } else {
                qrHint.textContent = "Scan with a mobile wallet, or pick one below";
            }
        } else {
            qrHint.textContent = "Pairing code unavailable — pick a wallet below";
        }

        const connect = (w) => {
            if (w.types.includes("extension")) {
                // Mirror the SDK's extension handshake from our own code, so the
                // sync code never crosses the compartment boundary. Post to both
                // the Chrome and Firefox extension ids; only the right one answers.
                for (const targetId of [w.id, w.firefoxId].filter(Boolean)) {
                    window.postMessage(
                        { target: "toExtension", payload: postCode, targetId },
                        window.location.origin,
                    );
                }
                pstatus(`Approve the connection in ${w.name}…`, true);
            } else if (w.links[OSLink.WEB]) {
                openTab(getTzip10Link(w.links[OSLink.WEB], p2pCode));
                pstatus(`Continue in the ${w.name} tab, then come back…`, true);
            } else if (isMobile && (w.deepLink || w.links[OSLink.IOS])) {
                // Open the wallet's own mobile deep link directly.
                const a = document.createElement("a");
                a.href = getTzip10Link(w.deepLink || w.links[OSLink.IOS], p2pCode);
                a.click();
                pstatus(`Opening ${w.name}…`, true);
            } else if (w.links[OSLink.DESKTOP]) {
                openTab(getTzip10Link(w.links[OSLink.DESKTOP], p2pCode));
                pstatus(`Opening ${w.name}…`, true);
            } else {
                pstatus(`Scan the QR above with ${w.name}.`);
            }
        };

        let wallets = [];
        function renderList(filter = "") {
            const list = panel.querySelector("#cn-pair-list");
            if (!list) return;
            const f = filter.trim().toLowerCase();
            const shown = f ? wallets.filter((w) => w.name.toLowerCase().includes(f)) : wallets;
            if (!shown.length) {
                list.innerHTML = `<div class="cn-pair-empty">No matching wallets.</div>`;
                return;
            }
            list.innerHTML = "";
            for (const w of shown) {
                const badge =
                    w.types.includes("extension") ? "Browser extension"
                    : w.types.includes("web") ? "Web wallet"
                    : w.types.includes("desktop") ? "Desktop app"
                    : "Mobile";
                const row = document.createElement("button");
                row.className = "cn-pair-row";
                row.innerHTML = `
                    ${w.image ? `<img src="${escapeHtml(w.image)}" alt="" />` : `<span class="cn-pair-row-fb"></span>`}
                    <span class="cn-pair-row-meta">
                        <span class="cn-pair-name"></span>
                        <span class="cn-pair-badge">${badge}</span>
                    </span>`;
                row.querySelector(".cn-pair-name").textContent = w.name;
                row.addEventListener("click", () => connect(w));
                list.appendChild(row);
            }
        }

        panel.querySelector("#cn-pair-search")
            .addEventListener("input", (e) => renderList(e.target.value));

        try {
            wallets = await loadWallets();
        } catch (e) {
            console.warn("Cloudnine pairing: wallet list failed to load", e);
        }
        // Bail if the user cancelled while we were loading.
        if (!dialog.querySelector("#cn-m-pair")) return;
        renderList();
    }

    // Let the module-scope PAIR_INIT handler drive this modal's chooser.
    _onPairInit = renderPairingPanel;

    function showOpHash(hash) {
        const a = q("cn-m-ophash");
        if (a) { a.textContent = hash.slice(0, 10) + "…" + hash.slice(-6); a.href = `https://tzkt.io/${hash}`; a.title = hash; }
        q("cn-m-receipt")?.classList.remove("hidden");
    }

    // --- Post-purchase success screen ---

    function buildTokenUrl() {
        const tokenId = parsed?.token_id;
        if (!tokenId) return null;

        // Prefer teia.art for HEN/OBJKTS tokens — it serves static OpenGraph tags
        // (title, description, artwork og:image) so bsky renders a rich link card.
        // objkt.com renders OG client-side, which bsky's crawler can't see → no
        // preview image. HEN tokens are viewable on both, so always link to teia
        // for those regardless of where the buy happened.
        const fa = liveListing?.fa_contract || parsed?.fa_contract;
        if (parsed?.source === "teia" || fa === HEN_OBJKTS_FA2) {
            return `https://teia.art/objkt/${tokenId}`;
        }
        // Non-HEN objkt tokens (open editions, other FA2s) — objkt.com is the only
        // option; preview quality is limited by objkt's client-side OG rendering.
        return `https://objkt.com/tokens/${fa}/${tokenId}`;
    }

    function buildShareText() {
        const name     = liveListing?.token?.name || "a Tezos NFT";
        const artist   = liveListing?.token?.artist;
        const artistDisplay = artist
            ? (isTzAddress(artist) ? shortAddr(artist) : artist)
            : null;
        const tokenUrl = buildTokenUrl();
        // Label the marketplace to match the URL we link (which drives the card).
        const market   = tokenUrl?.includes("teia.art") ? "teia.art" : "objkt.com";

        const action = liveListing?.kind === "open_edition" ? "minted" : "collected";
        let text = `Just ${action} "${name}"`;
        if (artistDisplay) text += ` by ${artistDisplay}`;
        text += ` on ${market} ✨`;
        if (tokenUrl) text += `\n\n${tokenUrl}`;
        return text;
    }

    function showPending(opHash, { timedOut = false } = {}) {
        const body = dialog.querySelector(".cn-modal-body");
        if (!body) return;
        const subtitle = timedOut
            ? "Still waiting — check the op link to verify."
            : "On its way to the chain…";
        body.innerHTML = `
            <div class="cn-modal-pending">
                ${timedOut
                    ? `<div class="cn-modal-pending-title" style="font-size:28px">⏳</div>`
                    : `<div class="cn-modal-pending-spinner"></div>`}
                <div class="cn-modal-pending-title">Confirming…</div>
                <div class="cn-modal-pending-sub">${subtitle}</div>
                <a class="cn-modal-pending-op"
                   href="https://tzkt.io/${escapeHtml(opHash)}"
                   target="_blank" rel="noreferrer noopener"
                   title="${escapeHtml(opHash)}">
                   op: ${escapeHtml(opHash.slice(0, 8))}…${escapeHtml(opHash.slice(-6))}
                </a>
            </div>
        `;
    }

    function showSuccess(opHash) {
        const body = dialog.querySelector(".cn-modal-body");
        if (!body) return;

        const name     = liveListing?.token?.name || "Tezos NFT";
        const thumb    = liveListing?.token?.thumb;
        const shareUrl = `https://bsky.app/intent/compose?text=${encodeURIComponent(buildShareText())}`;

        body.innerHTML = `
            <div class="cn-modal-success">
                <div class="cn-modal-success-receipt">
                    ${thumb ? `<img class="cn-modal-success-thumb" src="${escapeHtml(thumb)}" alt="" />` : ""}
                    <div class="cn-modal-success-headline">IT'S YOURS!!</div>
                    <div class="cn-modal-success-name">${escapeHtml(name)}</div>
                    <a class="cn-modal-success-op"
                       href="https://tzkt.io/${escapeHtml(opHash)}"
                       target="_blank" rel="noreferrer noopener"
                       title="${escapeHtml(opHash)}">op: ${escapeHtml(opHash.slice(0, 8))}…${escapeHtml(opHash.slice(-6))}</a>
                </div>
            </div>
            <div class="cn-modal-success-actions">
                <button class="cn-modal-btn cn-modal-btn-share" id="cn-m-share">
                    <img class="cn-bsky-icon" src="${chrome.runtime.getURL('public/icons/bsky-logo.svg')}" alt="" />
                    Share on Bluesky
                </button>
                <button class="cn-modal-btn cn-modal-btn-ghost" id="cn-m-buyagain">
                    Buy again
                </button>
            </div>
        `;

        body.querySelector("#cn-m-share").addEventListener("click", () => {
            window.open(shareUrl, "_blank", "noopener,noreferrer");
        });

        body.querySelector("#cn-m-buyagain").addEventListener("click", async () => {
            buildModalHTML(dialog, liveListing, parsed, settings);
            await initLogic(dialog, { parsed, listing: liveListing, settings });
        });
    }

    // --- Check for existing wallet ---
    try {
        const existing = await client.getActiveAccount();
        if (existing?.address) {
            activeAddress = existing.address;
        }
    } catch { /* no stored account */ }
    renderWallet(activeAddress);

    updateBuyBtn();

    // Refresh listing price silently in background
    if (parsed) {
        resolveListing(parsed).then((fresh) => {
            if (!fresh) {
                setStatus("Listing sold — no longer available.", "error");
                const btn = q("cn-m-buy");
                if (btn) { btn.disabled = true; btn.textContent = "Unavailable"; }
                return;
            }
            liveListing = fresh;
            const priceEl = q("cn-m-price");
            if (priceEl) priceEl.textContent = formatTez(fresh.price_tez);
            updateBuyBtn();
        }).catch(() => {});
    }

    // --- Button handlers ---

    async function onConnect() {
        clearStatus();
        try {
            const existing = await client.getActiveAccount();
            if (!existing) {
                // requestPermissions() fires PAIR_INIT → pairInitHandler →
                // renderPairingPanel (our in-modal chooser). It resolves once the
                // chosen wallet responds over postMessage/P2P.
                setStatus("Preparing wallet connection…");
                await client.requestPermissions({
                    scopes: [PermissionScope.OPERATION_REQUEST],
                });
            }
            removePairingPanel();
            clearStatus();
            const account = await client.getActiveAccount();
            activeAddress = account?.address ?? null;
            renderWallet(activeAddress);
            updateBuyBtn();
            // Sync to chrome.storage so popup can show connected wallet
            setSettings({ connectedWallet: activeAddress }).catch(() => {});
        } catch (err) {
            removePairingPanel();
            if (isAbort(err)) clearStatus();
            else setStatus(`Connection failed: ${err?.message || err}`, "error");
        }
    }

    async function onDisconnect() {
        try { await client.clearActiveAccount(); } catch { }
        activeAddress = null;
        renderWallet(null);
        updateBuyBtn();
        clearStatus();
        setSettings({ connectedWallet: null }).catch(() => {});
    }

    async function onChange() {
        try { await client.clearActiveAccount(); } catch { }
        activeAddress = null;
        renderWallet(null);
        updateBuyBtn();
        await onConnect();
    }

    async function clearStaleConnection() {
        // Nuke beacon localStorage state (same fix as the popup disconnect)
        try {
            Object.keys(localStorage)
                .filter((k) => k.startsWith("beacon:"))
                .forEach((k) => localStorage.removeItem(k));
            await client.clearActiveAccount();
        } catch { /* ignore */ }
        activeAddress = null;
        renderWallet(null);
        updateBuyBtn();
        clearStatus();
        setSettings({ connectedWallet: null }).catch(() => {});
    }

    function showBuyError(err) {
        if (isAbort(err)) {
            setStatus("Cancelled in wallet.");
            const buyBtn = q("cn-m-buy");
            if (buyBtn) { buyBtn.disabled = false; buyBtn.textContent = `${verb()} ${liveListing?.price_tez ?? "?"} ꜩ`; }
            return;
        }

        const c = classifyWalletError(err);
        console.error("Cloudnine buy error:", err);

        // Build status with optional recovery buttons
        const statusEl = q("cn-m-status");
        if (!statusEl) return;
        statusEl.className = "cn-modal-status cn-modal-status-error";
        statusEl.classList.remove("hidden");

        const msgEl = document.createElement("div");
        msgEl.textContent = c.text;
        statusEl.innerHTML = "";
        statusEl.appendChild(msgEl);

        if (c.refreshListing) {
            // Re-fetch listing in background and update UI
            resolveListing(parsed).then((fresh) => {
                if (!fresh) {
                    msgEl.textContent = "Listing sold — no longer available.";
                    const buyBtn = q("cn-m-buy");
                    if (buyBtn) { buyBtn.disabled = true; buyBtn.textContent = "Sold out"; }
                } else {
                    liveListing = fresh;
                    msgEl.textContent = "Listing refreshed. Try again.";
                    const buyBtn = q("cn-m-buy");
                    if (buyBtn) { buyBtn.disabled = false; buyBtn.textContent = `${verb()} ${fresh.price_tez} ꜩ`; }
                }
            }).catch(() => {});
            return;
        }

        const actions = document.createElement("div");
        actions.style.cssText = "display:flex;gap:8px;margin-top:8px;flex-wrap:wrap";

        if (c.canClear) {
            const clearBtn = document.createElement("button");
            clearBtn.className = "cn-modal-mini";
            clearBtn.textContent = "Clear connection";
            clearBtn.addEventListener("click", async () => {
                await clearStaleConnection();
                if (c.canRetry) await onBuy();
            });
            actions.appendChild(clearBtn);
        }

        if (c.canRetry && !c.canClear) {
            const retryBtn = document.createElement("button");
            retryBtn.className = "cn-modal-mini";
            retryBtn.textContent = "Retry";
            retryBtn.addEventListener("click", () => {
                clearStatus();
                const buyBtn = q("cn-m-buy");
                if (buyBtn) { buyBtn.disabled = false; buyBtn.textContent = `${verb()} ${liveListing?.price_tez ?? "?"} ꜩ`; }
            });
            actions.appendChild(retryBtn);
        }

        if (actions.children.length) statusEl.appendChild(actions);
    }

    // Waiting view shown while a non-extension wallet (QR / mobile / web) signs.
    // Unlike the Temple browser extension — whose popup overlaps our modal, so we
    // hide ours — these approve elsewhere, so we keep the modal up. No Cancel: the
    // request is already in the wallet and Beacon gives us no way to recall it, so
    // offering one would be a lie. Returns a close() that restores the modal body.
    let _signHidden = [];
    function showSigningWait() {
        const body = dialog.querySelector(".cn-modal-body");
        if (!body) return () => {};
        _signHidden = Array.from(body.children).filter((c) => c.style.display !== "none");
        for (const el of _signHidden) el.style.display = "none";

        const panel = document.createElement("div");
        panel.id = "cn-m-signing";
        panel.className = "cn-modal-pending";
        panel.innerHTML = `
            <div class="cn-modal-pending-spinner"></div>
            <div class="cn-modal-pending-title">Waiting for approval…</div>
            <div class="cn-modal-pending-sub">Approve the transaction in your wallet.</div>
        `;
        body.appendChild(panel);

        return function closeSigningWait() {
            dialog.querySelector("#cn-m-signing")?.remove();
            for (const el of _signHidden) el.style.display = "";
            _signHidden = [];
        };
    }

    async function onBuy() {
        if (!liveListing) return;
        if (!activeAddress) {
            await onConnect();
            if (!activeAddress) return;
        }

        const desc = getDescriptorForListing(liveListing);
        if (!desc) {
            setStatus(`Unknown marketplace: ${shortAddr(liveListing.marketplace_contract)}`, "error");
            return;
        }

        const buyBtn = q("cn-m-buy");
        if (buyBtn) buyBtn.disabled = true;
        clearStatus();

        try {
            // Re-verify listing is still available right before submitting
            setStatus("Verifying listing…");
            const fresh = await resolveListing(parsed).catch(() => liveListing);
            if (!fresh) {
                setStatus("Listing sold — no longer available.", "error");
                if (buyBtn) { buyBtn.disabled = true; buyBtn.textContent = "Sold out"; }
                return;
            }
            liveListing = fresh;

            setStatus("Building operation…");

            const argSpec = desc.buildArgs({
                ask_id:          liveListing.ask_id,
                amount:          1,
                buyerAddress:    activeAddress,
                referrerWallet:  settings.refWallet,
                referrerEnabled: isTzAddress(settings.refWallet ?? ""),
                conditionExtra:  null,
            });

            const contract = await Tezos.contract.at(liveListing.marketplace_contract);
            const isObj = argSpec !== null && typeof argSpec === "object" && !Array.isArray(argSpec);
            const transferParams = isObj
                ? contract.methodsObject[desc.entrypoint](argSpec).toTransferParams({ amount: Number(liveListing.price_mutez), mutez: true })
                : contract.methods[desc.entrypoint](argSpec).toTransferParams({ amount: Number(liveListing.price_mutez), mutez: true });

            // How the wallet is paired decides how we wait. The Temple browser
            // extension opens a popup that overlaps our modal (and used to fight
            // it), so for extension wallets we hide ours. QR / mobile / web wallets
            // approve elsewhere, so we keep the modal up with a cancellable
            // "Waiting for approval…" view instead.
            const acct = await client.getActiveAccount();
            const isExtensionWallet = acct?.origin?.type === "extension";
            const backdrop = document.getElementById(MODAL_HOST_ID);

            let closeWait = null;
            if (isExtensionWallet) {
                if (backdrop) backdrop.style.visibility = "hidden";
                setStatus("Waiting for wallet…");
            } else {
                closeWait = showSigningWait();
            }

            let result;
            try {
                result = await client.requestOperation({
                    operationDetails: [{
                        kind:        TezosOperationType.TRANSACTION,
                        destination: liveListing.marketplace_contract,
                        amount:      String(liveListing.price_mutez),
                        parameters:  transferParams.parameter,
                    }],
                });
            } finally {
                if (isExtensionWallet) {
                    if (backdrop) backdrop.style.visibility = "visible";
                } else {
                    closeWait?.();
                }
            }

            const opHash = result.transactionHash;
            showPending(opHash);

            const ok = await pollIncluded(opHash, 90_000);
            if (ok) {
                showSuccess(opHash);
                addPurchase({
                    tokenName:   liveListing.token?.name || "Tezos NFT",
                    priceTez:    liveListing.price_tez,
                    opHash,
                    tokenUrl:    buildTokenUrl(),
                    marketplace: parsed?.source || "tezos",
                    artist:      liveListing.token?.artist || null,
                    thumb:       liveListing.token?.thumb  || null,
                    timestamp:   Date.now(),
                }).catch(() => {});
            } else {
                showPending(opHash, { timedOut: true });
            }
        } catch (err) {
            showBuyError(err);
        }
    }

    q("cn-m-connect")   ?.addEventListener("click", onConnect);
    q("cn-m-disconnect")?.addEventListener("click", onDisconnect);
    q("cn-m-change")    ?.addEventListener("click", onChange);
    q("cn-m-buy")       ?.addEventListener("click", onBuy);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isAbort(err) {
    return /ABORTED|abort|cancel|reject|dismiss|denied|closed/i.test(
        String(err?.message ?? err?.errorType ?? err)
    );
}

/**
 * Map Beacon / octez.connect error codes to something a human can act on.
 * Returns { text, canRetry, canClear } where canClear means "offer to
 * wipe the beacon localStorage state and reconnect".
 */
function classifyWalletError(err) {
    const raw = String(err?.message ?? err?.errorType ?? err?.title ?? err);

    if (/PARAMETERS_INVALID/i.test(raw)) return {
        text: "Wallet rejected the parameters — connection is probably stale.",
        canRetry: true, canClear: true,
    };
    if (/NOT_GRANTED/i.test(raw)) return {
        text: "Wallet permissions not granted. Reconnect to continue.",
        canRetry: false, canClear: true,
    };
    if (/NETWORK_NOT_SUPPORTED/i.test(raw)) return {
        text: "Wallet is not on Tezos Mainnet. Check your wallet's network setting.",
        canRetry: false, canClear: false,
    };
    if (/BROADCAST/i.test(raw)) return {
        text: "Failed to broadcast to the network. Check your connection and retry.",
        canRetry: true, canClear: false,
    };
    if (/TRANSACTION_INVALID/i.test(raw)) return {
        text: "Transaction invalid — the listing may have sold. Refreshing…",
        canRetry: false, canClear: false, refreshListing: true,
    };
    if (/TOO_MANY_OPERATIONS/i.test(raw)) return {
        text: "Too many pending operations in your wallet. Wait a moment and retry.",
        canRetry: true, canClear: false,
    };
    if (/failed on chain|backtracked/i.test(raw)) return {
        text: raw.replace(/^Error:\s*/i, ""),
        canRetry: false, canClear: false,
    };
    if (/UNKNOWN/i.test(raw)) return {
        text: "Unknown wallet error. Try clearing your connection and retrying.",
        canRetry: true, canClear: true,
    };

    return {
        text: raw.replace(/^Error:\s*/i, ""),
        canRetry: true, canClear: false,
    };
}

async function pollIncluded(opHash, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(`${TZKT_API}/operations/${opHash}`);
            if (res.ok) {
                const ops = await res.json();
                if (Array.isArray(ops) && ops.length > 0) {
                    const { status, errors } = ops[0];
                    if (status === "applied") return true;
                    if (status === "failed") {
                        // Surface the actual chain error
                        const reason = errors?.map((e) => e.id || e.type).filter(Boolean).join(", ");
                        throw new Error(`Operation failed on chain${reason ? `: ${reason}` : ""}`);
                    }
                    if (status === "backtracked") {
                        throw new Error("Operation backtracked — the listing may have sold.");
                    }
                }
            }
        } catch (err) {
            // Re-throw chain errors; swallow transient network blips
            if (/failed on chain|backtracked/i.test(err.message)) throw err;
            console.warn("Cloudnine: poll error", err);
        }
        await new Promise((r) => setTimeout(r, 3000));
    }
    return false;
}
