// Per-network config. Which network a build talks to is decided at build time by
// VITE_CLUSTER so devnet.kubrai.xyz and kubrai.xyz can never be the same bundle.
export type Cluster = "localnet" | "devnet" | "mainnet";
export const CLUSTER = ((import.meta.env.VITE_CLUSTER as Cluster) ?? "devnet");
export const RPC_URL = import.meta.env.VITE_RPC_URL ?? (CLUSTER === "localnet" ? "http://127.0.0.1:8899" : CLUSTER === "devnet" ? "https://api.devnet.solana.com" : "https://api.mainnet-beta.solana.com");
export const PROGRAM_ID = import.meta.env.VITE_PROGRAM_ID ?? "F9qowxW3hmwrzDeKQXpL4rVmFcPvWe7e43oGnWU3AvQb";
export const TOKEN_SYMBOL = CLUSTER === "mainnet" ? "SKR" : "tSKR";
export const TOKEN_DECIMALS = 6;
// On the website the API is asked through the page's own name (/api, a route the web server has) whenever the API's
// address is "api-" + the page's host: devnet.kubrai.xyz with api-devnet.kubrai.xyz. Both names reach the same server
// through Cloudflare, but Cloudflare holds a connection to it per name. The page's was used a moment ago to fetch the
// page; the API name's has to be opened first, halfway round the world. Measured 2026-10-02 from Tokyo: a page's first
// API call takes 0.3 s instead of 0.8 s, and a JSON POST 0.28 s instead of 0.56 s (no preflight on the page's own
// origin). Anywhere else (a local preview, the pages opened on the API's own name) the full address is used as before.
const apiBase = import.meta.env.VITE_API_BASE ?? "";
export const API_BASE = typeof location !== "undefined" && apiBase === `https://api-${location.hostname}` ? "/api" : apiBase;
export const IS_TEST = CLUSTER !== "mainnet";
