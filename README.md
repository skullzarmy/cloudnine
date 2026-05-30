# Cloudnine — buy Tezos NFTs inline on Bluesky

> See a Teia or objkt link in your Bluesky feed? Buy it right there, signed in your wallet, without leaving bsky.app.
>
> — a **FAFOlab** joint —

Cloudnine is a browser extension that watches your Bluesky feed for links to Tezos NFT marketplaces. When it spots one, it adds a **Buy** (or **Mint**, for open editions) button directly on the post. Click it, connect your Tezos wallet, sign — the NFT is yours and you never left your feed.

## ✨ What it does

- Detects **Teia** (`teia.art/objkt/<id>`) and **objkt.com** (`objkt.com/tokens/<contract>/<id>`, including named collections like `open_objkt`) links in posts
- Resolves the cheapest active listing — or an active open edition — for each token
- Renders an inline **Buy X ꜩ** / **Mint X ꜩ** button on the post
- Connects your Tezos wallet (Kukai, Temple, Umami, etc.) and builds + broadcasts the purchase itself — no clicking off to the marketplace
- Post-purchase: a one-tap **Share on Bluesky** that opens the composer pre-filled, plus a local purchase history in the toolbar popup so you can share later
- Privacy-first: no tracking, no telemetry, no accounts. Settings and history are local-only.

## 🚧 Scope (v0)

- **Bluesky web only.** Native apps and other clients can't be extended; the surface is `bsky.app` in a desktop browser.
- **Native ꜩ-priced listings only.** Listings priced in other tokens (USDt, etc.) are skipped for now.
- **No condition-gated listings yet.** Whitelist/allowlist-gated objkt listings are skipped.
- **Mainnet only.**
- **Auctions skipped.** English/Dutch auctions live on separate contracts and aren't supported yet.

## 📥 Install (dev / load-unpacked)

```bash
git clone <repo>
cd cloudnine
npm install
npm run build
```

**Chrome:**
1. Visit `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. **Load unpacked** → select the `dist/` directory
4. Visit `bsky.app` — Buy buttons appear on posts containing Teia or objkt links

**Firefox:**
1. Visit `about:debugging` → **This Firefox**
2. **Load Temporary Add-on** → select `dist/manifest.json`

## 🔧 Using it

1. Scroll your `bsky.app` feed. When a post links a Teia or objkt token, a **Buy X ꜩ** / **Mint X ꜩ** button appears on the post.
2. Click it — a Cloudnine panel opens with the token, price, and editions.
3. **Connect** your wallet (first time), then **Buy / Mint**. Approve in your wallet, watch it confirm.
4. On success, **Share on Bluesky** drops a pre-filled post, or grab it later from the extension popup's purchase history.

The toolbar popup lets you toggle the extension on/off, see your connected wallet (disconnect there), and review/share past purchases. Wallet connection happens on the post itself — that's the only place a wallet extension can pair with the page.

## 🧱 How it works

```
URL in a bsky post
   │  parsers.js   → { source, fa_contract, token_id }
   ▼
resolver.js        → cheapest active listing OR active open edition
   │                 (objkt GraphQL indexes both Teia swaps and objkt listings)
   ▼
contracts.js       → entrypoint + args for that contract
   │                 (objkt fulfill_ask / Teia collect / open-edition claim)
   ▼
buy-modal.js       → octez.connect (wallet) + Taquito (encode) → on-chain
```

The URL only tells us the *token*. objkt's public GraphQL tells us which contract holds the buyable listing (or open edition). A small registry knows how to call each contract.

## 🗂️ Structure

```
manifest.json          MV3 manifest (Chrome + Firefox)
vite.config.js         crxjs build
src/
├── content/           bsky.app content script, injected styles, in-page buy modal
├── popup/             toolbar UI (toggle, wallet status, purchase history)
└── lib/
    ├── parsers.js     URL → { source, fa_contract, token_id }
    ├── resolver.js    listing / open-edition lookup (objkt GraphQL + tzkt)
    ├── contracts.js   marketplace contract registry
    ├── storage.js     chrome.storage wrappers + purchase history
    └── format.js      display helpers
```

## 🛟 Issues

Found a bug or a marketplace URL that should be supported? Open an issue.

## 🔒 Privacy

See [PRIVACY.md](./PRIVACY.md). Short version: zero telemetry, settings and history are local-only, the extension talks only to the public APIs needed to resolve a listing and broadcast a transaction you signed.

## 📜 License

[The Unlicense](./LICENSE) — public domain. Do whatever you want.

## ❤️ Credits

- Built by **skllzrmy** & **FAFOlab**
- Powered by [Taquito](https://tezostaquito.io/) and [octez.connect](https://www.npmjs.com/package/@tezos-x/octez.connect-sdk)
- Built with [@crxjs/vite-plugin](https://crxjs.dev/vite-plugin)
