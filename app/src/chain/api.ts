import { APP } from "../config";
export async function requestFaucet(address: string) {
  const r = await fetch(APP.apiBase + "/faucet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address }) });
  const j = await r.json(); if (!r.ok) throw new Error(j.error ?? "faucet failed"); return j;
}
export async function fetchSettled(owner: string) {
  const r = await fetch(`${APP.apiBase}/positions/${owner}`); const j = await r.json(); return (j.settled ?? []) as any[];
}
