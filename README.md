# Kubrai

Parimutuel prediction pools on the apps in the **Solana dApp Store**: Jupiter's swap volume
and revenue, Jupiter Perps fees, Phantom's revenue, the pump.fun app's revenue, SOL staked with
Jito / JupSOL / Sanctum, Backpack's reserves, the [ORE](https://ore.supply) mining game, and the
Seeker itself (Genesis Tokens activated, SKR staked). Only apps listed in the store get markets,
and only numbers that cost money to move: fees and revenue have to be paid, staked SOL has to stay
parked; transaction, wallet and review counts are deliberately not markets. Bet in SKR from any
Solana wallet on the web, or natively on Seeker with Seed Vault Wallet.

No other prediction app in the dApp Store runs markets on the store's own apps (checked
2026-09-25 against the 24 prediction and betting apps listed).

Built for the Solana Mobile **Clock In** hackathon (Sept–Oct 2026).

**Try it (devnet):** web <https://devnet.kubrai.xyz> · Android APK linked from the same page
(test tokens from the in-app faucet) · API <https://api-devnet.kubrai.xyz/health> · docs + 3-minute demo video <https://devnet.kubrai.xyz/docs.html>

## How the money works

* A market splits one metric into **2–8 ranges** ("buckets") by sorted thresholds. A yes/no
  market is just two buckets. Each bucket has its own pool; you pick one and deposit SKR.
* When the market resolves, **winners get their stake back plus a pro-rata share of every
  losing pool**. Losers lose their stake.
* **The protocol fee (default 3%) is charged only on the share of the losing pools a winner
  receives.** Your own stake is never touched.
* **Discounts** lower that fee and are locked into your position at the moment you bet,
  stake-weighted, so a late top-up cannot inherit an early discount:
  * early-bird: bets placed in the first quarter of a market's betting window (about 6 h of a daily market; capped at 24 h) get −1%.
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
* **No house prize.** Pools are only what bettors put in (the program still has `seed_market` for a prize that
  is split pro-rata among winners, but the opener does not use it unless `SEED_MARKETS=1`).
* If a market is **voided** every bettor is refunded in full.
* Bucket thresholds are cut at the **quantiles of the metric's own recent history** (windows of the same length), so every
  range starts out roughly equally likely (`server/buckets.mjs`).

## Why you can trust the settlement

1. **The server never holds funds.** Deposits sit in a program-owned vault; only the
   program's payout math can move them.
2. **The proposer submits a number, not a winner.** Our server proposes the observed value
   plus the hash of the snapshot bundle it came from; the winning bucket is derived
   **on-chain** from the market's thresholds. A 6 h dispute window follows. Anyone can
   finalize after the window; the admin key (a Seed Vault key, multisig on mainnet) can
   finalize early or void. A second host re-derives every proposed value from its own
   snapshots and holds a **verifier** key (`Roles.verifier`, `void_proposed_market`) that can do
   exactly one thing: void a market whose proposal it cannot confirm. It cannot propose,
   finalize, touch an open market or change the config. A compromised server can delay a
   market by a day and lie about a number that everyone can check; a compromised verifier can
   force refunds; neither can steal a pool.
3. **Each daily market counts one full UTC day, and its clock is fixed on-chain at creation.** Betting opens at
   11:00 UTC the day before (13 hours before the counted day begins) and closes at 12:00 UTC, halfway through it, so
   nobody bets having seen more than half of the day; the next day's markets open an hour before that, so there is
   always one to bet on. Numbers a third party publishes per day (DefiLlama) are read a fixed number of hours after
   the day ends (6, 24 or 48 h per metric, stored on-chain as `resolve_after`): whatever the source shows at that
   moment settles the market and later revisions do not count; if the source moves the day's number into another
   range before the result is final, the verifier voids the market and everyone is refunded.
4. **Hourly snapshots are hashed on-chain** (memo tx) and published with their evidence
   (`/snapshots/:day`). Sources are labelled on every market: *on-chain* (recomputable by
   anyone: `.skr` name records, the SKR staking vault), *store data* (dApp Store catalog),
   *third-party*.
