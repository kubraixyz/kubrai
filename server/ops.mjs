// Operator console: everything that needs a human decision, on one page.
//   /ops            proposals awaiting finalization + their evidence + disputes, feedback, health
//   /ops/action     devnet-only actions (re-propose / void / finalize) signed with OPS_ADMIN_KEYPAIR when present;
//                   without that key the action returns an unsigned transaction (base64) to sign in Squads / Seed Vault.
import fs from "node:fs"; import path from "node:path";
import anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import idlJson from "../idl/kubrai.json" with { type: "json" };
const { AnchorProvider, Program, BN, Wallet } = anchor;
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const STATUS = ["Open", "Proposed", "Resolved", "Voided", "Swept"];
const tag = (b) => Buffer.from(b).toString("utf8").replace(/\0+$/, "");
const fmt = (n, d = 6) => (Number(n) / 10 ** d).toLocaleString("en-US", { maximumFractionDigits: 2 });
const ts = (t) => (t ? new Date(Number(t) * 1000).toISOString().replace("T", " ").slice(0, 16) + "Z" : "—");

function program(ctx, signer) {
  return new Program(idlJson, new AnchorProvider(ctx.conn, new Wallet(signer ?? Keypair.generate()), { commitment: "confirmed" }));
}
const configPda = (pid) => PublicKey.findProgramAddressSync([Buffer.from("config")], pid)[0];
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

