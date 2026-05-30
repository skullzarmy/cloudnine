# Changelog

All notable changes to Cloudnine will be documented here.

Format: `[version] — date — summary`

---

## [0.4.0] — 2026-05-29

### Fixed (critical — open editions)
- **Open-edition claims went to the wrong contract.** The resolver hardcoded `marketplace_contract` to the shared `open_objkt` address (`KT1XaCf6…`), but open editions live on **per-artist collection contracts** (all deployed from objkt's OE factory, same `claim` ABI). So a claim for token 147 on an artist contract was sent to `open_objkt` token 147 — a *different, ended* edition — failing with `OE_NO_SALE_ACTIVE`. Now the claim targets the token's own `fa_contract`.
- **Descriptor lookup by kind.** Because OE contracts vary per collection, the `claim` descriptor is now selected by `listing.kind === "open_edition"` (`getDescriptorForListing`) instead of by a fixed contract address — otherwise valid OEs showed "Unknown marketplace".
- **Skip not-yet-started editions.** Added a `start_time` guard alongside the existing `end_time` check, so editions scheduled for the future don't render a mintable button.

## [0.3.9] — 2026-05-28

### Reverted
- **Backed out the WalletConnect-transport neuter** from 0.3.8. Suppressing octez.connect's WC transport did not fix Kukai pairing on Firefox and the stubbing broke the pairing flow. Restored the clean client setup (Temple connects; Kukai-on-Firefox remains the known issue below).

### Known issue (Firefox + web wallets)
- **Kukai (and other web wallets) cannot pair on Firefox.** octez.connect's Beacon pairing UI reads transport peer-info **promises across the content-script/page compartment boundary**, which Firefox blocks (`Permission denied to access property "then"`). Extension wallets (Temple) are unaffected — they pair via postMessage. **Chrome is unaffected entirely.** Tracked upstream (see `docs/octez-connect-firefox-issue.md`). Workaround for Firefox users: use Temple.

## [0.3.8] — 2026-05-28

### Fixed (Firefox — web wallets / Kukai)
- **Suppressed octez.connect's WalletConnect transport.** It's created unconditionally (`DAppClient` defaults `wcProjectId` to a hardcoded value and `initInternalTransports()` always builds + listens it), and in a Firefox content-script compartment its provider is broken — `this.provider.request is not a function`, `a.entries() is not iterable`, `Permission denied to access property "then"`, then it times out. That poisoned the pairing alert so web wallets (Kukai) never rendered their "Use Browser" button; extension wallets (Temple) were unaffected because they pair over postMessage.
- We patch the client instance to (1) skip `addListener` for the WC transport so its broken provider never connects, and (2) swap it for a benign stub so the alert resolves an empty WC URI and renders the healthy P2P/postMessage paths. Reference-equality + property-name based, survives minification. Upstream issue to be filed against octez.connect.

## [0.3.7] — 2026-05-28

### Fixed (Firefox)
- **Stripped `use_dynamic_url`** from `web_accessible_resources` via a post-build step (`scripts/postbuild.mjs`). crxjs injects this Chrome-only key; Firefox logs "unexpected property" and AMO flags it. Removing it is safe for Chrome (defaults to false), so one build serves both stores.

### Known issue (Firefox)
- **Kukai (web wallet) pairing can hang** with `Permission denied to access property "then"` — a Firefox content-script cross-compartment error in octez.connect's web-wallet/WalletConnect path, likely aggravated by other injected wallet extensions (e.g. MetaMask) in the same profile. Temple (extension wallet) connects fine. Under investigation.

## [0.3.6] — 2026-05-28

### Fixed (Firefox)
- **Disabled Vite module preload** (`build.modulePreload: false`). Vite's preload helper prefetched dynamic-import dependencies (`buy-modal.js`, `storage.js`, `format.js`) using an absolute `/assets/…` path, which in the content-script context resolved against the page origin (bsky.app) instead of the extension — Firefox threw `NS_ERROR_CORRUPTED_CONTENT` / "disallowed MIME type (text/html)". With preload off, dynamic imports resolve relative to the importing module's real `moz-extension://` / `chrome-extension://` URL. (Chrome tolerated the bad preloads; Firefox didn't.)

## [0.3.5] — 2026-05-28

### Removed
- Referrer row removed from the buy panel (the referrer is still attached to the operation, just never displayed).

## [0.3.4] — 2026-05-28

### Changed (urgent)
- **RPC swapped to SmartPy** (`https://mainnet.smartpy.io`) — ECAD Labs' `mainnet.api.tez.ie`, our previous default, is being shut down in ~4 days. Updated both definitions (`storage.js` DEFAULTS and `buy-modal.js` DEFAULT_RPC). Verified SmartPy is live at the current chain head. The RPC is only used to read contract entrypoint schemas while encoding the operation — the actual broadcast goes through the user's wallet — but a dead default would still break the encoding step. (`rpc` is never persisted to storage, so existing installs pick up the new default on update.)

---

## [0.3.3] — 2026-05-28

### Removed (pre-prod cleanup)
- **Dead background service worker** — the buy flow moved fully in-page (dynamic import of `buy-modal.js`) several versions ago; `src/background/background.js` was no longer invoked. Deleted, and removed the `background` key from the manifest. (Also removes a Chrome-vs-Firefox `service_worker` compatibility wrinkle.)
- **Dead buy popup** — `src/buy/{buy.html,buy.js,buy.css}` (the old chrome-extension:// popup window approach that couldn't reach wallet extensions) deleted, removed from `web_accessible_resources` and the vite input.
- **`windows` permission** — only the dead background worker used `chrome.windows.create`. Dropped.
- **`https://api.teia.rocks/*` host permission** — unused since the resolver consolidated onto objkt GraphQL + tzkt. Dropped.
- **Noisy `console.log`** in the content script init removed (warn/error kept for diagnostics).

Net: permissions are now just `storage` + `scripting`; host permissions just the 4 APIs we actually call.

---

## [0.3.1] — 2026-05-28

### Fixed (dev robustness)
- **Stale-chunk trap on rebuild** — build now emits stable, hashless filenames (`content.js.js`, `buy-modal.js`, etc.). Previously every rebuild changed the content-script chunk's content-hash; crxjs's loader imports that chunk by name, so any bsky tab left open across a rebuild would 404 (`ERR_FILE_NOT_FOUND` → "Failed to fetch dynamically imported module") and the whole content script died until a hard refresh. With stable names, an old injected loader always resolves to a file that still exists with current code. Verified the loader is byte-identical across consecutive builds. (Content-hashing is pointless for a disk-loaded extension anyway — no HTTP cache to bust.)

---

## [0.3.0] — 2026-05-28

### Fixed (critical)
- **objkt secondary buys used the wrong ask id** — `fulfill_ask` was being called with objkt's internal listing `id` (~8.5M range) instead of the on-chain `bigmap_key` (~12.6M range). The internal id doesn't exist in the marketplace's `asks` bigmap, so the contract rejected every objkt-main buy (`script_rejected` 625). Verified against the live asks bigmap: `id` → not found, `bigmap_key` → active. The resolver now always uses `bigmap_key` for the `ask_id` (correct for both objkt `fulfill_ask` and Teia `collect`). Teia buys were already correct (they happened to use `bigmap_key`); this fixes the first real objkt-main purchase.
- Confirmed our referrer map format `{ "tz1…": "10000" }` matches live referred buys on the objkt marketplace exactly.

---

## [0.2.9] — 2026-05-28

### Improved
- **Better bsky share previews** — share links now prefer **teia.art** for HEN/OBJKTS tokens. teia.art serves static OpenGraph tags (title, description, artwork `og:image`, `summary_large_image`) that bsky's link-card crawler can read; objkt.com renders OG client-side, which the crawler can't see → no preview image. HEN tokens are viewable on both, so we always link to teia for those (even when the buy went through an objkt URL). The "on X" label in the share text now matches the linked marketplace.
- Non-HEN objkt tokens (open editions on open_objkt, other FA2s) still link to objkt.com — preview quality there is limited by objkt's own client-side OG rendering, not something we can fix from the extension. (Bluesky's compose intent is text-only; attaching an image blob would require the authed AT Protocol API.)

---

## [0.2.8] — 2026-05-28

### Fixed
- **Open edition mint used the wrong entrypoint** — was calling `mint` (manager-only → "Deprecated"/`script_rejected` 504). The public OE mint path is **`claim`**: `claim({ amount, token_id, proxy_for, burn_tokens, condition_extra })`.
- **OE referral capture** — objkt encodes the buyer-side referrer as `condition_extra`, a PACKed `map string nat` of `{ referrer: 10000 }`. We now build this from the FAFOlab referrer wallet, so open-edition mints earn referral the same way secondary buys do on objkt main. The packing is hand-rolled Micheline binary, verified byte-for-byte against live objkt claim operations. OE descriptor is now `supportsReferrers: true` so the referrer row shows in the modal.

---

## [0.2.7] — 2026-05-28

### Added
- **Open edition minting** — tokens with an active open edition (no secondary listing) now show **Mint X ꜩ** instead of "No listing". The resolver checks `open_edition_active` on the objkt GraphQL token when `listings_active` is empty, and skips editions whose `end_time` has passed.
- **`mint` entrypoint** registered for the open_objkt FA2 (`KT1XaCf6gkjFnKg3QmPfn6gep53moMvjkj1E`). Open editions mint directly on the FA2 contract — `mint({ token_id, mint_items: [{ amount, to_ }] })` — not through a marketplace contract.
- Listing objects now carry a `kind` field (`"listing"` | `"open_edition"`) that drives the verb everywhere: button label, modal CTA, "Available: Open edition" row, and the share text ("minted" vs "collected").

---

## [0.2.6] — 2026-05-28

### Added
- **open editions support** — `objkt.com/tokens/open_objkt/<id>` URLs now parse and resolve correctly. The parser was restricted to `KT1...` addresses; it now accepts any alphanumeric slug. `open_objkt` → `KT1XaCf6gkjFnKg3QmPfn6gep53moMvjkj1E` is in the static map, and unknown slugs fall back to a live objkt GraphQL lookup (result cached for the page session).
- **`FA_SLUG_MAP`** in `contracts.js` — a central place to register known objkt slug → KT1 mappings. Add entries here as new named collections emerge.

---

## [0.2.5] — 2026-05-28

### Fixed / Hardened
- **Wallet error classifier** — Beacon error codes (`PARAMETERS_INVALID_ERROR`, `NOT_GRANTED_ERROR`, `NETWORK_NOT_SUPPORTED_ERROR`, `BROADCAST_ERROR`, `TRANSACTION_INVALID_ERROR`, `TOO_MANY_OPERATIONS_ERROR`) are now mapped to human-readable messages with contextual recovery actions instead of dumping the raw error string.
- **"Clear connection" recovery** — `PARAMETERS_INVALID` and similar stale-state errors now show a **"Clear connection"** inline button that nukes `beacon:*` localStorage, clears DAppClient state, and re-tries automatically. This is the fix for the intermittent Kukai issue.
- **Retry button** — network/broadcast errors show a **"Retry"** button that re-enables the buy button.
- **Pre-submit listing re-verify** — right before sending to the wallet, we re-fetch the listing to catch sold-out races. If it's gone, we show "Sold out" immediately and skip the wallet prompt.
- **Chain failure surfacing** — `pollIncluded` now distinguishes `failed` and `backtracked` operations from network blips, re-throws them with the tzkt error reason so the user sees "Operation failed on chain: …" instead of a timeout.
- **Modal hides during wallet signing** — backdrop goes invisible while `requestOperation` is open so the wallet UI isn't blocked, same as the connect flow.
- **Resolver 429 retry** — objkt GraphQL requests now retry up to 2× with exponential backoff (800ms, 1600ms) before giving up. No more spurious "No listing" on rate-limited feeds.

---

## [0.2.0] — 2026-05-28

### Fixed
- **Share opens new tab** — was using `window.location.href` (navigating away from the feed). Now `window.open(url, "_blank")`.
- **IPFS gateway** — switched from `ipfs.io` (slow, unreliable) to `https://ipfs.fileship.xyz/ipfs/` (FAFOlab's gateway, same one used by hack.tez). Added `https://ipfs.fileship.xyz/*` to `host_permissions`.

---

## [0.1.8] — 2026-05-28

### Fixed
- **Disconnect button showing when not connected** — `.hidden` class wasn't defined in content.css so all three wallet buttons were always visible. Added `.cn-modal-dialog .hidden { display: none !important }`. Consolidated `renderConnected`/`renderDisconnected` into a single `renderWallet(addr|null)` so state is always driven by one source of truth.
- **Wallet picker blocked by modal** — Cloudnine's backdrop was covering the Kukai/Temple wallet picker UI. Now `visibility: hidden` on the backdrop during `requestPermissions` so the picker renders freely, then restored immediately after.
- **Success screen on broadcast instead of confirmation** — changed to: broadcast → spinner pending screen ("Confirming…" + spinning ring + op hash link), confirmed → "IT'S YOURS!!" success screen. Timed out → soft pending state with op link.

---

## [0.1.7] — 2026-05-28

### Added
- **Post-purchase success screen** — after broadcast the buy view clears and shows a full-bleed "IT'S YOURS!!" headline (gradient, 36px bold), the token thumbnail, and the op hash link. No more tiny "Bought! 💸" status message.
- **Share on Bluesky** — primary action post-purchase. Opens `bsky.app/intent/compose` pre-filled with the token name, artist, marketplace, and token URL. Since we're already on bsky.app this routes as a client-side navigation into the compose drawer.
- **Buy Again** — secondary action; rebuilds the buy modal from scratch so you can grab another edition immediately.
- Success is shown on broadcast (not waiting for confirmation) — feels instant, op hash link lets you verify on tzkt.

---

## [0.1.6] — 2026-05-28

### Changed
- **Buy modal is now in-page, not a popup window** — the buy UI renders as a DOM overlay directly on bsky.app instead of opening a `chrome-extension://` popup. Root cause of the mobile QR issue: wallet extensions (Temple, Kukai, etc.) don't inject their content scripts into `chrome-extension://` pages, so Beacon's PostMessage transport couldn't find them and fell back to mobile pairing. Running in the bsky.app DOM means the wallet's PostMessage bridge is present and extension-to-extension pairing works.
- **Lazy load** — the Taquito + octez.connect bundle (~3MB) is dynamically imported only when the user clicks a Buy button, not on every bsky.app page load.
- **No background involvement** — click handler in the content script dynamically imports `buy-modal.js` directly. Background.js is no longer part of the buy flow.

---

## [0.1.5] — 2026-05-28

### Fixed
- **`requestPermissions` network error** — `network` property is only valid in the `DAppClient` constructor, not in `requestPermissions()`. Removed it from the call.

---

## [0.1.4] — 2026-05-28

### Changed
- **Wallet SDK swap** — replaced `@airgap/beacon-dapp` + `@taquito/beacon-wallet` with `@tezos-x/octez.connect-sdk` (`DAppClient`). The two beacon forks share the same `postMessage` channel and corrupt each other's state when both are present. `@tezos-x/octez.connect-sdk` is the canonical dApp-side SDK (used by BCD, etc.). `@taquito/taquito` is kept for Michelson encoding only (read-only, no wallet provider).
- **Buy popup wallet UI** — wallet section now shows the connected address with **Connect**, **Disconnect**, and **Change** buttons. Previously the popup had no wallet controls and relied on Beacon auto-pairing which wasn't triggering.
- **Loading state fixed** — `cn-loading` class on `<main>` is now removed once `initialize()` completes, so the popup no longer shows "Loading…" indefinitely.
- **Buy button text** — shows "Connect & Buy" when no wallet is connected; shows "Buy X ꜩ" once connected.
- **Auto-connect on buy** — clicking Buy when no wallet is connected triggers the wallet picker automatically.
- **Operation encoding** — `Tezos.contract.at(KT1...).methodsObject[entrypoint](args).toTransferParams()` encodes Michelson, then `DAppClient.requestOperation()` sends it to the wallet for signing. Op hash comes from `result.transactionHash`.

---

## [0.1.3] — 2026-05-28

### Fixed
- **Resolver regression** — `condition` field does not exist on `listing_active` in the objkt GraphQL schema; the query was rejected with a validation error, returning null for all tokens. Replaced with `target_address` (non-null = private/whitelist-gated listing, skip in v0).

---

## [0.1.2] — 2026-05-28

### Fixed
- **Wrong listing ID field** (`ask_id` → `id`/`bigmap_key`) — the objkt GraphQL schema uses `id` for objkt listings and `bigmap_key` for Teia swaps, not `ask_id`. Every buy attempt would have passed `undefined` to the contract entrypoint.
- **Resolver architecture simplified** — objkt's GraphQL already indexes ALL listings for any HEN/OBJKTS token (both Teia swaps and objkt marketplace listings). Replaced the dual-resolver approach (parallel tzkt bigmap + objkt GraphQL) with a single objkt GraphQL query for both `teia` and `objkt` source URLs. Fewer requests, no rate-limit pressure on tzkt, correct IDs.
- **Teia swap ID mapping** — when the cheapest listing's `marketplace_contract` is the Teia marketplace, `ask_id` is set to `bigmap_key` (the swap_id that `collect()` expects). For objkt MAIN/V2, it uses the listing `id`.

---

## [0.1.1] — 2026-05-28

### Fixed
- **Missing `"windows"` permission** in manifest — `chrome.windows.create()` was silently failing without it, preventing the buy popup from opening.
- **Stale extension context after reload** — clicking a Buy button after reloading the extension now shows "Reload tab ↺" instead of throwing a silent `Extension context invalidated` error.
- **Teia-URL tokens with objkt listings not found** — the resolver now runs both the Teia bigmap query and the objkt GraphQL query in parallel for `teia.art/...` URLs, returning the cheaper of the two. Tokens listed on objkt.com but displayed on teia.art now correctly show a Buy button.

---

## [0.1.0] — 2026-05-27

### Added
- Initial working build.
- Content script scans `bsky.app` for `teia.art/objkt/<id>` and `objkt.com/tokens/<KT>/<id>` links and injects **Buy X ꜩ** buttons into the post feed.
- Listing resolver: cheapest active Teia swap (tzkt bigmap) and objkt.com listing (GraphQL).
- Buy popup: Beacon/Taquito wallet pairing, op construction, broadcast, tzkt confirmation polling.
- Settings popup: enable/disable, referrer wallet, passive mode.
- SPA navigation hooks + MutationObserver for React-rendered feed updates.
- Dark mode support via `prefers-color-scheme`.
- `z-index` / `pointer-events` fix for bsky's transparent click-capture overlay.
