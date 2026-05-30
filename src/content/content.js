/**
 * Content script — runs on https://bsky.app/*
 *
 * Watches the feed for link cards / inline anchors pointing at supported Tezos
 * marketplaces (Teia, objkt). For each one, resolves the cheapest active
 * listing and injects a "Buy X ꜩ" button into the post, placed between the
 * post content (text / link card) and the action buttons row.
 *
 * Confirmed DOM shape (live inspection May 2026):
 *
 *   Feed / profile view:
 *     feedItem-by-{handle}
 *       └── ... → contentHider-post  ← inject AFTER here
 *               ← [next sib contains replyBtn/likeBtn/repostBtn]
 *
 *   Thread view (selected post):
 *     postThreadItem-by-{handle}
 *       └── unnamed content col → unnamed contentDiv  ← inject AFTER here
 *               ← [next sib contains replyBtn/likeBtn/repostBtn]
 *
 * findInjectionPoint() walks up from the marketplace anchor until it finds
 * the element whose NEXT SIBLING contains the action buttons. That element
 * is the post-body section — inserting after it places the button between
 * the content and the action row.
 *
 * bsky renders a full-viewport transparent fixed overlay for post-click
 * navigation; we give .cn-buy-wrap position:relative + z-index:9999 so our
 * button stacks above it.
 */

import { parseMarketplaceUrl } from "../lib/parsers.js";
import { resolveListing } from "../lib/resolver.js";
import { getSettings, onSettingsChanged } from "../lib/storage.js";

const TAG = "Cloudnine";
const BUTTON_CLASS = "cn-buy-btn";
const PROCESSED_ATTR = "data-cn-processed";

let isEnabled = true;
let cachedSettings = null;

(async function init() {
    cachedSettings = await getSettings();
    isEnabled = cachedSettings.isEnabled !== false;

    onSettingsChanged((changes) => {
        if (changes.isEnabled !== undefined) isEnabled = changes.isEnabled.newValue !== false;
        if (changes.refWallet !== undefined) cachedSettings.refWallet = changes.refWallet.newValue;
        if (changes.isPassive !== undefined) cachedSettings.isPassive = changes.isPassive.newValue;
    });

    if (!isEnabled) return;

    scanNow();
    installSpaHooks();
    installObserver();
})();

// ---------------------------------------------------------------------------
// SPA navigation hooks (same shape as robjkt)
// ---------------------------------------------------------------------------

function installSpaHooks() {
    const wrap = (original) =>
        function (...args) {
            original.apply(this, args);
            scheduleScan();
        };
    history.pushState = wrap(history.pushState);
    history.replaceState = wrap(history.replaceState);
    window.addEventListener("popstate", scheduleScan);
}

let scanTimer = null;
function scheduleScan() {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(scanNow, 250);
}

function installObserver() {
    const start = () => {
        const observer = new MutationObserver(scheduleScan);
        observer.observe(document.body, { childList: true, subtree: true });
    };
    if (document.body) start();
    else document.addEventListener("DOMContentLoaded", start, { once: true });
}

// ---------------------------------------------------------------------------
// scan
// ---------------------------------------------------------------------------

function scanNow() {
    if (!isEnabled) return;

    const anchors = document.querySelectorAll(`a[href]:not([${PROCESSED_ATTR}])`);
    for (const a of anchors) {
        const href = a.getAttribute("href");
        const parsed = parseMarketplaceUrl(href);
        if (!parsed) continue;

        // Mark immediately — rapid re-scans won't re-queue the same anchor.
        a.setAttribute(PROCESSED_ATTR, "1");
        handleAnchor(a, parsed).catch((err) =>
            console.warn(`${TAG}: handler error`, err, href)
        );
    }
}

// ---------------------------------------------------------------------------
// per-anchor handler
// ---------------------------------------------------------------------------

