/**
 * Listing resolver.
 *
 * Given a parsed token { source, fa_contract, token_id }, returns the cheapest
 * active listing:
 *
 *   {
 *     marketplace_contract,   // KT1 — pass to contracts.js
 *     ask_id,                 // listing/swap id to pass into the entrypoint
 *     price_mutez,            // string, e.g. "12000000"
 *     price_tez,              // human-readable string, e.g. "12"
 *     currency,               // "tez"
 *     editions,               // editions available
 *     seller,                 // tz1...
 *     condition: null,        // non-null = whitelist/coupon gated (skipped in v0)
 *     token: { name, thumb, artist }
 *   }
 *
 * Or null if there's no buyable active listing.
 *
 * Architecture note:
 *   objkt's GraphQL API (data.objkt.com/v3/graphql) indexes ALL active listings
 *   for any HEN/OBJKTS-FA2 token — both Teia swaps and objkt marketplace listings.
 *   Teia and objkt are interoperable: a Teia swap can be collected on objkt.com
 *   and objkt listings of HEN tokens appear on teia.art. We therefore use a single
 *   objkt GraphQL query for both source === "teia" and source === "objkt".
 *
 *   The only subtlety is which listing ID to pass to the marketplace entrypoint:
 *     - Teia collect(swap_id)  → bigmap_key  (the Teia swap bigmap key)
 *     - objkt fulfill_ask(id)  → id          (objkt's internal listing id)
 *
 * v0 limits (skip, return null):
 *   - Listings with a non-null condition (whitelist/coupon-gated)
 *   - Listings priced in FA1.2/FA2 tokens (currency_id !== 1)
 */

import { HEN_OBJKTS_FA2, FA_SLUG_MAP } from "./contracts.js";

const OBJKT_GRAPHQL = "https://data.objkt.com/v3/graphql";

/**
 * Resolve an objkt URL slug (e.g. "open_objkt") to a KT1 FA2 address.
 * Checks the static map first; falls back to a live GraphQL lookup for
 * unknown slugs so new collections work without a code update.
 */
const _slugCache = { ...FA_SLUG_MAP };

async function resolveSlug(slug) {
    if (slug.startsWith("KT1")) return slug; // already a KT1 contract address
    if (_slugCache[slug]) return _slugCache[slug];
    try {
        const res = await fetch(OBJKT_GRAPHQL, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                query: `query($slug: String!) { fa(where: {path: {_eq: $slug}}, limit: 1) { contract } }`,
                variables: { slug },
            }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        const contract = data?.data?.fa?.[0]?.contract;
        if (contract) _slugCache[slug] = contract;
        return contract || null;
    } catch {
        return null;
    }
}

/** Fetch with exponential backoff on 429 rate-limit responses. */
async function fetchWithRetry(url, options = {}, retries = 2, baseDelayMs = 800) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        const res = await fetch(url, options);
        if (res.status !== 429 || attempt === retries) return res;
        await new Promise((r) => setTimeout(r, baseDelayMs * Math.pow(2, attempt)));
    }
}

// ---------------------------------------------------------------------------
// objkt GraphQL resolver (handles both teia and objkt source URLs)
// ---------------------------------------------------------------------------

const TOKEN_QUERY = `
  query CloudnineToken($fa: String!, $token_id: String!) {
    token(where: {fa_contract: {_eq: $fa}, token_id: {_eq: $token_id}}, limit: 1) {
      name
      thumbnail_uri
      display_uri
      creators { creator_address holder { alias } }
      listings_active(order_by: {price: asc}, limit: 1) {
        marketplace_contract
        id
        bigmap_key
        price
        currency_id
        seller_address
        amount_left
        target_address
      }
      open_edition_active {
        fa_contract
        price
        seller_address
        start_time
        end_time
        max_per_wallet
      }
    }
  }
`;

