import { APP } from "../config";
// explorer.solana.com links for the app's cluster (the explorer calls mainnet "mainnet-beta").
const CLUSTER_PARAM = APP.cluster === "mainnet" ? "mainnet-beta" : "devnet";
export const explorerUrl = (path: string) => `https://explorer.solana.com/${path}?cluster=${CLUSTER_PARAM}`;
export const explorerTxUrl = (signature: string) => explorerUrl(`tx/${signature}`);
export const explorerAddressUrl = (address: string) => explorerUrl(`address/${address}`);
