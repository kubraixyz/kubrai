import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, getAccount, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { assert } from "chai";
import { Kubrai } from "../target/types/kubrai";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const T = 1_000_000; // 1 token (6 decimals)
const now = () => Math.floor(Date.now() / 1000);

describe("kubrai parimutuel", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Kubrai as Program<Kubrai>;
  const conn = provider.connection;
  const admin = (provider.wallet as anchor.Wallet).payer;
  const proposer = Keypair.generate();
  const alice = Keypair.generate(), bob = Keypair.generate(), carol = Keypair.generate(), dave = Keypair.generate();
  let mint: PublicKey, treasury: PublicKey;
  const ata: Record<string, PublicKey> = {};
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);
  const marketPda = (id: number) => PublicKey.findProgramAddressSync([Buffer.from("market"), new BN(id).toArrayLike(Buffer, "le", 8)], program.programId)[0];
  const vaultPda = (m: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("vault"), m.toBuffer()], program.programId)[0];
  const posPda = (m: PublicKey, u: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("position"), m.toBuffer(), u.toBuffer()], program.programId)[0];
  const bal = async (a: PublicKey) => Number((await getAccount(conn, a)).amount);
  const expectErr = async (p: Promise<any>, code: string) => {
    try { await p; assert.fail("expected " + code); } catch (e: any) {
      const msg = `${e.error?.errorCode?.code ?? ""} ${e.name ?? ""} ${e.message ?? ""}`; assert.include(msg, code, `got ${msg}`);
    }
  };
  const metric = Array.from(Buffer.from("skr_new_ids_week".padEnd(32, "\0")));
  const qhash = Array.from(Buffer.alloc(32, 7));

  before(async () => {
    for (const k of [proposer, alice, bob, carol, dave]) {
      const sig = await conn.requestAirdrop(k.publicKey, 2 * LAMPORTS_PER_SOL); await conn.confirmTransaction(sig, "confirmed");
    }
    mint = await createMint(conn, admin, admin.publicKey, null, 6);
    for (const [n, k] of Object.entries({ admin, alice, bob, carol, dave })) {
      ata[n] = (await getOrCreateAssociatedTokenAccount(conn, admin, mint, k.publicKey)).address;
      await mintTo(conn, admin, mint, ata[n], admin, 10_000 * T);
    }
    treasury = ata.admin;
  });

  const cfgArgs = { proposer: proposer.publicKey, feeBps: 300, earlyBirdDiscountBps: 100, earlyBirdSecs: new BN(3), disputeWindowSecs: new BN(3), minBet: new BN(T) };

  it("initializes config", async () => {
    await program.methods.initialize(cfgArgs).accounts({ config: configPda, admin: admin.publicKey, mint, treasury, systemProgram: SystemProgram.programId }).rpc();
    const c = await program.account.config.fetch(configPda);
    assert.equal(c.feeBps, 300); assert.equal(c.marketCount.toNumber(), 0); assert.ok(c.proposer.equals(proposer.publicKey));
    await expectErr(program.methods.updateConfig({ ...cfgArgs, feeBps: 2000 }, null, false).accounts({ config: configPda, admin: admin.publicKey }).rpc(), "FeeTooHigh");
  });

  const thr = (...xs: number[]) => Array.from({ length: 7 }, (_, i) => new BN(xs[i] ?? 0));
  async function createMarket(openIn: number, closeIn: number, signer = proposer, thresholds: number[] = [1234]) {
    const cfg = await program.account.config.fetch(configPda);
    const id = cfg.marketCount.toNumber();
    const m = marketPda(id), v = vaultPda(m);
    const t = now();
    await program.methods.createMarket({ metric, questionHash: qhash, thresholds: thr(...thresholds), nBuckets: thresholds.length + 1, openTs: new BN(t + openIn), closeTs: new BN(t + closeIn), resolveAfterTs: new BN(t + closeIn), baseline: new BN(0) })
      .accounts({ config: configPda, market: m, vault: v, mint, signer: signer.publicKey, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).signers([signer]).rpc();
    return { id, m, v };
  }
  const bet = (m: PublicKey, v: PublicKey, who: Keypair, side: "yes" | "no" | number, amt: number) =>
    program.methods.placeBet(typeof side === "number" ? side : side === "yes" ? 1 : 0, new BN(amt)).accounts({ config: configPda, market: m, position: posPda(m, who.publicKey), vault: v, userToken: ata[nameOf(who)], user: who.publicKey, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).signers([who]).rpc();
  const nameOf = (k: Keypair) => (k === alice ? "alice" : k === bob ? "bob" : k === carol ? "carol" : k === dave ? "dave" : "admin");
  const settle = (m: PublicKey, v: PublicKey, owner: Keypair, cranker: Keypair) =>
    program.methods.settlePosition().accounts({ market: m, position: posPda(m, owner.publicKey), payer: owner.publicKey, vault: v, ownerToken: ata[nameOf(owner)], cranker: cranker.publicKey, tokenProgram: TOKEN_PROGRAM_ID }).signers([cranker]).rpc();
  const sweep = (m: PublicKey, v: PublicKey, signer: Keypair) =>
    program.methods.sweepMarket().accounts({ config: configPda, market: m, vault: v, treasury, rentDest: admin.publicKey, signer: signer.publicKey, tokenProgram: TOKEN_PROGRAM_ID }).signers([signer]).rpc();

  it("rejects bad schedules and unauthorized creators", async () => {
    const t = now();
    const bad = program.methods.createMarket({ metric, questionHash: qhash, thresholds: thr(0), nBuckets: 2, openTs: new BN(t + 10), closeTs: new BN(t + 5), resolveAfterTs: new BN(t + 5), baseline: new BN(0) })
      .accounts({ config: configPda, market: marketPda(0), vault: vaultPda(marketPda(0)), mint, signer: proposer.publicKey, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).signers([proposer]).rpc();
    await expectErr(bad, "BadSchedule");
    await expectErr(createMarket(0, 60, alice), "Unauthorized");
  });

  it("full lifecycle: seed, early-bird + normal bets, propose, admin finalize, permissionless settle, sweep", async () => {
    const { m, v } = await createMarket(-1, 9);
    // house seed 100
    await program.methods.seedMarket(new BN(100 * T)).accounts({ market: m, vault: v, funderToken: ata.admin, funder: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID }).rpc();
    await expectErr(bet(m, v, alice, "yes", T / 2), "BelowMinBet");
    await bet(m, v, alice, "yes", 100 * T);   // early bird: 200 bps
    await bet(m, v, bob, "no", 300 * T);      // early bird
    const pA = await program.account.position.fetch(posPda(m, alice.publicKey));
    assert.equal(pA.feeW[1].toString(), new BN(100 * T).muln(200).toString());
    await sleep(4500);                         // past early-bird window
    await bet(m, v, carol, "yes", 100 * T);   // 300 bps
    const pC = await program.account.position.fetch(posPda(m, carol.publicKey));
    assert.equal(pC.feeW[1].toString(), new BN(100 * T).muln(300).toString());
    let mk = await program.account.market.fetch(m);
    assert.equal(mk.pools[1].toNumber(), 200 * T); assert.equal(mk.pools[0].toNumber(), 300 * T); assert.equal(mk.positions, 3);
    await expectErr(program.methods.proposeResolution(new BN(1500), qhash).accounts({ config: configPda, market: m, proposer: proposer.publicKey }).signers([proposer]).rpc(), "TooEarlyToResolve");
    await sleep(6000);                         // past close
    await expectErr(bet(m, v, alice, "yes", T), "BettingClosed");
    await expectErr(program.methods.proposeResolution(new BN(1500), qhash).accounts({ config: configPda, market: m, proposer: alice.publicKey }).signers([alice]).rpc(), "Unauthorized");
    await program.methods.proposeResolution(new BN(1500), qhash).accounts({ config: configPda, market: m, proposer: proposer.publicKey }).signers([proposer]).rpc();
    await expectErr(settle(m, v, alice, dave), "NotResolved");
    await expectErr(program.methods.finalizeResolution().accounts({ config: configPda, market: m, signer: dave.publicKey }).signers([dave]).rpc(), "DisputeWindowOpen");
    await program.methods.finalizeResolution().accounts({ config: configPda, market: m, signer: admin.publicKey }).rpc(); // admin = Seeker key
    mk = await program.account.market.fetch(m); assert.equal(mk.status, 2); assert.equal(mk.outcome, 1);

    const a0 = await bal(ata.alice), b0 = await bal(ata.bob), c0 = await bal(ata.carol);
    const aliceLamports0 = await conn.getBalance(alice.publicKey);
    await expectErr(sweep(m, v, dave), "PositionsOutstanding");
    await settle(m, v, alice, dave); await settle(m, v, bob, dave); await settle(m, v, carol, dave);
    // alice: 100 + 300*100/200=150 - fee 150*2%=3 + seed 50 = 297 ; carol: 100+150-4.5+50 = 295.5 ; bob: 0
    assert.equal((await bal(ata.alice)) - a0, 297 * T);
    assert.equal((await bal(ata.carol)) - c0, 295_500_000);      // fee 4.5 tokens = 4_500_000 base units exactly
    assert.equal((await bal(ata.bob)) - b0, 0);
    assert.isAbove(await conn.getBalance(alice.publicKey), aliceLamports0, "rent refunded to position payer");
    mk = await program.account.market.fetch(m);
    assert.equal(mk.positionsOpen, 0);
    const t0 = await bal(treasury);
    await sweep(m, v, dave);
    assert.equal((await bal(treasury)) - t0, mk.feeCollected.toNumber());
    assert.equal(mk.feeCollected.toNumber(), 7_500_000);
    await expectErr(getAccount(conn, v) as any, "TokenAccountNotFoundError");
  });

  it("void refunds everyone in full and returns the seed to treasury", async () => {
    const { m, v } = await createMarket(-1, 60);
    await program.methods.seedMarket(new BN(10 * T)).accounts({ market: m, vault: v, funderToken: ata.admin, funder: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID }).rpc();
    await bet(m, v, alice, "yes", 50 * T); await bet(m, v, bob, "no", 20 * T);
    await expectErr(program.methods.voidMarket().accounts({ config: configPda, market: m, admin: alice.publicKey }).signers([alice]).rpc(), "Unauthorized");
    await program.methods.voidMarket().accounts({ config: configPda, market: m, admin: admin.publicKey }).rpc();
    const a0 = await bal(ata.alice), b0 = await bal(ata.bob), t0 = await bal(treasury);
    await settle(m, v, alice, dave); await settle(m, v, bob, dave);
    assert.equal((await bal(ata.alice)) - a0, 50 * T); assert.equal((await bal(ata.bob)) - b0, 20 * T);
    await sweep(m, v, dave);
    assert.equal((await bal(treasury)) - t0, 10 * T);
  });

  it("no winners → everyone refunded; permissionless finalize after dispute window", async () => {
    const { m, v } = await createMarket(-1, 4);
    await bet(m, v, alice, "no", 30 * T); await bet(m, v, bob, "no", 70 * T);
    await sleep(5500);
    await program.methods.proposeResolution(new BN(1500), qhash).accounts({ config: configPda, market: m, proposer: proposer.publicKey }).signers([proposer]).rpc();
    await sleep(4000);
    await program.methods.finalizeResolution().accounts({ config: configPda, market: m, signer: dave.publicKey }).signers([dave]).rpc();
    const a0 = await bal(ata.alice), b0 = await bal(ata.bob);
    await settle(m, v, alice, dave); await settle(m, v, bob, dave);
    assert.equal((await bal(ata.alice)) - a0, 30 * T); assert.equal((await bal(ata.bob)) - b0, 70 * T);
    await sweep(m, v, dave);
  });

  it("multi-bucket: 4 buckets, winners share every losing pool, bucket derived on-chain", async () => {
    const { m, v } = await createMarket(-1, 4, proposer, [100, 250, 500]);   // buckets: <100 | 100–249 | 250–499 | ≥500
    let mk = await program.account.market.fetch(m); assert.equal(mk.nBuckets, 4);
    await expectErr(bet(m, v, alice, 4, 10 * T), "BadBuckets");
    await bet(m, v, alice, 0, 100 * T); await bet(m, v, bob, 2, 50 * T); await bet(m, v, carol, 3, 150 * T); await bet(m, v, dave, 2, 150 * T);
    await sleep(5500);
    await program.methods.proposeResolution(new BN(300), qhash).accounts({ config: configPda, market: m, proposer: proposer.publicKey }).signers([proposer]).rpc();
    mk = await program.account.market.fetch(m); assert.equal(mk.proposedOutcome, 2, "300 falls in bucket 2");
    await program.methods.finalizeResolution().accounts({ config: configPda, market: m, signer: admin.publicKey }).rpc();
    const b0 = await bal(ata.bob), d0 = await bal(ata.dave), a0 = await bal(ata.alice);
    await settle(m, v, alice, dave); await settle(m, v, bob, dave); await settle(m, v, carol, dave); await settle(m, v, dave, dave);
    // losing pools = 100 + 150 = 250; bucket-2 pool = 200; early-bird fee 2%
    // bob: 50 + 250*50/200=62.5 - 1.25 = 111.25 ; dave: 150 + 187.5 - 3.75 = 333.75 ; alice 0
    assert.equal((await bal(ata.bob)) - b0, 111_250_000);
    assert.equal((await bal(ata.dave)) - d0, 333_750_000);
    assert.equal((await bal(ata.alice)) - a0, 0);
    await sweep(m, v, dave);
  });

  it("paused config blocks bets", async () => {
    const { m, v } = await createMarket(-1, 60);
    await program.methods.updateConfig(cfgArgs, null, true).accounts({ config: configPda, admin: admin.publicKey }).rpc();
    await expectErr(bet(m, v, alice, "yes", T), "Paused");
    await program.methods.updateConfig(cfgArgs, null, false).accounts({ config: configPda, admin: admin.publicKey }).rpc();
    await bet(m, v, alice, "yes", T);
  });
});
