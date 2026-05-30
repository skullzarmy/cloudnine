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
} from "@tezos-x/octez.connect-sdk";

import { getDescriptorForListing, HEN_OBJKTS_FA2 } from "../lib/contracts.js";
import { resolveListing } from "../lib/resolver.js";
import { getSettings, setSettings, addPurchase } from "../lib/storage.js";
import { shortAddr, formatTez, isTzAddress } from "../lib/format.js";

const TZKT_API = "https://api.tzkt.io/v1";
const DEFAULT_RPC = "https://mainnet.smartpy.io";
const MODAL_HOST_ID = "cn-buy-modal-host";

// ---------------------------------------------------------------------------
// Singletons — survive across modal opens within the same page session
// ---------------------------------------------------------------------------

let _client = null;
function getClient() {
    if (!_client) {
        _client = new DAppClient({
            name: "Cloudnine",
            network: { type: NetworkType.MAINNET },
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
                    <div class="cn-modal-title">${name}</div>
                    ${artistDisplay ? `<div class="cn-modal-artist">${artistDisplay}</div>` : ""}
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
                   href="https://tzkt.io/${opHash}"
                   target="_blank" rel="noreferrer noopener"
                   title="${opHash}">
                   op: ${opHash.slice(0, 8)}…${opHash.slice(-6)}
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
                    ${thumb ? `<img class="cn-modal-success-thumb" src="${thumb}" alt="" />` : ""}
                    <div class="cn-modal-success-headline">IT'S YOURS!!</div>
                    <div class="cn-modal-success-name">${name}</div>
                    <a class="cn-modal-success-op"
                       href="https://tzkt.io/${opHash}"
                       target="_blank" rel="noreferrer noopener"
                       title="${opHash}">op: ${opHash.slice(0, 8)}…${opHash.slice(-6)}</a>
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
        const backdrop = document.getElementById(MODAL_HOST_ID);
        clearStatus();
        try {
            const existing = await client.getActiveAccount();
            if (!existing) {
                // Hide our modal so the wallet picker isn't blocked by our backdrop.
                if (backdrop) backdrop.style.visibility = "hidden";
                await client.requestPermissions({
                    scopes: [PermissionScope.OPERATION_REQUEST],
                });
            }
            const account = await client.getActiveAccount();
            activeAddress = account?.address ?? null;
            renderWallet(activeAddress);
            updateBuyBtn();
            // Sync to chrome.storage so popup can show connected wallet
            setSettings({ connectedWallet: activeAddress }).catch(() => {});
        } catch (err) {
            if (!isAbort(err)) setStatus(`Connection failed: ${err?.message || err}`, "error");
        } finally {
            if (backdrop) backdrop.style.visibility = "visible";
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

            // Hide modal while wallet signs
            const backdrop = document.getElementById(MODAL_HOST_ID);
            if (backdrop) backdrop.style.visibility = "hidden";
            setStatus("Waiting for wallet…");

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
                if (backdrop) backdrop.style.visibility = "visible";
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
