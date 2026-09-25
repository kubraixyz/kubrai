# Kubrai

Parimutuel prediction pools on the numbers that describe the Solana Mobile / Seeker
ecosystem itself: Seekers activated today, SKR staked, dApp Store listings, reviews of
the apps Seekers actually use, and the [ORE](https://ore.supply) mining game (SOL deployed,
motherlode hits, mining cost). Bet in SKR from any Solana wallet on the web, or natively
on Seeker with Seed Vault Wallet.

Built for the Solana Mobile **Clock In** hackathon (Sept–Oct 2026).

**Try it (devnet):** web <https://devnet.kubrai.xyz> · Android APK linked from the same page
(test tokens from the in-app faucet) · API <https://api-devnet.kubrai.xyz/health>

## How the money works

* A market splits one metric into **2–8 ranges** ("buckets") by sorted thresholds. A yes/no
  market is just two buckets. Each bucket has its own pool; you pick one and deposit SKR.
* When the market resolves, **winners get their stake back plus a pro-rata share of every
  losing pool**. Losers lose their stake.
* **The protocol fee (default 3%) is charged only on the share of the losing pools a winner
  receives.** Your own stake is never touched.
* **Discounts** lower that fee and are locked into your position at the moment you bet,
  stake-weighted, so a late top-up cannot inherit an early discount:
  * early-bird: bets placed in the first quarter of a market's window (6 h of a daily market, 24 h of a weekly one) get −1%.
  * Seeker Genesis Token holders get −1%: the bet carries the wallet's token account and its mint, and the program
    checks on-chain that the mint is a member of the Genesis Token group (Token-2022 group extension). Nothing is
    taken on the client's word.
  * ORE miners get −1%: the bet carries the wallet's ORE `Miner` account (PDA `["miner", wallet]` of the ORE program),
    and the program checks that the account is owned by the ORE program, names the bettor as its authority (byte 8) and
    holds unclaimed mining rewards (`rewards_ore` at byte 704) worth at least **$500** — the same bar as a Seeker. The
    minimum is stored in ORE and repriced daily from the ORE price (`server/ore-tier.mjs`); the market page shows the
    current figure. The rule is a generic "program + owner offset + amount offset + minimum" in `FeeTiers`, so the same
    slot can point at the SKR staking program once its layout is known.
  * Discounts never take the fee below the configured floor (1%). All of this lives in an admin-set `FeeTiers` account.
* The treasury may **seed** a market with a fee-free prize; it is split pro-rata among
  winners. If nobody wins the seed returns to the treasury.
* If a market is **voided** every bettor is refunded in full.
* Bucket thresholds are cut at the **quantiles of the metric's own recent history** (windows of the same length), so every
  range starts out roughly equally likely (`server/buckets.mjs`).

## Why you can trust the settlement

1. **The server never holds funds.** Deposits sit in a program-owned vault; only the
   program's payout math can move them.
2. **The proposer submits a number, not a winner.** Our server proposes the observed value
   plus the hash of the snapshot bundle it came from; the winning bucket is derived
   **on-chain** from the market's thresholds. A 24 h dispute window follows. Anyone can
   finalize after the window; the admin key (a Seed Vault key, multisig on mainnet) can
   finalize early or void. A compromised server can delay a market by a day and lie about a
   number that everyone can check; it cannot steal a pool.
3. **The baseline is fixed on-chain at market creation** from the opening snapshot, and
   **betting closes before the closing snapshot is taken** (snapshots run right after the hour, markets close on the hour), so nobody bets on a
   number they have already seen.
4. **Hourly snapshots are hashed on-chain** (memo tx) and published with their evidence
   (`/snapshots/:day`). Sources are labelled on every market: *on-chain* (recomputable by
   anyone: `.skr` name records, the SKR staking vault), *store data* (dApp Store catalog),
   *third-party*.
5. **Metrics are chosen to be expensive to manipulate.** A new `.skr` ID needs a Seeker
   Genesis Token, i.e. a $500 device; dApp Store reviews can only be written from verified
   devices, one per device per app; pushing up the SOL deployed in ORE burns about 10% of
   every extra SOL (ORE returns 89% of a losing square), and whether an ORE round hits the
   motherlode comes from the round's on-chain randomness, which nobody can steer. Level metrics resolve on the median of every hourly snapshot inside the market window (24 for a daily market, 168 for a weekly one; at least 75 % must exist), so a last-minute deposit or withdrawal cannot move the result. Cumulative metrics resolve on the increase between the opening hour's snapshot and the closing hour's snapshot (markets open and close exactly on the hour; snapshots are taken right after the hour, so consecutive markets share one reading and nothing is counted twice).
