# Privacy Statement

**FAFO Lab and Cloudnine do no tracking of your data.** We do not broker, collect, or transmit any personal information, and we run no analytics whatsoever. Everything Cloudnine stores — the enable toggle, your connected wallet address, and your local purchase history — lives on your device in your browser's local storage and is never sent to us.

Cloudnine makes outbound requests **only** to public data sources required to render and execute a purchase you've initiated:

- **bsky.app** — the content script runs only when you're on Bluesky and only reads link URLs already visible in the page.
- **data.objkt.com** — public GraphQL endpoint, queried for token + listing data on the marketplace links you encounter.
- **api.tzkt.io** — public Tezos indexer, queried to confirm broadcast operations.
- **ipfs.fileship.xyz** — public IPFS gateway, used only to load token thumbnail images.
- **A Tezos RPC** — used to read on-chain state and broadcast purchases you sign in your wallet.

No request includes any identifier we generate or store about you. Your Tezos wallet address only enters a request once you've clicked Buy and chosen to sign with your wallet — at which point it's part of the on-chain operation itself, public by design.

We have no servers, no databases, no analytics, no telemetry.
