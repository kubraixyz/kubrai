// Holder-discount proofs: the extra accounts appended to place_bet so the program can verify, from account data
// alone, that the bettor holds a Seeker Genesis Token (Token-2022 group member) or an SKR stake. Shared logic with
// app/src/chain/holder.ts — keep the two in step.
import { Connection, PublicKey, type AccountMeta } from "@solana/web3.js";

export const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export type FeeTiersView = { sgtGroupMint: string; sgtDiscountBps: number; stakeProgram: string; stakeOwnerOffset: number; stakeAmountOffset: number; stakeMinAmount: number; stakeDiscountBps: number; minFeeBps: number } | null;
export type HolderProof = { accounts: AccountMeta[]; sgt: boolean; stake: boolean; sgtDiscountBps: number; stakeDiscountBps: number; minFeeBps: number; stakeLabel: string };
const NONE: HolderProof = { accounts: [], sgt: false, stake: false, sgtDiscountBps: 0, stakeDiscountBps: 0, minFeeBps: 0, stakeLabel: "" };
/** ORE mining program (mainnet). Its Miner account (PDA ["miner", authority], 752 bytes) has the authority at byte 8 and
 *  lifetime_deployed (lamports ever deployed) at byte 736. The stake rule with exactly those offsets is the ORE-miner discount;
 *  on devnet the same layout is served by a stand-in program (the faucet registers every wallet as a miner). */
export const ORE_PROGRAM_ID = new PublicKey("oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv");
export const ORE_MINER_OFFSETS = { owner: 8, amount: 736 };
export const isOreMinerRule = (t: FeeTiersView) => !!t && t.stakeOwnerOffset === ORE_MINER_OFFSETS.owner && t.stakeAmountOffset === ORE_MINER_OFFSETS.amount;
/** Human name of the configured stake rule ("" when none). */
export const stakeRuleLabel = (t: FeeTiersView) => !t || !t.stakeDiscountBps || t.stakeProgram === PublicKey.default.toBase58() ? "" : isOreMinerRule(t) ? "ORE miner" : "SKR staking";
/** One line for the fee schedule: who gets the stake discount and how it is proven. */
export const stakeRuleText = (t: FeeTiersView) => !stakeRuleLabel(t) ? "" : isOreMinerRule(t) ? `ORE miner (wallet has an ORE Miner account that has ever deployed SOL) −${t!.stakeDiscountBps / 100}%` : `SKR staking (≥ ${(t!.stakeMinAmount / 1e6).toLocaleString("en-US")} SKR) −${t!.stakeDiscountBps / 100}%`;
const ro = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: false });

/** Find the wallet's Genesis Token (a Token-2022 token with balance ≥ 1 whose mint is a member of the configured group). */
export async function findSgt(connection: Connection, owner: PublicKey, groupMint: PublicKey): Promise<{ tokenAccount: PublicKey; mint: PublicKey } | null> {
  const res = await connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID });
  const held = res.value.filter((a) => Number(a.account.data.parsed?.info?.tokenAmount?.amount ?? 0) >= 1);
  if (!held.length) return null;
  const mints = held.map((a) => new PublicKey(a.account.data.parsed.info.mint));
  const infos = await connection.getMultipleParsedAccounts(mints);
  for (let i = 0; i < mints.length; i++) {
    const ext = (infos.value[i]?.data as any)?.parsed?.info?.extensions ?? [];
    const member = ext.find((e: any) => e.extension === "tokenGroupMember")?.state;
    if (member && member.group === groupMint.toBase58()) return { tokenAccount: held[i].pubkey, mint: mints[i] };
  }
  return null;
}

/** Everything the bet transaction needs to claim the discounts this wallet is entitled to. Never throws: no proof → no discount. */
export async function holderProof(connection: Connection, programId: PublicKey, owner: PublicKey | null, tiers: FeeTiersView): Promise<HolderProof> {
  if (!owner || !tiers) return NONE;
  const [feeTiersPda] = PublicKey.findProgramAddressSync([Buffer.from("fee_tiers")], programId);
  const out: HolderProof = { accounts: [ro(feeTiersPda)], sgt: false, stake: false, sgtDiscountBps: tiers.sgtDiscountBps, stakeDiscountBps: tiers.stakeDiscountBps, minFeeBps: tiers.minFeeBps, stakeLabel: stakeRuleLabel(tiers) };
  try {
    if (tiers.sgtDiscountBps > 0 && tiers.sgtGroupMint !== PublicKey.default.toBase58()) {
      const sgt = await findSgt(connection, owner, new PublicKey(tiers.sgtGroupMint));
      if (sgt) { out.accounts.push(ro(sgt.tokenAccount), ro(sgt.mint)); out.sgt = true; }
    }
    // Stake rule: ORE miner layout → the Miner PDA is derived directly (no program scan); any other layout → scan the program.
    if (tiers.stakeDiscountBps > 0 && tiers.stakeProgram !== PublicKey.default.toBase58() && isOreMinerRule(tiers)) {
      const stakeProgram = new PublicKey(tiers.stakeProgram);
      const [miner] = PublicKey.findProgramAddressSync([Buffer.from("miner"), owner.toBuffer()], stakeProgram);
      const a = await connection.getAccountInfo(miner);
      if (a && a.owner.equals(stakeProgram) && a.data.length >= ORE_MINER_OFFSETS.amount + 8 && owner.equals(new PublicKey(a.data.subarray(ORE_MINER_OFFSETS.owner, ORE_MINER_OFFSETS.owner + 32)))) {
        const d = a.data; const lo = d.readUInt32LE(ORE_MINER_OFFSETS.amount), hi = d.readUInt32LE(ORE_MINER_OFFSETS.amount + 4);
        if (hi * 4294967296 + lo >= tiers.stakeMinAmount) { out.accounts.push(ro(miner)); out.stake = true; }
      }
    } else if (tiers.stakeDiscountBps > 0 && tiers.stakeProgram !== PublicKey.default.toBase58()) {
      const accs = await connection.getProgramAccounts(new PublicKey(tiers.stakeProgram), { filters: [{ memcmp: { offset: tiers.stakeOwnerOffset, bytes: owner.toBase58() } }], dataSlice: { offset: tiers.stakeAmountOffset, length: 8 } });
      const ok = accs.find((a) => { const d = a.account.data; const lo = d.readUInt32LE(0), hi = d.readUInt32LE(4); return hi * 4294967296 + lo >= tiers.stakeMinAmount; });
      if (ok) { out.accounts.push(ro(ok.pubkey)); out.stake = true; }
    }
  } catch { /* a failed lookup only means no discount */ }
  return out.sgt || out.stake ? out : { ...out, accounts: [] };
}

/** Fee in bps after every discount (mirrors on-chain place_bet). */
export function feeWithDiscounts(baseFeeBps: number, earlyBird: boolean, earlyBirdDiscountBps: number, proof: HolderProof) {
  let fee = baseFeeBps;
  if (earlyBird) fee = Math.max(0, fee - earlyBirdDiscountBps);
  if (proof.sgt) fee = Math.max(0, fee - proof.sgtDiscountBps);
  if (proof.stake) fee = Math.max(0, fee - proof.stakeDiscountBps);
  return Math.max(fee, proof.accounts.length ? proof.minFeeBps : 0);
}
export function discountLabel(earlyBird: boolean, proof: HolderProof) {
  const parts = []; if (earlyBird) parts.push("early bird"); if (proof.sgt) parts.push("Seeker Genesis Token"); if (proof.stake) parts.push(proof.stakeLabel || "stake");
  return parts.length ? parts.join(" + ") : "";
}