6. **Settlement is permissionless.** A crank pays every winner and closes every position,
   returning the rent deposit to whoever paid it. Nobody has to remember to claim.

## Leaderboard, invites, time

- **Leaderboard** (`/leaderboard.html`, app tab “Ranks”; `GET /leaderboard?window=7d|30d|all`): one point per SKR
  staked in a market that paid out, every range counted, won or lost; voided markets score nothing. Scored from the
  crank's `settlements.jsonl` (`server/points.mjs`), so only markets that really settled count. Our own bot wallets are
  listed in `snapshots/test-wallets.json` and shown as “Kubrai test bot”.
- **Invite links** (`/invite.html`, app Settings; `server/referrals.mjs`): a wallet's link unlocks with its first bet
  (`POST /referral/code`). A friend who arrives through `?ref=CODE` is bound by their own first bet — the wallet signs
  `kubrai-referral v1` naming the site and the time, valid 10 minutes (`POST /referral/bind`); one code per wallet,
  forever, on every network, no rings. Money: the invitee gets 10 % of the fee on every win back; the inviter earns 20 %
  of it (25 % from 10k points, 30 % from 100k). Earnings are derived from the settlement log each time; nothing is
  stored twice. `server/referral-payout.mjs` pays weekly from the rebate wallet, and only for settlement rows whose
  signature the chain confirms carry this program's `PositionSettled` event for that market, owner and fee
  (`settlement-proof.mjs`); the ledger is written *before* each send and reconciled against the chain, so a rebate is
  never paid twice.
- **Time**: every time on the web and in the app is the viewer's own clock with its zone named; each market page
  shows its full timeline (bets open → close → closing snapshot → proposal → dispute window → payout) with a countdown
  to the next step, and My bets carries the next step per position.

## Operations: two hosts, one of them cold-ish

- **App host (Germany)** runs the site, the API, the hourly snapshot (memo on-chain), the market opener, the resolver
  and the referral payout, all under `flock`. It holds the proposer key (proposes values, settles, sweeps) and, on
  devnet, the admin/deployer key for payouts and top-ups. It serves no admin UI.
- **Tokyo** takes its own hourly snapshots and runs `server/verify-proposals.mjs` every 10 minutes: every proposed
  value is re-derived from Tokyo's snapshots; a different range voids the market (full refunds) and pages; a result
  Tokyo watched but cannot verify is voided 45 min before the window closes; a market Tokyo was not watching yet is
  left to the proposal. Tokyo also runs the operator dashboard (read-only rsync of the app host's data every 5 min;
  the only action is *void*, typed out to confirm) and pushes a heartbeat the app host checks (`heartbeat-check.mjs`).
- **Guardrails without hands**: a market still without a proposal a day after it could have had one is voided on-chain
  (`void_stale_market`, proposer may); a position that fails to settle three rounds in a row pages once; hot wallets
  are refilled from a funding wallet to fixed targets (`sol-topup.mjs`); referral rebates are paid only for settlement
  rows the chain confirms and never twice; every commit passes `security-check.sh` (unit tests, secret scan); a weekly
  read-only Claude audit files a report and pages only on critical/high findings.
- **Languages**: en, zh-TW, zh-CN, ja, ko, es. The API picks the language per request (`?lang=` → cookie →
  Accept-Language), translates the static HTML and embeds the market list as `window.__BOOT__`, so the first paint
  needs no API round trip.

## Layout

```
programs/kubrai   Anchor program (Rust) — N-bucket parimutuel, on-chain bucket derivation
programs/ore-miner-stub   devnet-only stand-in for ORE's Miner account (same layout + PDA seeds) so the ORE-miner discount can be tried where ORE is not deployed
tests/            9 end-to-end tests against a local validator (fees, discounts, void, no-winner, multi-bucket)
server/           hourly snapshot recorder (memo hash), resolver + settlement crank, scheduled market opener (market-templates.json), public API + devnet faucet, bucket designer
web/              market pages + wallet betting (Wallet Standard), "My bets", APK download
app/              Seeker app: Expo / React Native + Mobile Wallet Adapter (Seed Vault), in-app feedback
brand/            icon sources (SVG)
idl/              program IDL + TypeScript types
```

