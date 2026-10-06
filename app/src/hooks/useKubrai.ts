import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import { useConnection } from "../utils/ConnectionProvider";
import { useAuthorization } from "../utils/useAuthorization";
import { fetchBalances, fetchConfig, fetchMarket, fetchMarkets, fetchPositionsByOwner, type MarketView } from "../chain/kubrai";
import { loadMetricCatalog } from "../chain/metrics";
import { fetchMarketsApi } from "../chain/api";
import { APP } from "../config";
let catalogLoaded: Promise<void> | null = null;

export function useConfig() { const { connection } = useConnection(); return useQuery({ queryKey: ["config"], queryFn: () => fetchConfig(connection), staleTime: 60_000 }); }
// The list comes from the API like the website's; straight from the chain only when the API cannot be reached.
export function useMarkets() { const { connection } = useConnection(); return useQuery({ queryKey: ["markets"], queryFn: async () => { await (catalogLoaded ??= loadMetricCatalog(APP.apiBase)); return fetchMarketsApi().catch(() => fetchMarkets(connection)); }, refetchInterval: 30_000 }); }
// The market list usually holds this market already: that copy is shown at once (a market opens, and a day switches,
// without a spinner) while the fresh read is on its way.
export function useMarket(id: number) {
  const { connection } = useConnection(); const qc = useQueryClient();
  return useQuery({ queryKey: ["market", id], queryFn: async () => withJustBetPools(await fetchMarket(connection, id)), refetchInterval: 15_000, placeholderData: () => qc.getQueryData<MarketView[]>(["markets"])?.find((x) => x.id === id) });
}
export function useBalances() {
  const { connection } = useConnection(); const { selectedAccount } = useAuthorization(); const cfg = useConfig();
  return useQuery({
    queryKey: ["balances", selectedAccount?.publicKey.toBase58(), cfg.data?.mint?.toString()],
    queryFn: () => fetchBalances(connection, selectedAccount!.publicKey, new PublicKey(cfg.data!.mint)),
    enabled: !!selectedAccount && !!cfg.data, refetchInterval: 20_000,
  });
}
export function usePositions() {
  const { connection } = useConnection(); const { selectedAccount } = useAuthorization();
  return useQuery({ queryKey: ["positions", selectedAccount?.publicKey.toBase58()], queryFn: async () => withJustBet(selectedAccount!.publicKey.toBase58(), await fetchPositionsByOwner(connection, selectedAccount!.publicKey)), enabled: !!selectedAccount, refetchInterval: 20_000 });
}
// A bet that just confirmed, held until the chain read shows it: the first read after a bet often comes from a node
// that has not seen it yet, and the stake on the market page must not fall back to what it was before, or stay empty
// until the next read twenty seconds later (web/src/market.ts justBet).
type Pos = Awaited<ReturnType<typeof fetchPositionsByOwner>>[number];
let justBet: { owner: string; market: string; id: number; amounts: number[]; feeW: bigint[]; pools: number[]; until: number } | null = null;
const pending = () => { if (justBet && Date.now() > justBet.until) justBet = null; return justBet; };
function withJustBetPools(m: MarketView): MarketView { const j = pending(); return j && j.id === m.id ? { ...m, pools: m.pools.map((x, i) => Math.max(x, j.pools[i] ?? 0)) } : m; }   // pools only grow while a market is open
function withJustBet(owner: string, rows: Pos[]): Pos[] {
  const j = pending(); if (!j || j.owner !== owner) return rows;
  const at = rows.findIndex((r) => r.market.toBase58() === j.market);
  if (at >= 0 && rows[at].amounts.every((x, i) => x >= (j.amounts[i] ?? 0))) { justBet = null; return rows; }   // the chain has caught up
  const row: Pos = { pubkey: at >= 0 ? rows[at].pubkey : new PublicKey(j.market), market: new PublicKey(j.market), amounts: j.amounts, feeW: j.feeW };
  return at >= 0 ? rows.map((r, i) => (i === at ? row : r)) : [...rows, row];
}
/** Call when a bet has confirmed: the stake and the pool show it now, from what was just signed. */
export function useNoteBet() {
  const qc = useQueryClient();
  return (owner: PublicKey, m: MarketView, side: number, amount: number, feeBps: number) => {
    const key = ["positions", owner.toBase58()], had = (qc.getQueryData<Pos[]>(key) ?? []).find((r) => r.market.equals(m.pubkey));
    const plus = (xs: number[]) => Array.from({ length: 8 }, (_, i) => (xs[i] ?? 0) + (i === side ? amount : 0));
    justBet = { owner: owner.toBase58(), market: m.pubkey.toBase58(), id: m.id, amounts: plus(had?.amounts ?? []), feeW: Array.from({ length: 8 }, (_, i) => BigInt(had?.feeW[i] ?? 0) + (i === side ? BigInt(amount) * BigInt(feeBps) : BigInt(0))), pools: plus(m.pools), until: Date.now() + 90_000 };
    qc.setQueryData<Pos[]>(key, (rows) => withJustBet(owner.toBase58(), rows ?? []));
    qc.setQueryData<MarketView>(["market", m.id], (old) => (old ? withJustBetPools(old) : old));
  };
}
export function useInvalidateAll() { const qc = useQueryClient(); return () => { qc.invalidateQueries({ queryKey: ["markets"] }); qc.invalidateQueries({ queryKey: ["market"] }); qc.invalidateQueries({ queryKey: ["balances"] }); qc.invalidateQueries({ queryKey: ["positions"] }); }; }
