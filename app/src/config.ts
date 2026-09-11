import Constants from "expo-constants";
const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;
export const APP = {
  cluster: (extra.cluster === "mainnet" ? "mainnet" : "devnet") as "mainnet" | "devnet",
  apiBase: extra.apiBase ?? "https://api-devnet.kubrai.xyz",
  rpcUrl: extra.rpcUrl ?? "https://api.devnet.solana.com",
  programId: extra.programId ?? "F9qowxW3hmwrzDeKQXpL4rVmFcPvWe7e43oGnWU3AvQb",
};
export const IS_TEST = APP.cluster !== "mainnet";
export const TOKEN_SYMBOL = IS_TEST ? "tSKR" : "SKR";
export const TOKEN_DECIMALS = 6;
