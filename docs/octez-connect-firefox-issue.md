# Upstream issue draft — DAppClient can't pair web wallets from a Firefox content script

> Draft for filing against `@tezos-x/octez.connect-sdk`.

## What happens

In a **Firefox browser-extension content script**, `DAppClient` can connect to **extension wallets (Temple)** but **not to web wallets (Kukai, etc.)**. When you pick a web wallet, the Beacon pairing dialog never shows its "Use Browser" / QR action, so there's no way to continue. The same code works fine in Chrome.

## Setup

- `@tezos-x/octez.connect-sdk` `5.0.0-beta.6`
- Firefox, MV3 extension, `DAppClient` instantiated **inside a content script** injected into a third-party page
- Client options: `{ name, network: { type: NetworkType.MAINNET } }` (nothing else)

## Why it happens

Firefox runs a content script in a **separate JavaScript compartment** from the page, with "Xray" wrappers between them. Two things in the SDK trip over that boundary:

### 1. The WalletConnect transport is always created, and it errors in this context

`walletConnectOptions` is described in the docs as *required to enable WalletConnect*, but the transport is built unconditionally — when no options are passed, a default project id is filled in:

```js
// DAppClient constructor
this.wcProjectId = config.walletConnectOptions?.projectId || '24469fd0a06df227b6e5f7dc7de0ff4f';

// initInternalTransports()
this.walletConnectTransport = new DappWalletConnectTransport(/* … */);
await this.addListener(this.walletConnectTransport);
```

In a Firefox content-script compartment that transport throws:

```
TypeError: this.provider.request is not a function
TypeError: a.entries() is not iterable
The connection timed out.
```

(These look like Xray-wrapper effects — a provider object / Map from the page compartment loses its methods and iterator when touched from the content-script compartment.)

**Ask:** don't build or listen the WalletConnect transport unless `walletConnectOptions` is provided — or add an explicit way to turn it off (e.g. `disableWalletConnect: true`). Suppressing it alone does **not** fix web-wallet pairing (see #2), but it removes a stream of errors and the WC timeout.

### 2. The pairing UI reads peer-info promises across the compartment boundary (the real blocker)

The pairing flow creates the peer-info values as **promises in the content-script compartment**, then emits them for the default UI to consume:

```js
const walletConnectPeerInfo = new Promise(async (resolve) => {
  resolve((await walletConnectTransport.getPairingRequestInfo()).uri);
});
this.events.emit(BeaconEvent.PAIR_INIT, {
  p2pPeerInfo, postmessagePeerInfo, walletConnectPeerInfo, /* … */
});
```

When the default pairing UI does `.then(...)` on one of these promises, Firefox blocks the cross-compartment access:

```
Error: Permission denied to access property "then"
```

So the dialog never finishes rendering the web-wallet action. Extension wallets (Temple) avoid this entirely: the postMessage transport resolves through its `listenForNewPeer` callback, so the UI doesn't have to await a cross-compartment promise.

## How to reproduce

1. Build a Firefox MV3 extension whose **content script** creates `DAppClient` and calls `requestPermissions()` on a click.
2. Load it on any page, click connect, choose **Kukai** → WC `TypeError`s, `Permission denied to access property "then"`, no pairing action rendered.
3. Choose **Temple** → connects normally.
4. Do the same in Chrome → both work.

## Impact

Any dApp that embeds `DAppClient` in a Firefox content script (for example, an extension that injects "buy" buttons onto third-party pages) can't offer web wallets on Firefox — only extension wallets work.

## Suggested fixes

- Make the WalletConnect transport opt-in, matching the docs (or add `disableWalletConnect`).
- For content-script support, either create/clone the values handed to the pairing UI in the same compartment that consumes them, **or** expose a headless pairing API that returns the pairing URIs directly, so embedders can render their own UI without the SDK's dialog crossing the compartment boundary.