async function handleAnchor(anchor, parsed) {
    const container = findPostContainer(anchor);

    // De-dup: one Buy button per token per post container.
    const scopeEl = container || anchor.parentElement;
    const tokenKey = `${parsed.source}:${parsed.fa_contract ?? ""}:${parsed.token_id}`;
    if (scopeEl?.querySelector(`.${BUTTON_CLASS}[data-token-key="${cssEscape(tokenKey)}"]`)) return;

    // Find the element to insert the button after — the post-body section
    // whose next sibling is the action buttons row.
    const injectAfter = container ? findInjectionPoint(anchor, container) : anchor;

    // Placeholder while the listing resolves.
    const btn = insertButton(injectAfter, tokenKey, { state: "loading" });

    let listing;
    try {
        listing = await resolveListing(parsed);
    } catch (err) {
        console.warn(`${TAG}: resolveListing threw`, err);
        return updateButton(btn, { state: "error", label: "Buy unavailable" });
    }

    if (!listing) {
        return updateButton(btn, { state: "disabled", label: "No listing" });
    }

    const isOE = listing.kind === "open_edition";
    updateButton(btn, {
        state: "ready",
        label: isOE ? `Mint ${listing.price_tez} ꜩ` : `Buy ${listing.price_tez} ꜩ`,
        title: isOE
            ? `${listing.token.name} — open edition — ${shortMarketName(parsed.source)}`
            : `${listing.token.name} — ${listing.editions} available — ${shortMarketName(parsed.source)}`,
    });

    btn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
            // Dynamically import the buy modal (lazy — only loads Taquito +
            // octez.connect on first click, not on every page load).
            const { openBuyModal } = await import("./buy-modal.js");
            openBuyModal({
                parsed,
                listing,
                settings: {
                    refWallet: cachedSettings.refWallet,
                    isPassive: cachedSettings.isPassive,
                },
            });
        } catch (err) {
            // Extension context invalidated after a reload — tell user to refresh.
            if (/invalidated|Extension context/i.test(String(err))) {
                updateButton(btn, { state: "error", label: "Reload tab ↺" });
            } else {
                console.warn(`${TAG}: failed to open buy modal`, err);
            }
        }
    });
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

/**
 * Walk up from `node` to find the nearest feed/thread post container.
 *
 * bsky.app (May 2026):
 *   - Home/profile feed: data-testid="feedItem-by-{handle}"
 *   - Thread view:       data-testid="postThreadItem-by-{handle}"
 *   - Fallback:          <article>
 *
 * Depth limit is generous (30) — bsky's React Native Web render tree is deep.
 */
function findPostContainer(node) {
    let cur = node.parentElement;
    for (let i = 0; i < 30 && cur; i++) {
        if (cur.matches?.('[data-testid^="feedItem-by-"],[data-testid^="postThreadItem-by-"],article')) {
            return cur;
        }
        cur = cur.parentElement;
    }
    return null;
}

/**
 * Walk up from `anchor` until we find the element whose NEXT SIBLING contains
 * bsky's action buttons (replyBtn / likeBtn / repostBtn). That element is the
 * "post body" section — inserting our wrapper after it puts the Buy button
 * between the content and the action row.
 *
 * Confirmed injection points (live inspection):
 *   Feed:   contentHider-post  → next sib has actions ✓
 *   Thread: unnamed contentDiv → next sib has actions ✓
 *
 * Falls back to firstChildOf(container, anchor) if no action sibling is found.
 */
function findInjectionPoint(anchor, container) {
    let cur = anchor;
    while (cur && cur !== container) {
        const parent = cur.parentElement;
        if (!parent || parent === container) break;
        for (const sib of parent.children) {
            if (
                sib !== cur &&
                sib.querySelector(
                    '[data-testid="replyBtn"],[data-testid="likeBtn"],[data-testid="repostBtn"]'
                )
            ) {
                return cur;
            }
        }
        cur = parent;
    }
    // Fallback: return the direct child of container containing the anchor.
    let c = anchor;
    while (c && c.parentElement !== container) c = c.parentElement;
    return c || anchor;
}

/**
 * Create the Buy button wrapped in a block div and insert it after `sibling`.
 * The wrapper gets position:relative + z-index:9999 to float above bsky's
 * transparent full-viewport fixed overlay (which otherwise intercepts clicks).
 */
function insertButton(sibling, tokenKey, { state }) {
    const wrap = document.createElement("div");
    wrap.className = "cn-buy-wrap";

    const btn = document.createElement("button");
    btn.className = `${BUTTON_CLASS} cn-state-${state}`;
    btn.dataset.tokenKey = tokenKey;
    btn.type = "button";

    // Cloud mark logo prefix — only on active/loading states, not disabled
    const logo = document.createElement("img");
    logo.className = "cn-buy-logo";
    logo.src = chrome.runtime.getURL("public/icons/cloud9-logo.svg");
    logo.alt = "";
    btn.appendChild(logo);

    const label = document.createElement("span");
    label.textContent = state === "loading" ? "…" : "Buy";
    btn.appendChild(label);

    wrap.appendChild(btn);
    sibling.insertAdjacentElement("afterend", wrap);
    return btn;
}

function updateButton(btn, { state, label, title }) {
    btn.className = `${BUTTON_CLASS} cn-state-${state}`;
    if (label !== undefined) {
        const span = btn.querySelector("span");
        if (span) span.textContent = label;
        else btn.textContent = label;
    }
    if (title !== undefined) btn.title = title;
    if (state === "disabled" || state === "error") btn.disabled = true;
}

function shortMarketName(source) {
    return source === "objkt" ? "objkt.com" : source === "teia" ? "Teia" : source;
}

function cssEscape(s) {
    return String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}
