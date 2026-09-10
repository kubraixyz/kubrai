// Per-network config. Which network a build talks to is decided at build time by
// VITE_CLUSTER so devnet.kubrai.xyz and kubrai.xyz can never be the same bundle.
export type Cluster = "localnet" | "devnet" | "mainnet";
export const CLUSTER = ((import.meta.env.VITE_CLUSTER as Cluster) ?? "devnet");
export const RPC_URL = import.meta.env.VITE_RPC_URL ?? (CLUSTER === "localnet" ? "http://127.0.0.1:8899" : CLUSTER === "devnet" ? "https://api.devnet.solana.com" : "https://api.mainnet-beta.solana.com");
export const PROGRAM_ID = import.meta.env.VITE_PROGRAM_ID ?? "F9qowxW3hmwrzDeKQXpL4rVmFcPvWe7e43oGnWU3AvQb";
export const TOKEN_SYMBOL = CLUSTER === "mainnet" ? "SKR" : "tSKR";
export const TOKEN_DECIMALS = 6;
export const SNAPSHOT_BASE = import.meta.env.VITE_SNAPSHOT_BASE ?? "";
export const IS_TEST = CLUSTER !== "mainnet";