export async function renderOps(ctx, url) {
  const p = program(ctx);
  const [cfg, markets] = await Promise.all([p.account.config.fetch(configPda(p.programId)), p.account.market.all([{ dataSize: p.account.market.size }])]);
  const disputes = readJsonl(ctx.DISPUTES);
  const open = disputes.filter((d) => d.status === "open");
  const now = Math.floor(Date.now() / 1000);
  const rows = markets.map(({ publicKey, account: m }) => ({ pk: publicKey.toBase58(), id: m.id.toNumber(), metric: tag(m.metric), status: m.status, closeTs: m.closeTs.toNumber(), proposedAt: m.proposedAt.toNumber(), proposedValue: m.proposedValue.toString(), proposedOutcome: m.proposedOutcome, nBuckets: m.nBuckets, thresholds: m.thresholds.slice(0, m.nBuckets - 1).map(String), pools: m.pools.slice(0, m.nBuckets).map((x) => fmt(x)), positionsOpen: m.positionsOpen, baseline: m.baseline.toString() })).sort((a, b) => b.id - a.id);
  const attention = rows.filter((r) => r.status === 1 || (r.status === 0 && r.closeTs < now));
  const windowEnd = (r) => r.proposedAt + cfg.disputeWindowSecs.toNumber();
  const fb = fs.existsSync(ctx.FEEDBACK_DIR) ? fs.readdirSync(ctx.FEEDBACK_DIR).filter((f) => f.endsWith(".json")).sort().reverse().slice(0, 20).map((f) => JSON.parse(fs.readFileSync(path.join(ctx.FEEDBACK_DIR, f), "utf8"))) : [];
  const days = fs.readdirSync(ctx.SNAP).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  const lastDay = days.at(-1); const lastMemo = lastDay && fs.existsSync(path.join(ctx.SNAP, lastDay + ".memo"));
  let faucetSol = null, faucetTok = null, treasuryTok = null;
  try { if (ctx.faucet) { faucetSol = (await ctx.conn.getBalance(ctx.faucet.publicKey)) / 1e9; const { getAssociatedTokenAddressSync } = await import("@solana/spl-token"); faucetTok = Number((await ctx.conn.getTokenAccountBalance(getAssociatedTokenAddressSync(ctx.mint, ctx.faucet.publicKey))).value.uiAmount); } treasuryTok = Number((await ctx.conn.getTokenAccountBalance(cfg.treasury)).value.uiAmount); } catch {}
  const canSign = !!process.env.OPS_ADMIN_KEYPAIR && fs.existsSync(process.env.OPS_ADMIN_KEYPAIR);
  const resolution = (id) => { const f = path.join(ctx.SNAP, `resolution-${id}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null; };
  const disputeRows = (pk) => open.filter((d) => d.market === pk);
  const card = (r) => {
    const res = resolution(r.id); const ds = disputeRows(r.pk);
    return `<section class="card ${ds.length ? "hot" : ""}">
      <div class="row"><b>#${r.id} · ${esc(r.metric)}</b><span class="pill">${STATUS[r.status]}</span>${r.status === 1 ? `<span class="dim">window ends ${ts(windowEnd(r))}${windowEnd(r) < now ? " · <b>finalizable now</b>" : ""}</span>` : `<span class="dim">closed ${ts(r.closeTs)} · not proposed yet</span>`}</div>
      <div class="kv"><b>baseline</b><span class="mono">${esc(r.baseline)}</span><b>thresholds</b><span class="mono">${esc(r.thresholds.join(" / "))}</span><b>pools</b><span class="mono">${esc(r.pools.join(" / "))}</span>
      ${r.status === 1 ? `<b>proposed</b><span class="mono">value ${esc(r.proposedValue)} → bucket ${r.proposedOutcome}</span>` : ""}
      ${res ? `<b>evidence</b><span>days ${esc(res.days?.join(", "))} · <a href="/snapshots/${esc(res.days?.at(-1))}" target="_blank">bundle</a> · sha ${esc(String(res.evidenceHash).slice(0, 16))}… · <a href="https://explorer.solana.com/tx/${esc(res.signature)}?cluster=${ctx.CLUSTER === "mainnet" ? "mainnet-beta" : "devnet"}" target="_blank">proposal tx</a></span>` : ""}</div>
      ${ds.length ? `<div class="disputes"><b>${ds.length} open dispute${ds.length > 1 ? "s" : ""}</b>${ds.map((d) => `<div class="d"><span class="mono">${esc(d.wallet.slice(0, 6))}…</span> ${ts(Date.parse(d.at) / 1000)} · claims <span class="mono">${esc(d.claimedValue ?? "—")}</span><br>${esc(d.reason)}<br><button data-a="dismiss" data-d="${esc(d.id)}" data-m="${r.pk}">Dismiss dispute</button></div>`).join("")}</div>` : ""}
      <div class="actions">
        <label>Re-propose value <input class="val" type="number" step="1" placeholder="${esc(r.proposedValue)}"></label><button data-a="repropose" data-m="${r.pk}">Re-propose</button>
        <button data-a="finalize" data-m="${r.pk}" ${r.status === 1 ? "" : "disabled"}>Finalize now (admin)</button>
        <button data-a="void" data-m="${r.pk}" class="danger">Void &amp; refund everyone</button>
      </div></section>`;
  };
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kubrai ops · ${ctx.CLUSTER}</title>
<style>body{margin:0;background:#15171b;color:#d9dce3;font:14px/1.5 system-ui,sans-serif}.wrap{max-width:1000px;margin:0 auto;padding:20px}h1{font-size:20px;margin:0 0 4px}h2{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#8c919c;margin:26px 0 10px}
.card{background:#1d2026;border:1px solid #30353e;border-radius:10px;padding:14px;margin-bottom:12px}.card.hot{border-color:#d9826b}.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.pill{border:1px solid #4a5060;border-radius:999px;padding:1px 8px;font-size:11px}.dim{color:#8c919c}.mono{font-family:ui-monospace,monospace;font-size:12px}
.kv{display:grid;grid-template-columns:max-content 1fr;gap:4px 12px;margin:10px 0;font-size:13px}.kv b{color:#8c919c;font-weight:500}.actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px}
button{font:inherit;background:#262a31;color:#d9dce3;border:1px solid #4a5060;border-radius:6px;padding:6px 10px;cursor:pointer}button:hover{border-color:#4fc3b2}button.danger{border-color:#d9826b;color:#d9826b}button:disabled{opacity:.4}input{font:inherit;background:#15171b;color:#d9dce3;border:1px solid #4a5060;border-radius:6px;padding:5px 8px;width:140px}
.disputes{background:#2a1e1c;border:1px solid #5a3a36;border-radius:8px;padding:10px;margin:8px 0}.disputes .d{margin-top:8px;font-size:13px}.health{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}.health div{background:#1d2026;border:1px solid #30353e;border-radius:8px;padding:10px}.health b{display:block;color:#8c919c;font-size:11px;letter-spacing:.06em;text-transform:uppercase}
.fb{display:flex;gap:12px;align-items:flex-start}.fb img{width:96px;border-radius:6px;border:1px solid #30353e}a{color:#4fc3b2}#out{white-space:pre-wrap;font-family:ui-monospace,monospace;font-size:12px;background:#0f1013;padding:10px;border-radius:8px;margin-top:10px;display:none}</style>
<div class="wrap"><h1>Kubrai ops <span class="pill">${ctx.CLUSTER}</span></h1><div class="dim">${canSign ? "Actions sign with the server admin key (test network)." : "No admin key on this server: actions return an unsigned transaction to sign in Squads / Seed Vault."}</div>
<h2>Health</h2><div class="health">
<div><b>Last snapshot</b>${esc(lastDay ?? "none")} ${lastMemo ? "· memo ✓" : "· <span style=color:#d9826b>no memo</span>"}</div>
<div><b>Open disputes</b>${open.length}</div>
<div><b>Faucet</b>${faucetSol == null ? "—" : `${faucetSol.toFixed(2)} SOL · ${faucetTok?.toLocaleString("en-US")} tSKR`}</div>
<div><b>Treasury</b>${treasuryTok == null ? "—" : treasuryTok.toLocaleString("en-US") + " " + (ctx.CLUSTER === "mainnet" ? "SKR" : "tSKR")}</div>
<div><b>Markets</b>${rows.filter((r) => r.status === 0).length} open · ${rows.filter((r) => r.status === 1).length} proposed · ${rows.filter((r) => r.status >= 2).length} done</div></div>
<h2>Needs a decision (${attention.length})</h2>${attention.length ? attention.map(card).join("") : `<div class="dim">Nothing waiting. Proposals appear here after a market closes.</div>`}
<div id="out"></div>
<h2>Recent feedback (${fb.length})</h2>${fb.map((f) => `<div class="card fb">${f.image ? `<a href="/ops/feedback/${esc(f.image)}" target="_blank"><img src="/ops/feedback/${esc(f.image)}"></a>` : ""}<div><div class="dim">${esc(f.at?.slice(0, 16).replace("T", " "))} · app ${esc(f.diagnostics?.app ?? "?")} · ${esc(f.wallet ? f.wallet.slice(0, 6) + "…" : "no wallet")}</div><div>${esc(f.note || "(no note)")}</div>${(f.diagnostics?.errors ?? []).length ? `<div class="mono" style="color:#d9826b;margin-top:4px">${esc(f.diagnostics.errors.map((e) => e.msg).join(" · "))}</div>` : ""}</div></div>`).join("") || `<div class="dim">None yet.</div>`}
<h2>All markets</h2>${rows.map((r) => `<div class="row" style="padding:4px 0;border-top:1px solid #30353e"><span class="mono">#${r.id}</span><span>${esc(r.metric)}</span><span class="pill">${STATUS[r.status]}</span><span class="dim">pools ${esc(r.pools.join(" / "))}</span>${r.positionsOpen ? `<span class="dim">${r.positionsOpen} open positions</span>` : ""}</div>`).join("")}
</div>
<script>
document.querySelectorAll("button[data-a]").forEach(b=>b.onclick=async()=>{const card=b.closest(".card");const value=card?.querySelector(".val")?.value;const a=b.dataset.a;if(a==="void"&&!confirm("Void this market and refund every bettor?"))return;if(a==="repropose"&&!value){alert("Enter the corrected observed value first.");return;}
b.disabled=true;const out=document.getElementById("out");out.style.display="block";out.textContent="working…";try{const r=await fetch("/ops/action",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:a,market:b.dataset.m,value,dispute:b.dataset.d})});out.textContent=JSON.stringify(await r.json(),null,2);if(r.ok&&a!=="dismiss")setTimeout(()=>location.reload(),1500);if(a==="dismiss")setTimeout(()=>location.reload(),800);}catch(e){out.textContent=String(e)}b.disabled=false;});
</script>`;
}

export async function handleOpsAction(ctx, body) {
  const action = String(body.action ?? ""); const marketPk = new PublicKey(String(body.market));
  if (action === "dismiss") {
    const rows = readJsonl(ctx.DISPUTES); const i = rows.findIndex((d) => d.id === body.dispute); if (i < 0) return { status: 404, error: "no such dispute" };
    rows[i].status = "dismissed"; rows[i].resolution = "dismissed by operator " + new Date().toISOString(); fs.writeFileSync(ctx.DISPUTES, rows.map((r) => JSON.stringify(r)).join("\n") + "\n"); return { ok: true };
  }
  const adminFile = process.env.OPS_ADMIN_KEYPAIR;
  const proposerFile = path.join(ctx.SECRETS, "proposer.json");
  const signerFile = action === "repropose" ? proposerFile : adminFile;
  const p0 = program(ctx); const cfgPda = configPda(p0.programId);
  const build = (prog, signerPk) => {
    if (action === "repropose") { const v = new BN(String(body.value)); const hash = Array.from(Buffer.alloc(32)); return prog.methods.proposeResolution(v, hash).accounts({ config: cfgPda, market: marketPk, proposer: signerPk }); }
    if (action === "finalize") return prog.methods.finalizeResolution().accounts({ config: cfgPda, market: marketPk, signer: signerPk });
    if (action === "void") return prog.methods.voidMarket().accounts({ config: cfgPda, market: marketPk, admin: signerPk });
    throw new Error("unknown action");
  };
  if (signerFile && fs.existsSync(signerFile)) {
    const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(signerFile, "utf8"))));
    const sig = await build(program(ctx, kp), kp.publicKey).rpc();
    if (action === "repropose" || action === "void") { const rows = readJsonl(ctx.DISPUTES); let n = 0; for (const d of rows) if (d.market === marketPk.toBase58() && d.status === "open") { d.status = "resolved"; d.resolution = `${action} ${sig}`; n++; } if (n) fs.writeFileSync(ctx.DISPUTES, rows.map((r) => JSON.stringify(r)).join("\n") + "\n"); }
    return { ok: true, action, signature: sig, note: action === "repropose" ? "Re-proposal restarts the dispute window. The evidence hash on this manual re-proposal is zero; document the reason in the dispute log." : undefined };
  }
  // No signing key here: hand back an unsigned transaction for the multisig / Seed Vault.
  const cfg = await p0.account.config.fetch(cfgPda);
  const signerPk = action === "repropose" ? cfg.proposer : cfg.admin;
  const ix = await build(p0, signerPk).instruction();
  const tx = new Transaction({ feePayer: signerPk, recentBlockhash: (await ctx.conn.getLatestBlockhash()).blockhash }).add(ix);
  return { ok: true, action, unsignedTransactionBase64: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"), signer: signerPk.toBase58(), note: "Import this into Squads (Transaction builder → import) or sign with the admin key; it expires with the blockhash (~1 min), regenerate if needed." };
}