5. **Metrics are chosen to be expensive to manipulate.** A new `.skr` ID needs a Seeker
   Genesis Token, i.e. a $500 device; (review counts are **not** a market: one verified
   Seeker may review each of the 1,300+ listed apps once, so a single device could move the store-wide count by
   hundreds in a day); pushing up the SOL deployed in ORE burns about 10% of
   every extra SOL (ORE returns 89% of a losing square), and whether an ORE round hits the
   motherlode comes from the round's on-chain randomness, which nobody can steer. Level metrics resolve on the median of every hourly snapshot inside the counted day (24; at least 75 % must exist), so a last-minute deposit or withdrawal cannot move the result. Cumulative metrics resolve on the increase between the day's first and last hourly snapshot (snapshots are taken right after the hour, so consecutive days share one reading and nothing is counted twice).
6. **Settlement is permissionless.** A crank pays every winner and closes every position,
   returning the rent deposit to whoever paid it. Nobody has to remember to claim.

**One market, end to end.** Devnet market #18, "Seekers activated", counted day 12 September 2026; each link opens the
devnet explorer. [Created](https://explorer.solana.com/tx/2AraQHiVVJ1q4s5Q99VS9pj3ktZXx89j3T7BP9evZBCFAHMnoAMvKHMrwg7LjQ5nUi3QLVFiiN4buLTZokiw74gF?cluster=devnet)
and [seeded with 100 tSKR](https://explorer.solana.com/tx/xYvmi9VYFHhEx48PShaNK5oSHNdq6w3tKncQUNUgqgwkeifNNqKC592ZHXEcFEkZyZHDs2LW4obHSecZS2WVwQo?cluster=devnet)
at 00:00 UTC on 12 September (early devnet markets were seeded; mainnet markets are not). Bets, among them
[200 tSKR](https://explorer.solana.com/tx/4tDUSFVaiQzt8iBRwF3bdsgNJzPPomJZ46VPvHWvMgSwhMf42sWp5j8v1C8UJ8GvRAXutYGAtsDCohT3cLrFWxES?cluster=devnet)
on "< 13" and [5 tSKR](https://explorer.solana.com/tx/3L58KJMugGxqWadgu7dZXknW6zsCE5EvXTcwvY2oGCD1uDcUT9eWqKZPWxc9khzSmSmx8Fqr1TjbdZYYM2ebkfGL?cluster=devnet)
on "13–15" from one wallet. Hourly snapshots through the day, each hash in a
[memo](https://explorer.solana.com/tx/2EJe5bW9q84fTaH2bPBtxU1YtnVgxLmU6i9xRxcrW12nAqD5J126yaJmk2xHoiqvqryYzdHKq9qcN3C2e4JY5HsA?cluster=devnet).
The [proposal](https://explorer.solana.com/tx/4hoypTth6rsnFaKzSiqgCRzSckWTpJR3dsRYzmYW8PfpF2gxfiM8W1mekoSBPqyGo7MJpbzZmYuk67GK5jzHc4P9?cluster=devnet)
at 00:20 UTC on 13 September: observed 11 (120,840 − 120,829 Genesis Tokens between the day's first and last
snapshot), evidence hash `8a20282b…4fbdc9`; the program derives the range "< 13". During the window that wallet filed a
dispute claiming 15; it was answered from the published snapshots and closed (logged at `/disputes`). After six hours
[finalize](https://explorer.solana.com/tx/KorRcMT45Pgo33xrGomCTSrQ2QFSu8VGNxKiRrT4ZzT8wvmiZRBd8ZxUoj5X8XDfJNx2Pzxk8KugV155rK1QGbS?cluster=devnet),
then the crank's [payout](https://explorer.solana.com/tx/2z1nydtGM19RbF4wq1Tmj4r8S3QY4w91fJJrvEZ6ULvSWVz2XaG9vZyuG13XLAG3pVjeV5DkaxpFgwmh2PZFno3u?cluster=devnet):
305.294 tSKR to the wallet that staked 205 (fee 0.179), the
[other winner's share](https://explorer.solana.com/tx/5knkLVft4dwVSJn7ykmeBnUL7UZe8Qg4vuuZLJ4xPYz3aSvFMFWPRc8dx8zdQe3kuDCm179c7Lua15ksYuJePr23?cluster=devnet),
and the [sweep](https://explorer.solana.com/tx/4Z5GV7yQHT8G72idXn25Pu7W89k8poJ2oia2fWDvfy3DrYo3zRanJq3L6XacMwcijmX9TpNiSvRkVAQninsfu17o?cluster=devnet)
that closes the market. The same bet is the "Won" card on the Seeker's My bets screen in the demo video.

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
  and the referral payout, all under `flock`. It holds only hot keys with a bounded blast radius: the **proposer**
  (opens markets, proposes values, settles, sweeps), the **rebate** wallet (a week of referral rebates in SKR), the
  **funding** wallet (a few SOL for top-ups), the devnet **faucet**, and the **deployer** (program upgrade authority on
  devnet; Squads on mainnet). The admin key is not on it. It serves no admin UI.
- **Tokyo** takes its own hourly snapshots and runs `server/verify-proposals.mjs` every 10 minutes with the
  **verifier** key: every proposed value is re-derived from Tokyo's snapshots; a different range voids the market
  (full refunds, `void_proposed_market`) and pages; a result Tokyo watched but cannot verify is voided 45 min before
  the window closes; a market Tokyo was not watching yet is left to the proposal. Tokyo is also the admin host: it
  reprices the ORE-miner discount daily (`ore-tier.mjs`, `set_fee_tiers`), runs the operator dashboard (read-only
  rsync of the app host's data every 5 min; the only action is *void*, typed out to confirm), keeps an hourly
  versioned backup of the app host's snapshots, memos, crontab and Caddyfile, and pushes a heartbeat the app host
  checks (`heartbeat-check.mjs`). On mainnet the admin key becomes a Squads multisig; Tokyo keeps only the verifier.
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
tests/            11 end-to-end tests against a local validator (fees, discounts, voids, no-winner, multi-bucket)
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
`void_proposed_market` | verifier or admin | refund everyone while a result is only proposed (the second host's single power)
`void_stale_market` | proposer or admin | refund everyone when a market has gone a day past `resolve_after` with no proposal
`set_fee_tiers` / `set_roles` | admin | holder discounts (Genesis Token group, generic stake/ORE rule) and the verifier key
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
node server/open-markets.mjs            # scheduled: cron 11:00 UTC daily; opens the next UTC day's markets from server/market-templates.json (weekly templates are paused)
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

## Verified on a device

- The submission APK is `kubrai-0.1.43-devnet.apk` (sha256
  `e58530c3f4334f9c02229653ab95dde41e60333cd4290d480214d9cf49f951ba`, 20,408,944 bytes), built by
  `app/scripts/build-apk.sh` (Expo prebuild + Gradle release build, signed with the project keystore) and installed on a
  Seeker (Android 16) on 6 October 2026. The demo video is that phone's screen, recorded over adb.
- Bets signed in Seed Vault Wallet on that Seeker while the demo was recorded, all on devnet:
  [2G9ensyc…](https://explorer.solana.com/tx/2G9ensycFSHXr4c1dRuTU5XXWm6rBmf6wp5SaocMDXTMqCokobA7eHxadVduiLnKpG1zA6LLp7BHLGkfc97kiGW5?cluster=devnet)
  and [2xF1ZFHm…](https://explorer.solana.com/tx/2xF1ZFHmKUGap1nzqFwNardDj14UTMbaFttFVAaxppJrJyaockokYaN2SU8ZaD5kGzgscm6e2ssgp2mNJH6gtxwA?cluster=devnet)
  (market #278, "Seekers activated" for 7 October, 50 tSKR on each of two ranges, 6 October 15:43 and 15:48 UTC),
  [5UjDm1ox…](https://explorer.solana.com/tx/5UjDm1oxJY8jX3FQNQGstCstuSDHHRJnwc7y4GNCPxQRWoqKpDGmqNDrrW8eoUBRYwb7VDnUwTi6CtANCsEqiNxL?cluster=devnet)
  (market #297, 7 October 12:14 UTC) and
  [42atgRr2…](https://explorer.solana.com/tx/42atgRr2LHGSjxqXrJc58DUWVM36m5UGQve2FcktaVFDaMSx2p2EsyNfZDEaA6GJyWbdv6QMHuahQh6QS82irzkj?cluster=devnet)
  (market #306, ORE price, 12:25 UTC: the bet the demo shows). Market #278 then went the whole way: the crank's
  [settlement](https://explorer.solana.com/tx/H5PnUPmqjHaXTSoZdmstaXn1q9VTfj98CsFsdtJPrjdHtkKcYvVTqtztGCteZScQbg17DTHXZw3DUPkKzQHMmTo?cluster=devnet)
  on 8 October 07:20 UTC paid 99.5 tSKR back to the wallet: its 50 on the winning range plus the 50 it had on the
  other range less a 1 % fee (3 %, minus the early-bird and the Genesis Token discount, both proven on-chain).
- The program tests (`tests/kubrai.ts`, 11 end-to-end on a local validator) cover the admin paths as well as the
  money paths: `set_fee_tiers` from a non-admin fails with `Unauthorized`, a discount above the cap with `FeeTooHigh`,
  `create_market` from a non-admin with `Unauthorized`.
- An independent black-box review of the app, working from screenshots of the Seeker (7 October), found four issues;
  all four are fixed in 561645a.

## Security review

Radiants' advisory security module read this repository at cdfc7fb on 7 October 2026: 200 files, unsafe source
patterns, dependency advisories (npm and Cargo), compiler-level checks on the Rust code, deployment configuration.
It confirmed no defect in the code. What it listed as "worth a look", and what each one is:

- **`init_if_needed` on `fee_tiers`, `roles`, `position`.** Intended. The first two are admin-only (`has_one = admin`)
  and are rewritten on every call; `position` is a PDA on `[market, user]`, so an existing account can only be reached
  by the same wallet adding to its own stake, and `place_bet` sets `owner` and `market` only when the account is fresh.
- **`initialize` takes the admin from the signer.** The bootstrap. `config` is a fixed-seed singleton created once, right
  after deployment, by the deployer (devnet: done on 10 September; mainnet: the same transaction, after which the
  authority moves to the Squads multisig).
- **"Missing owner check" on `tiers_ai`.** The check is the next line: `require!(tiers_ai.owner == &crate::ID)`.
- **Token accounts "not constrained to be distinct" from the vault.** Each is constrained to another authority or
  address: `user_token` and `funder_token` to the signer, `owner_token` to `position.owner`, `treasury` to
  `config.treasury` (`has_one`). The vault's authority is the market PDA, so none of them can be the vault.
- **A rate limit keyed on `X-Forwarded-For`.** The API accepts connections only from Cloudflare (Caddy refuses the rest),
  so the forwarded chain always has two hops and the key is `CF-Connecting-IP`, which Cloudflare writes itself and a
  visitor cannot set; `server/client-ip.mjs` explains the cases.
- **HTML written with `innerHTML`.** The website renders from template strings. Every value that arrives from a URL, a
  wallet or the API passes through `esc()`; the other interpolated strings are our own dictionary.
- **A deep link handler acting on the incoming URL.** `refFromUrl` accepts only `kubrai.xyz` and `kubrai://` links and
  only an invite code matching `^[A-Z0-9]{6,10}$`; the code is stored, and nothing is signed until the user places a bet.
- **Unchecked arithmetic, a missing owner check and `init_if_needed` in `programs/ore-miner-stub`.** A devnet-only
  stand-in for ORE's Miner account, so the miner discount can be exercised where ORE is not deployed. Never on mainnet.
- **Dependency advisories** (`tar`, `postcss`, `toml`, `@xmldom/xmldom`, `image-size`, `uuid`, `decode-uri-component`;
  `bigint-buffer` and `bincode` have no fixed release). `tar` (Expo CLI, cacache), `postcss` (Metro config), `image-size`
  (Metro) and `@xmldom/xmldom` (plist) belong to the build toolchain and never enter the APK; `toml` ships with the Anchor
  client package; `bigint-buffer` comes with web3.js' buffer-layout-utils. We left the lockfiles alone in the last days
  before the deadline, with a build verified on a Seeker as it is; bumping them is the first item for the mainnet release.

## Status

devnet: live. **For judges/testers:** the devnet faucet (web “Test wallet” or the app’s Settings screen) gives every wallet 0.05 SOL, 1,000 tSKR, a stand-in Seeker Genesis Token and a stand-in ORE Miner account, so anyone can see both holder discounts without owning a Seeker or mining ORE; on mainnet only a real Genesis Token and a real ORE Miner account qualify. 19 daily markets open every day at 11:00 UTC for the following UTC day, in eight groups: Seeker (Seekers activated, SKR staked, SKR price), DeFi (Jupiter swap volume, Jupiter revenue), Trading (Jupiter Perps fees), Staking (JitoSOL, JupSOL, Phantom pSOL and Sanctum INF supply, Jito MEV tips), Wallets (Phantom revenue, Backpack reserves), Launchpads (pump.fun app revenue), ORE (SOL deployed, motherlode hits, mining cost, price) and the Solana network (fees). Weekly markets are paused until their metrics have enough history for quantile ranges. The early-bird discount applies for the first quarter of each betting window (about 6 h). Seed Vault Wallet betting verified on a Seeker.
mainnet: after the hackathon — upgrade authority and treasury move to a Squads multisig first; no seeding.
