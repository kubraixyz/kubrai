# Kubrai

Parimutuel prediction pools on the numbers that describe the Solana Mobile / Seeker
ecosystem itself: new `.skr` IDs this week, SKR staked ratio, daily active Seekers,
dApp Store listings. Bet in SKR, from any Solana wallet on the web or natively on
Seeker with Seed Vault.

Built for the Solana Mobile **Clock In** hackathon (Sept–Oct 2026).

## How the money works

* Every market has a **YES** pool and a **NO** pool. You pick a side and deposit SKR.
* When the market resolves, **winners get their stake back plus a pro-rata share of
  the losing pool**. Losers lose their stake.
* **The protocol fee (default 3%) is charged only on the share of the losing pool a
  winner receives.** Your own stake is never touched.
* **Discounts** lower that fee and are locked into your position at the moment you bet,
  stake-weighted, so a late top-up cannot inherit an early discount:
  * early-bird: bets placed in the first 24 h of a market get −1%.
  * SKR staking tier (v1.1): stakers of the SKR staking program get −1% / −2%.
* The treasury may **seed** a market with a fee-free prize; it is split pro-rata among
  winners. If nobody wins the seed returns to the treasury.
* If a market is **voided** (bad data, dispute upheld) every bettor is refunded in full.
* Half of collected fees seed next week's pools; the rest goes to the treasury.

## Why you can trust the settlement

1. **The server never holds funds.** Deposits sit in a program-owned vault; only the
   program's payout math can move them.
2. **Two-step resolution.** The proposer key (our server) proposes an outcome together
   with the hash of the snapshot bundle it derived it from. A 24 h dispute window
   follows. Anyone can finalize after the window; the admin key — a Seeker Seed Vault
   key — can finalize early or void the market. A compromised server can delay a market
   by a day; it cannot steal a pool.
3. **Daily snapshots are hashed on-chain** (memo tx) at a fixed time; the bundle is
   published so anyone can recompute the resolution value.
4. **Metrics are chosen to be expensive to manipulate.** Cumulative counters resolve on
   the weekly increase (new `.skr` IDs cost a $500 device each); level metrics resolve
   on the 7-day median of daily snapshots, so a one-day spike moves nothing.
5. **Settlement is permissionless.** A crank pays every winner and closes every position,
   returning the rent deposit to whoever paid it. Nobody has to remember to claim.

## Layout

```
programs/kubrai   Anchor program (Rust)
tests/            end-to-end tests against a local validator
server/           snapshot recorder, resolver, settlement crank (Node)   [wip]
web/              public market pages + wallet betting (Cloudflare Pages) [wip]
app/              Seeker app: React Native + Mobile Wallet Adapter        [wip]
```

## Program

Instruction | Who | What
--- | --- | ---
`initialize` / `update_config` | admin | fee bps (≤10% hard cap), early-bird, dispute window, min bet, pause
`create_market` | admin or proposer | metric id, question hash, threshold, open/close/resolve timestamps; creates the vault
`seed_market` | anyone | add a fee-free prize to the pot
`place_bet` | anyone | YES/NO + amount; fee tier locked into the position
`propose_resolution` | proposer or admin | outcome + observed value + snapshot hash; opens dispute window
`finalize_resolution` | anyone after window, admin anytime | makes the outcome final
`void_market` | admin | full refunds
`settle_position` | anyone | pays the owner, closes the position, rent back to its payer
`sweep_market` | anyone | after all positions settled: fees + dust (+ seed if no winners) to treasury, vault closed

Program ID (devnet): _pending first deploy_.

## Develop

```
anchor build && anchor test
```
