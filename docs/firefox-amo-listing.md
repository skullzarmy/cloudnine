# Firefox Add-ons (AMO) listing — Cloudnine

Copy/paste source for addons.mozilla.org (AMO) Developer Hub. Field names match the
AMO submission flow. Version 1.0.0.

---

## Add-on name
Cloudnine — Buy Tezos NFTs on Bluesky

## Add-on summary (max 250 chars)
Buy & mint Tezos NFTs (Teia, objkt) right inside your feed on bsky.app and ovoid.at. A Buy button appears on any post with a marketplace link — connect your Tezos wallet and sign. Your keys never leave your wallet.

## Categories
Social & Communication  *(secondary: Shopping)*

## Tags
tezos, nft, bluesky, atproto, teia, objkt, beacon, web3

## Default locale
English (US)

## Homepage / Support site
https://github.com/skullzarmy/cloudnine   *(update to the canonical repo URL)*

## Support email
<your support email>

## License
The Unlicense (public domain) — matches `package.json`.

---

## Description (rich text)

Cloudnine turns any Tezos NFT link in your feed into a one-click buy — on **Bluesky (bsky.app)** and **ovoid.at**.

When a post contains a Teia or objkt link, Cloudnine adds a **Buy** (or **Mint** for open editions) button right on the post. Click it: a panel opens with the artwork, price, and editions; you connect your Tezos wallet, approve — done. You never leave the page.

▸ **Inline buying** — no tab-switching. The button shows the live price and appears automatically as you scroll.

▸ **Works on Bluesky and ovoid.at** — the same Buy button on both atproto clients.

▸ **Teia + objkt** — Teia swaps, objkt secondary listings, and open-edition mints. HEN tokens resolve to whichever marketplace has the cheapest active listing.

▸ **Every Tezos wallet** — connect Temple, Kukai, Umami, and others via Beacon (octez.connect). Pick from the full wallet list, or scan/tap the on-screen QR to pair a mobile wallet. Cloudnine never sees your keys; you sign every transaction yourself.

▸ **Share the collect** — after a successful buy, post it to Bluesky in one click, or find it later in your purchase history in the toolbar popup.

▸ **Private by design** — no tracking, no analytics, no accounts. Settings and history live in local browser storage on your device. Cloudnine only talks to the public APIs needed to read a listing and the artwork.

How it works: the link identifies the token, the marketplace API says which contract holds the active listing, and your wallet broadcasts the transaction you approve.

A FAFOlab project. Open source.

— Notes —
• Bluesky web (bsky.app) and ovoid.at, desktop or mobile browser.
• Tezos mainnet, native ꜩ-priced listings.
• Auctions and token-priced (USDt, etc.) listings aren't supported yet.

---

## Permissions — what & why
AMO surfaces permissions to users automatically; this is the justification reviewers
and users may want.

- **storage** — local settings (on/off) and recent purchase history, shown in the toolbar popup. Local only; never synced or transmitted.
- **scripting** — used once, on the popup's "Disconnect" action, to clear the wallet pairing session from the active tab. Injected nowhere else.
- **Host `https://bsky.app/*`** and **`https://ovoid.at/*` (+ `*.ovoid.at`)** — the content script runs here to detect marketplace links and render the Buy/Mint button. These are the only sites the UI runs on.
- **Host `https://data.objkt.com/*`** — read-only GraphQL to look up the active listing / open edition and price.
- **Host `https://api.tzkt.io/*`** — read-only Tezos indexer queries to resolve listing data and poll for transaction confirmation.
- **Host `https://ipfs.fileship.xyz/*`** — loads the NFT thumbnail (IPFS gateway) for the buy panel and history.

Also reached at runtime (no host permission needed, plain `fetch`):
- **`https://cdn.jsdelivr.net/gh/airgap-it/beacon-wallet-list`** — the canonical Beacon wallet list (same source the wallet SDK uses), to keep the wallet picker current. A bundled copy is the offline fallback.
- **Tezos RPC + Beacon relay nodes** — to build/broadcast the transaction you sign and to relay wallet pairing (P2P).

## Data collection (AMO "Manage Data Collection")
- **No data collected or transmitted to the developer.** No analytics, no accounts, no tracking.
- Wallet address and purchase history are stored **only** in local browser storage on the device.
- Select **"This add-on does not collect any data"** (Required data disclosure).

## Privacy policy URL
<link to hosted PRIVACY.md — e.g. https://github.com/skullzarmy/cloudnine/blob/main/PRIVACY.md>

---

## Notes to AMO reviewers (Source Code / build)

The submitted XPI contains **minified/bundled** code produced by a build step, so AMO
requires the source plus build instructions. Provide these in the reviewer notes and
upload the source archive when prompted.

**Toolchain:** Node 20.x, npm. **Build:** `npm install` → `npm run build` (Vite +
`scripts/postbuild.mjs`). Output is in `dist/`; that directory is the unpacked
extension. Entry points: `src/content/content.js`, `src/content/buy-modal.js`,
`src/popup/popup.js`; manifest at `manifest.json`.

> ⚠️ **Build-reproducibility blocker — resolve before submitting.** The current build
> depends on a fix to `@tezos-x/octez.connect-sdk` that is **not yet published to npm**
> (Trilitech octez.connect PR #39 — the Firefox content-script pairing fix). Our working
> `node_modules` is overlaid with a build of that branch. A clean `npm install` pulls the
> published `5.0.0-beta.6`, which does **not** contain the fix, so a reviewer's build will
> **not match** the submitted XPI. Pick one before AMO submission:
>   1. Wait for the fix to land on npm (PR #39 merged + released), then pin that exact version; or
>   2. Vendor the patched octez.connect packages into the repo and point `package.json` at them (`file:`), so `npm install && npm run build` is fully reproducible from the checkout.
> Submitting before this is fixed will fail/loop AMO review.

**No remote code execution.** All executable code ships in the package. The extension
fetches data (listings, images, the public wallet list JSON) but never loads or `eval`s
remote scripts.

---

## Store assets checklist
- [ ] **Icon** 128×128 — `public/icons/icon-on-128.png` (in package)
- [ ] **Screenshots** (AMO: at least 1, PNG/JPG). Suggested:
      1. A bsky post with the **Buy X ꜩ** button inline
      2. The buy panel open (artwork, price, Connect)
      3. The wallet picker with the branded QR up top
      4. The **IT'S YOURS!!** success screen with Share on Bluesky
      5. The same Buy button on an ovoid.at post
- [ ] Confirm `browser_specific_settings.gecko.id` = `cloudnine@fafolab.xyz`, `strict_min_version` 115.0 (already in `manifest.json`)
