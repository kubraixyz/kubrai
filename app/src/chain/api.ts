import { PublicKey } from "@solana/web3.js";
import { APP } from "../config";
import type { MarketView } from "./kubrai";
/** The market list as the website reads it: the API's copy of the chain, kept fresh for 15 s and gzipped (~20 KB),
 *  instead of every phone asking a public RPC node for every market account (~100 KB, rate-limited). */
export async function fetchMarketsApi(): Promise<MarketView[]> {
  const r = await fetch(APP.apiBase + "/markets"); if (!r.ok) throw new Error("markets " + r.status);
  return ((await r.json()).markets as any[]).map((j) => ({ ...j, pubkey: new PublicKey(j.pubkey) }));
}
export async function requestFaucet(address: string) {
  const r = await fetch(APP.apiBase + "/faucet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address }) });
  const j = await r.json(); if (!r.ok) throw new Error(j.error ?? "faucet failed"); return j;
}
export async function fetchSettled(owner: string) {
  const r = await fetch(`${APP.apiBase}/positions/${owner}`); const j = await r.json(); return (j.settled ?? []) as any[];
}
