# Chrome Web Store listing — Cloudnine

Copy/paste source for the CWS Developer Dashboard. Field names match the dashboard.

---

## Product name
Cloudnine — Buy Tezos NFTs on Bluesky

## Summary (max 132 chars)
Buy & mint Tezos NFTs (Teia, objkt) right on bsky.app. A Buy button appears on any post with a marketplace link — sign in your wallet.

## Category
Social & Communication  *(alt: Shopping)*

## Language
English (United States)

---

## Detailed description

Cloudnine turns any Tezos NFT link in your Bluesky feed into a one-click buy.

When a post on bsky.app contains a Teia or objkt link, Cloudnine adds a **Buy** (or **Mint** for open editions) button right on the post. Click it, a panel opens with the artwork, price, and editions, you connect your Tezos wallet, approve — done. You never leave Bluesky.

▸ **Inline buying** — no tab-switching. The button shows the live price and appears automatically as you scroll.

▸ **Teia + objkt** — supports Teia swaps, objkt secondary listings, and open-edition mints. HEN tokens resolve to whichever marketplace has the cheapest active listing.

▸ **Your wallet, your keys** — connect Temple, Kukai, Umami, and other Tezos wallets via Beacon. Cloudnine never sees your keys; you sign every transaction in your own wallet.

▸ **Share the collect** — after a successful buy, post it to Bluesky with one click, or grab it later from your purchase history in the toolbar popup.

▸ **Private by design** — no tracking, no analytics, no accounts. Settings and history are stored locally on your device. Cloudnine only talks to the public APIs needed to read a listing and the artwork.

How it works: the link tells Cloudnine the token, the marketplace API tells it which contract holds the active listing, and your wallet broadcasts the transaction you approve.

A FAFOlab project. Open source.

— Notes —
• Bluesky web (bsky.app) in a desktop browser only.
• Tezos mainnet, native ꜩ-priced listings.
• Auctions and token-priced (USDt, etc.) listings aren't supported yet.

---

## Permission justifications

**storage**
Stores the user's local settings (enabled on/off) and their recent purchase history so it can be shown in the toolbar popup. Local only — never synced or transmitted.

**scripting**
Used once, on the Settings popup's "Disconnect" action, to clear the wallet pairing session from the active bsky.app tab. No code is injected anywhere else.

**Host permission — https://bsky.app/***
The content script runs here to detect marketplace links and render the Buy/Mint button on posts. This is the only site the extension's UI runs on.

**Host permission — https://data.objkt.com/***
Read-only GraphQL queries to look up the active listing / open edition and price for a token.

**Host permission — https://api.tzkt.io/***
Read-only Tezos indexer queries to resolve on-chain listing data and to poll for transaction confirmation after a purchase.

**Host permission — https://ipfs.fileship.xyz/***
Loads the NFT's thumbnail image (IPFS gateway) to display in the buy panel and purchase history.

## Remote code
**No.** All code is bundled in the package. The extension fetches data (listings, images) but never loads or executes remote scripts.

## Data usage disclosures (Privacy practices tab)
- Does this item collect or use user data? **Tied to required disclosures below.**
- **No** data is collected, transmitted to the developer, sold, or used for anything beyond the single purpose. Wallet address and purchase history stay in local browser storage on the user's device.
- Personally identifiable info: **No**
- Health / financial / authentication / personal communications / location / web history / user activity: **No**
- The three required certifications (not sold to third parties; not used for unrelated purposes; not used for creditworthiness/lending): **all true — check all three.**

## Privacy policy URL
<link to your hosted PRIVACY.md — e.g. https://github.com/skullzarmy/cloudnine/blob/main/PRIVACY.md>

## Single purpose (description field)
Cloudnine lets users buy and mint Tezos NFTs inline on bsky.app by detecting marketplace links in posts and rendering a Buy button that completes the purchase through the user's own Tezos wallet.

---

## Store assets checklist
- [ ] **Icon** 128×128 (already in package: `public/icons/icon-on-128.png`)
- [ ] **Screenshots** 1280×800 or 640×400 (min 1, up to 5). Suggested shots:
      1. A bsky post with the **Buy X ꜩ** button visible inline
      2. The buy panel open (artwork, price, Connect)
      3. The **IT'S YOURS!!** success screen with Share on Bluesky
      4. The toolbar popup showing purchase history
- [ ] **Small promo tile** 440×280 (optional but recommended)

## Suggested screenshot captions
1. "Buy Tezos NFTs without leaving Bluesky."
2. "Artwork, price, editions — then sign in your wallet."
3. "Bought. Share the collect in one click."
4. "Your wallet and purchase history, in the toolbar."
