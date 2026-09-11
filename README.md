# Kubrai

Parimutuel prediction pools on the numbers that describe the Solana Mobile / Seeker
ecosystem itself: new `.skr` IDs this week, SKR staked, dApp Store listings, reviews of
the apps Seekers actually use. Bet in SKR from any Solana wallet on the web, or natively
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
  * early-bird: bets placed in the first 24 h of a market get −1%.
  * SKR staking tier and Seeker Genesis Token holders (mainnet): further −1% / −2%.
* The treasury may **seed** a market with a fee-free prize; it is split pro-rata among
  winners. If nobody wins the seed returns to the treasury.
* If a market is **voided** every bettor is refunded in full.
* Bucket thresholds are cut at the **quantiles of the last 12 weekly values**, so every
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
   **betting closes before the closing snapshot is taken** (00:05 UTC), so nobody bets on a
   number they have already seen.
4. **Daily snapshots are hashed on-chain** (memo tx) and published with their evidence
   (`/snapshots/:day`). Sources are labelled on every market: *on-chain* (recomputable by
   anyone: `.skr` name records, the SKR staking vault), *store data* (dApp Store catalog),
   *third-party*.
5. **Metrics are chosen to be expensive to manipulate.** A new `.skr` ID needs a Seeker
   Genesis Token, i.e. a $500 device; dApp Store reviews can only be written from verified
   devices, one per device per app. Level metrics resolve on the 7-day median of daily
   snapshots, so a one-day spike moves nothing.
6. **Settlement is permissionless.** A crank pays every winner and closes every position,
   returning the rent deposit to whoever paid it. Nobody has to remember to claim.

## Layout

```
programs/kubrai   Anchor program (Rust) — N-bucket parimutuel, on-chain bucket derivation
tests/            7 end-to-end tests against a local validator (fees, void, no-winner, multi-bucket)
server/           snapshot recorder (daily, memo hash), resolver + settlement crank, public API + devnet faucet, bucket designer
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
CLOSE_AT=2026-09-19T00:00:00Z npx ts-node scripts/create-market.ts skr_ids_week 77,93,113 "How many new .skr IDs this week?" 0 0 500

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

devnet: live, five weekly markets, Seed Vault Wallet betting verified on a Seeker.
mainnet: after the hackathon — upgrade authority and treasury move to a Squads multisig
first, weekly seeding runs on a spending limit, cold-start seed budget is fixed for four
weeks from launch and then funded from fees.