## Program

Instruction | Who | What
--- | --- | ---
`initialize` / `update_config` | admin | fee bps (≤10% hard cap), early-bird, dispute window, min bet, pause
`create_market` | admin or proposer | metric tag, question hash, thresholds + bucket count, open/close/resolve timestamps, baseline; creates the vault
`seed_market` | anyone | add a fee-free prize to the pot
`place_bet` | anyone | bucket index + amount; fee tier locked into the position
`propose_resolution` | proposer or admin | observed value + snapshot hash; bucket derived on-chain; starts the dispute window
`finalize_resolution` | anyone after the window, admin any time | locks the outcome
`void_market` | admin | refund everyone
`settle_position` | anyone | pay one position, close it, refund its rent to the payer
`sweep_market` | anyone | after all positions are settled: fees + dust to treasury, close the vault

Program id (devnet): `F9qowxW3hmwrzDeKQXpL4rVmFcPvWe7e43oGnWU3AvQb`

## Running it

```bash
# program
anchor build
solana-test-validator --bpf-program F9qowxW3hmwrzDeKQXpL4rVmFcPvWe7e43oGnWU3AvQb target/deploy/kubrai.so &
ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 ANCHOR_WALLET=~/.config/solana/id.json npx ts-mocha -p tsconfig.json -t 200000 tests/kubrai.ts

# bootstrap a cluster (mock SKR mint, treasury, proposer key, config) and open a market
ANCHOR_PROVIDER_URL=... ANCHOR_WALLET=... npx ts-node scripts/devnet-setup.ts
CLOSE_AT=2026-09-19T00:00:00Z npx ts-node scripts/create-market.ts skr_ids_week 77,93,113 "How many new .skr IDs this week?" 0 0 500   # manual one-off
node server/open-markets.mjs            # scheduled: daily markets every day, weekly ones on Mondays (cron 00:00 UTC; markets open/close exactly on the hour)
node scripts/update-config.mjs disputeWindowSecs=21600
CLUSTER=devnet SNAPSHOT_DIR=./verify-snapshots ADMIN_KEYPAIR=... node server/verify-proposals.mjs   # second host, every 10 min
CLUSTER=devnet FUNDING_KEYPAIR=... node server/sol-topup.mjs                                       # daily
node examples/automate.mjs markets                                                                  # scripted use
node --test server/referrals.test.mjs      # points + referral rules
CLUSTER=devnet REBATE_KEYPAIR=~/.config/solana/id.json DRY_RUN=1 node server/referral-payout.mjs   # weekly cron on the app host

# server
cd server && npm i && node snapshot.mjs && node resolve.mjs && node api.mjs

# web
cd web && npm i && VITE_CLUSTER=devnet VITE_API_BASE=https://api-devnet.kubrai.xyz npm run build

# app (Android)
cd app && npm i && ./scripts/build-apk.sh
```

The app talks to the program without Anchor at runtime (`app/src/chain/raw.ts` decodes
accounts and encodes instructions by hand) because Anchor's Borsh decoder does not survive
Hermes. Every build is pinned to one cluster via `app.json` → `extra.cluster`; a devnet
build can never talk to mainnet money.

## Status

devnet: live. **For judges/testers:** the devnet faucet (web “Test wallet” or the app’s Settings screen) gives every wallet 0.05 SOL, 1,000 tSKR, a stand-in Seeker Genesis Token and a stand-in ORE Miner account, so anyone can see both holder discounts without owning a Seeker or mining ORE; on mainnet only a real Genesis Token and a real ORE Miner account qualify. Markets open on a fixed schedule — daily ones at 00:00 UTC (Seekers activated, SKR staked 24 h median, store reviews written, SOL deployed by ORE miners, ORE motherlode hits, ORE mining cost 24 h median) and weekly ones on Mondays (the same plus listings and per-app reviews). Early-bird fee applies for the first quarter of each market (6 h daily / 24 h weekly). Seed Vault Wallet betting verified on a Seeker.
mainnet: after the hackathon — upgrade authority and treasury move to a Squads multisig
first, weekly seeding runs on a spending limit, cold-start seed budget is fixed for four
weeks from launch and then funded from fees.
