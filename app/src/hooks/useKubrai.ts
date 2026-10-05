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
  return useQuery({ queryKey: ["market", id], queryFn: () => fetchMarket(connection, id), refetchInterval: 15_000, placeholderData: () => qc.getQueryData<MarketView[]>(["markets"])?.find((x) => x.id === id) });
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
  return useQuery({ queryKey: ["positions", selectedAccount?.publicKey.toBase58()], queryFn: () => fetchPositionsByOwner(connection, selectedAccount!.publicKey), enabled: !!selectedAccount, refetchInterval: 20_000 });
}
export function useInvalidateAll() { const qc = useQueryClient(); return () => { qc.invalidateQueries({ queryKey: ["markets"] }); qc.invalidateQueries({ queryKey: ["market"] }); qc.invalidateQueries({ queryKey: ["balances"] }); qc.invalidateQueries({ queryKey: ["positions"] }); }; }
