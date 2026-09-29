// Solana Explorer links for the network this build talks to. One place, so every page agrees with CLUSTER: a hard-coded
// devnet link on the mainnet build would send people to a transaction that does not exist there.
import { CLUSTER } from "./config";

const cluster = CLUSTER === "mainnet" ? "mainnet-beta" : "devnet";
/** Transaction page for a signature. */
export const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${encodeURIComponent(sig)}?cluster=${cluster}`;
/** Account page for a wallet or program address. */
export const explorerAddress = (addr: string) => `https://explorer.solana.com/address/${encodeURIComponent(addr)}?cluster=${cluster}`;
