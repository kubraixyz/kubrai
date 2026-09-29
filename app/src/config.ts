import Constants from "expo-constants";
const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;
const cluster = (extra.cluster === "mainnet" ? "mainnet" : "devnet") as "mainnet" | "devnet";
export const APP = {
  cluster,
  apiBase: extra.apiBase ?? "https://api-devnet.kubrai.xyz",
  rpcUrl: extra.rpcUrl ?? "https://api.devnet.solana.com",
  programId: extra.programId ?? "F9qowxW3hmwrzDeKQXpL4rVmFcPvWe7e43oGnWU3AvQb",
  // The web site of this cluster. Its host is what the wallet signs when an invite code is bound (= the API's SITE_URL).
  siteUrl: extra.siteUrl ?? (cluster === "mainnet" ? "https://kubrai.xyz" : "https://devnet.kubrai.xyz"),
};
export const SITE_HOST = APP.siteUrl.replace(/^https?:\/\//, "").replace(/[/?#].*$/, "");
export const IS_TEST = APP.cluster !== "mainnet";
export const TOKEN_SYMBOL = IS_TEST ? "tSKR" : "SKR";
export const TOKEN_DECIMALS = 6;
