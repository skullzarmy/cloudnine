/**
 * Marketplace contract registry.
 *
 * The URL in a bsky post tells us the TOKEN. The marketplace API tells us which
 * MARKETPLACE CONTRACT holds the active listing. This registry tells us how to
 * call that contract — entrypoint name, argument shape, whether it supports
 * buyer-side referrers.
 *
 * Adding a new marketplace = add an entry here and a parser/resolver pair.
 */

export const OBJKT_MAIN = "KT1SwbTqhSKF6Pdokiu1K4Fpi17ahPPzmt1X";
export const OBJKT_V2 = "KT1WvzYHCNBvDSdwafTHv7nJ1dWmZ8GCYuuC";
export const TEIA_MARKETPLACE = "KT1PHubm9HtyQEJ4BBpMTVomq6mhbfNZ9z5w";
export const HEN_OBJKTS_FA2 = "KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton";
export const OPEN_OBJKT_FA2  = "KT1XaCf6gkjFnKg3QmPfn6gep53moMvjkj1E";

/**
 * Known objkt.com URL slugs → FA2 contract address.
 * objkt uses human-readable slugs in token URLs for some collections instead
 * of the raw KT1 address. We resolve them here before hitting GraphQL.
 */
export const FA_SLUG_MAP = {
    "open_objkt": OPEN_OBJKT_FA2,
};

/**
 * Each registry entry describes how to build a "buy" operation on that contract.
 *
 * @typedef {Object} ContractDescriptor
 * @property {string} name              Human label
 * @property {string} entrypoint        Tezos entrypoint name to call
 * @property {boolean} supportsReferrers  Whether the entrypoint accepts a referrers map
 * @property {function} buildArgs       (ctx) => Michelson-friendly params object
 *
 * `ctx` is { ask_id, amount, buyerAddress, referrerWallet, referrerEnabled,
 *   conditionExtra }, and buildArgs returns the JS object that Taquito's
 *   contract.methodsObject[entrypoint](args).toTransferParams() expects.
 */

export const CONTRACTS = {
    [OBJKT_MAIN]: {
        name: "objkt.com Marketplace",
        entrypoint: "fulfill_ask",
        supportsReferrers: true,
        buildArgs: ({ ask_id, amount = 1, buyerAddress, referrerWallet, referrerEnabled, conditionExtra = null }) => {
            const referrers = referrerEnabled && referrerWallet ? { [referrerWallet]: 10000 } : {};
            return {
                ask_id: String(ask_id),
                amount: String(amount),
                proxy_for: buyerAddress,
                condition_extra: conditionExtra,
                referrers,
            };
        },
    },

    [OBJKT_V2]: {
        name: "objkt.com Marketplace v2",
        entrypoint: "fulfill_ask",
        supportsReferrers: false,
        buildArgs: ({ ask_id, buyerAddress }) => ({
            ask_id: String(ask_id),
            proxy: buyerAddress,
        }),
    },

    [TEIA_MARKETPLACE]: {
        name: "Teia Marketplace",
        entrypoint: "collect",
        supportsReferrers: false,
        // Teia's collect takes a single nat (swap_id). Taquito accepts it as a raw value.
        buildArgs: ({ ask_id }) => String(ask_id),
    },

};

/**
 * Open-edition descriptor — selected by listing KIND, not contract address.
 *
 * Open editions are deployed on PER-ARTIST collection contracts (all minted
 * from objkt's OE factory, so they share the same `claim` ABI). The target
 * contract is the token's own fa_contract, which varies per collection — so we
 * can't key this off a fixed address like the marketplaces above.
 *
 * Mint via the PUBLIC `claim` entrypoint (not `mint`, which is manager-gated →
 * "Deprecated"/504). ask_id is the token_id. objkt encodes the buyer-side
 * referrer as `condition_extra`: a PACKed `map string nat` of
 * { referrerAddress: 10000 } (10000 bp = 100% of the referral pool).
 */
export const OPEN_EDITION_DESCRIPTOR = {
    name: "Open edition",
    entrypoint: "claim",
    supportsReferrers: true,
    buildArgs: ({ ask_id, amount = 1, referrerWallet, referrerEnabled }) => ({
        amount: String(amount),
        token_id: String(ask_id),
        proxy_for: null,         // None — token goes to the sending wallet
        burn_tokens: [],         // no burn-to-mint
        condition_extra:
            referrerEnabled && referrerWallet
                ? packReferrer(referrerWallet)
                : null,
    }),
};

/**
 * PACK a buyer-side referrer map { referrer: 10000 } as objkt expects it in
 * `condition_extra` for open-edition claims. Hand-rolled Micheline binary,
 * verified byte-for-byte against live objkt claim operations.
 *
 *   05                 PACK prefix
 *   02 <len:4>         Sequence
 *   0704               Elt (prim #4, 2 args)
 *   01 <len:4> <ascii> String key (the referrer tz address)
 *   00 909c01          Int 10000 (zarith)
 */
function packReferrer(refWallet) {
    const addrHex = [...refWallet]
        .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join("");
    const addrLen = refWallet.length.toString(16).padStart(8, "0");
    const key = "01" + addrLen + addrHex;
    const value = "00" + "909c01"; // Int 10000
    const inner = "0704" + key + value;
    const seqLen = (inner.length / 2).toString(16).padStart(8, "0");
    return "05" + "02" + seqLen + inner;
}

/**
 * @param {string} address  KT1 marketplace contract address
 */
export function getContractDescriptor(address) {
    return CONTRACTS[address] || null;
}

/**
 * Resolve the buy/mint descriptor for a resolved listing. Open editions are
 * routed by `kind` (their contract address varies per collection); everything
 * else is looked up by marketplace contract address.
 * @param {{kind?:string, marketplace_contract?:string}} listing
 */
export function getDescriptorForListing(listing) {
    if (!listing) return null;
    if (listing.kind === "open_edition") return OPEN_EDITION_DESCRIPTOR;
    return CONTRACTS[listing.marketplace_contract] || null;
}

export function isKnownMarketplace(address) {
    return Object.prototype.hasOwnProperty.call(CONTRACTS, address);
}