async function resolveViaObjkt({ fa_contract, token_id }) {
    // Resolve named slugs (e.g. "open_objkt") to their KT1 contract address.
    const fa = await resolveSlug(fa_contract);
    if (!fa) {
        console.warn(`Cloudnine: unknown FA slug "${fa_contract}"`);
        return null;
    }

    let payload;
    try {
        const res = await fetchWithRetry(OBJKT_GRAPHQL, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                query: TOKEN_QUERY,
                variables: { fa, token_id: String(token_id) },
            }),
        });
        if (!res.ok) return null;
        payload = await res.json();
    } catch (err) {
        console.warn("Cloudnine: objkt GraphQL fetch failed", err);
        return null;
    }

    if (payload?.errors?.length) {
        console.warn("Cloudnine: objkt GraphQL errors", payload.errors);
        return null;
    }

    const token = payload?.data?.token?.[0];
    if (!token) return null;

    const tokenMeta = {
        name:   token.name || `objkt #${token_id}`,
        thumb:  pickIpfs(token.thumbnail_uri || token.display_uri),
        artist: token.creators?.[0]?.holder?.alias || token.creators?.[0]?.creator_address || null,
    };

    // --- Regular secondary listing ---
    const ask = token.listings_active?.[0];
    if (ask && !ask.target_address && ask.currency_id === 1) {
        // The on-chain ask/swap id is the bigmap KEY — for both objkt's
        // fulfill_ask and Teia's collect. objkt's `id` is an internal DB id
        // (~8.5M range) and does NOT exist in the on-chain asks bigmap
        // (~12.6M range); passing it makes the contract reject the ask.
        const ask_id = String(ask.bigmap_key);

        return {
            marketplace_contract: ask.marketplace_contract,
            fa_contract: fa,
            ask_id,
            kind: "listing",
            price_mutez: String(ask.price),
            price_tez:   mutezToTez(ask.price),
            currency:    "tez",
            editions:    ask.amount_left,
            seller:      ask.seller_address,
            condition:   null,
            token:       tokenMeta,
        };
    }

    // --- Open edition (claim directly on the OE's FA2 contract) ---
    const oe = token.open_edition_active;
    if (oe) {
        const now = Date.now();
        // Skip if the sale window isn't currently open. Open editions live on
        // PER-ARTIST collection contracts (deployed from objkt's OE factory),
        // so the contract is the token's own fa_contract — NOT a shared address.
        if (oe.end_time && now > new Date(oe.end_time).getTime()) return null;
        if (oe.start_time && now < new Date(oe.start_time).getTime()) return null;

        return {
            marketplace_contract: oe.fa_contract || fa,  // the OE's own contract
            fa_contract: fa,
            ask_id:      String(token_id),  // passed as token_id to claim()
            kind:        "open_edition",
            price_mutez: String(oe.price),
            price_tez:   mutezToTez(oe.price),
            currency:    "tez",
            editions:    null,              // open/unlimited
            seller:      oe.seller_address,
            condition:   null,
            token:       tokenMeta,
        };
    }

    return null;
}

// ---------------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------------

/**
 * @param {{source:string, fa_contract?:string, token_id:string|number}} parsed
 */
export async function resolveListing(parsed) {
    if (!parsed) return null;

    if (parsed.source === "objkt") {
        return resolveViaObjkt(parsed);
    }

    if (parsed.source === "teia") {
        // teia.art URLs always refer to HEN/OBJKTS FA2 tokens.
        // objkt's GraphQL indexes all listings for these tokens (both Teia swaps
        // and objkt marketplace listings), so a single query covers both.
        return resolveViaObjkt({
            fa_contract: parsed.fa_contract || HEN_OBJKTS_FA2,
            token_id: parsed.token_id,
        });
    }

    return null;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function mutezToTez(mutez) {
    try {
        const tez = Number(BigInt(mutez)) / 1_000_000;
        return tez.toString();
    } catch {
        return String(mutez);
    }
}

const IPFS_GATEWAY = "https://ipfs.fileship.xyz/ipfs/";

function pickIpfs(uri) {
    if (!uri) return null;
    if (uri.startsWith("ipfs://")) {
        return IPFS_GATEWAY + uri.slice("ipfs://".length);
    }
    return uri;
}
