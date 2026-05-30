/**
 * URL parsers.
 *
 * Given a URL string found in a bsky post, return { source, fa_contract?, token_id }
 * if it's a recognized marketplace token URL, or null otherwise.
 *
 * objkt.com uses two token URL shapes:
 *   /tokens/<KT1address>/<id>   — most collections
 *   /tokens/<slug>/<id>         — named collections (open_objkt, etc.)
 *   /asset/<KT1address>/<id>    — legacy, still in old posts
 *
 * Named slugs that aren't a KT1 address are stored verbatim in fa_contract
 * and resolved to their actual contract in resolver.js via resolveSlug().
 */

import { HEN_OBJKTS_FA2 } from "./contracts.js";

const PARSERS = [
    {
        source: "teia",
        // teia.art/objkt/<token_id>
        re: /^https?:\/\/(?:www\.)?teia\.art\/objkt\/(\d+)(?:[\/?#]|$)/i,
        parse: (m) => ({
            source: "teia",
            fa_contract: HEN_OBJKTS_FA2,
            token_id: m[1],
        }),
    },
    {
        source: "objkt",
        // objkt.com/tokens/<KT1 or named-slug>/<token_id>
        // Named slugs (e.g. open_objkt) are resolved to KT1 in the resolver.
        re: /^https?:\/\/(?:www\.)?objkt\.com\/tokens\/([A-Za-z0-9][A-Za-z0-9_-]*)\/(\d+)(?:[\/?#]|$)/i,
        parse: (m) => ({
            source: "objkt",
            fa_contract: m[1],   // may be KT1... or a slug like "open_objkt"
            token_id: m[2],
        }),
    },
    {
        source: "objkt",
        // legacy /asset/<KT1>/<id> path — still in old posts
        re: /^https?:\/\/(?:www\.)?objkt\.com\/asset\/(KT1[a-zA-Z0-9]{33})\/(\d+)(?:[\/?#]|$)/i,
        parse: (m) => ({
            source: "objkt",
            fa_contract: m[1],
            token_id: m[2],
        }),
    },
    // TODO v0.5: fxhash, versum, akaSwap, OnePlanet
];

/**
 * @param {string} url
 * @returns {{source:string, fa_contract:string, token_id:string} | null}
 */
export function parseMarketplaceUrl(url) {
    if (!url || typeof url !== "string") return null;
    for (const p of PARSERS) {
        const m = url.match(p.re);
        if (m) return p.parse(m);
    }
    return null;
}

export function isMarketplaceUrl(url) {
    return parseMarketplaceUrl(url) !== null;
}
