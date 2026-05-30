/**
 * Small display helpers.
 */

export function shortAddr(addr) {
    if (!addr || typeof addr !== "string") return "";
    if (addr.length <= 12) return addr;
    return `${addr.slice(0, 5)}…${addr.slice(-4)}`;
}

export function formatTez(value) {
    if (value == null) return "?";
    const n = typeof value === "string" ? Number(value) : value;
    if (Number.isNaN(n)) return String(value);
    // trim trailing zeros but keep at most 4 decimals on display
    return `${parseFloat(n.toFixed(4))} ꜩ`;
}

export function isTzAddress(s) {
    return /^tz[1-3][1-9A-HJ-NP-Za-km-z]{33}$/.test(String(s || ""));
}
