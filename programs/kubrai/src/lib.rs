//! Kubrai — parimutuel prediction pools on Seeker-ecosystem metrics.
//!
//! Money model (see README):
//! * Each market has 2..=8 outcome buckets defined by sorted thresholds on one
//!   metric (bucket i = value in [thresholds[i-1], thresholds[i])). A yes/no
//!   market is simply 2 buckets with 1 threshold. Each bucket has its own pool
//!   (SPL token, SKR on mainnet).
//! * Winners get their stake back plus a pro-rata share of all losing pools.
//! * The protocol fee is charged ONLY on the share of the losing pool a winner
//!   receives, never on the winner's own stake. Fee bps is locked per bet
//!   (stake-weighted per position) so early-bird / staking discounts cannot be
//!   gamed by topping up later.
//! * House "seed" (prize added by the treasury) is split pro-rata among winners
//!   with no fee.
//! * Resolution is two-step: the proposer (server key) submits only the observed
//!   VALUE plus the snapshot hash; the winning bucket is derived on-chain, so the
//!   proposer never picks an outcome directly. Anyone can finalize after the dispute window,
//!   or the admin key can finalize/void immediately.
//! * Settlement is permissionless: a crank pays every position out to its
//!   owner's token account and closes it, refunding rent to whoever paid it.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, Transfer};
use anchor_spl::token_2022::spl_token_2022::{
    extension::{BaseStateWithExtensions, StateWithExtensions},
    state::{Account as T22Account, Mint as T22Mint},
};
use spl_token_group_interface::state::TokenGroupMember;

declare_id!("F9qowxW3hmwrzDeKQXpL4rVmFcPvWe7e43oGnWU3AvQb");

pub const BPS: u128 = 10_000;
pub const MAX_FEE_BPS: u16 = 1_000; // 10% hard ceiling, protects users from a hostile config
pub const MAX_BUCKETS: usize = 8;
pub const MAX_THRESHOLDS: usize = MAX_BUCKETS - 1;
pub const NO_OUTCOME: u8 = 255;
/// A market that is still Open this long after resolve_after_ts has no usable evidence (the snapshots never verified,
/// the resolver held it); anyone allowed to propose may void it so the stakes go back instead of sitting forever.
pub const STALE_VOID_SECS: i64 = 86_400;
pub fn stale_void_allowed(now: i64, resolve_after_ts: i64) -> bool { now >= resolve_after_ts.saturating_add(STALE_VOID_SECS) }

#[program]
pub mod kubrai {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, args: ConfigArgs) -> Result<()> {
        args.validate()?;
        let c = &mut ctx.accounts.config;
        c.admin = ctx.accounts.admin.key();
        c.proposer = args.proposer;
        c.treasury = ctx.accounts.treasury.key();
        c.mint = ctx.accounts.mint.key();
        c.fee_bps = args.fee_bps;
        c.early_bird_discount_bps = args.early_bird_discount_bps;
        c.early_bird_secs = args.early_bird_secs;
        c.dispute_window_secs = args.dispute_window_secs;
        c.min_bet = args.min_bet;
        c.market_count = 0;
        c.paused = false;
        c.bump = ctx.bumps.config;
        Ok(())
    }

    pub fn update_config(ctx: Context<AdminOnly>, args: ConfigArgs, new_admin: Option<Pubkey>, paused: bool) -> Result<()> {
        args.validate()?;
        let c = &mut ctx.accounts.config;
        c.proposer = args.proposer;
        c.fee_bps = args.fee_bps;
        c.early_bird_discount_bps = args.early_bird_discount_bps;
        c.early_bird_secs = args.early_bird_secs;
        c.dispute_window_secs = args.dispute_window_secs;
        c.min_bet = args.min_bet;
        c.paused = paused;
        if let Some(a) = new_admin {
            c.admin = a;
        }
        Ok(())
    }

    /// Admin: holder discounts (Seeker Genesis Token, SKR staking) and the fee floor. Creates the account on first use.
    pub fn set_fee_tiers(ctx: Context<SetFeeTiers>, args: FeeTiersArgs) -> Result<()> {
        args.validate(ctx.accounts.config.fee_bps)?;
        let t = &mut ctx.accounts.fee_tiers;
        t.sgt_group_mint = args.sgt_group_mint;
        t.sgt_discount_bps = args.sgt_discount_bps;
        t.stake_program = args.stake_program;
        t.stake_owner_offset = args.stake_owner_offset;
        t.stake_amount_offset = args.stake_amount_offset;
        t.stake_min_amount = args.stake_min_amount;
        t.stake_discount_bps = args.stake_discount_bps;
        t.min_fee_bps = args.min_fee_bps;
        t.bump = ctx.bumps.fee_tiers;
        Ok(())
    }

    pub fn create_market(ctx: Context<CreateMarket>, args: MarketArgs) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(args.close_ts > args.open_ts, KubraiError::BadSchedule);
        require!(args.close_ts > now, KubraiError::BadSchedule);
        require!(args.resolve_after_ts >= args.close_ts, KubraiError::BadSchedule);
        let n = args.n_buckets as usize;
        require!((2..=MAX_BUCKETS).contains(&n), KubraiError::BadBuckets);
        for i in 1..(n - 1) {
            require!(args.thresholds[i] > args.thresholds[i - 1], KubraiError::BadBuckets);
        }
        let c = &mut ctx.accounts.config;
        let m = &mut ctx.accounts.market;
        m.id = c.market_count;
        m.metric = args.metric;
        m.question_hash = args.question_hash;
        m.thresholds = args.thresholds;
        m.n_buckets = args.n_buckets;
        m.outcome = NO_OUTCOME;
        m.proposed_outcome = NO_OUTCOME;
        m.open_ts = args.open_ts;
        m.close_ts = args.close_ts;
        m.resolve_after_ts = args.resolve_after_ts;
        m.baseline = args.baseline;
        m.status = MarketStatus::Open as u8;
        m.vault = ctx.accounts.vault.key();
        m.bump = ctx.bumps.market;
        c.market_count = c.market_count.checked_add(1).unwrap();
        emit!(MarketCreated { market: m.key(), id: m.id, metric: m.metric, n_buckets: m.n_buckets, thresholds: m.thresholds, open_ts: m.open_ts, close_ts: m.close_ts });
        Ok(())
    }

    /// Anyone (normally the treasury) adds a fee-free prize to the pot. Note: on void or
    /// no-winner the seed is swept to the treasury, not returned to a third-party funder.
    pub fn seed_market(ctx: Context<SeedMarket>, amount: u64) -> Result<()> {
        require!(amount > 0, KubraiError::ZeroAmount);
        {
            let m = &ctx.accounts.market;
            require!(m.status == MarketStatus::Open as u8, KubraiError::MarketNotOpen);
            require!(Clock::get()?.unix_timestamp < m.close_ts, KubraiError::BettingClosed);
        }
        token::transfer(ctx.accounts.transfer_ctx(), amount)?;
        let m = &mut ctx.accounts.market;
        m.seed_amount = m.seed_amount.checked_add(amount).unwrap();
        Ok(())
    }

    pub fn place_bet(ctx: Context<PlaceBet>, bucket: u8, amount: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let fee_bps = {
            let c = &ctx.accounts.config;
            let m = &ctx.accounts.market;
            require!(!c.paused, KubraiError::Paused);
            require!(m.status == MarketStatus::Open as u8, KubraiError::MarketNotOpen);
            require!(now >= m.open_ts, KubraiError::BettingNotStarted);
            require!(now < m.close_ts, KubraiError::BettingClosed);
            require!(amount >= c.min_bet, KubraiError::BelowMinBet);
            require!((bucket as usize) < m.n_buckets as usize, KubraiError::BadBuckets);
            // Fee tier is decided now and locked into the position, stake-weighted.
            // Early-bird window = the first quarter of the betting window, capped by config.early_bird_secs
            // (a weekly market keeps its 24 h; a daily market gets 6 h instead of the whole day).
            let mut fee_bps = c.fee_bps;
            if now < m.open_ts.saturating_add(Market::early_bird_secs(c, m)) {
                fee_bps = fee_bps.saturating_sub(c.early_bird_discount_bps);
            }
            // Holder discounts are proven by extra accounts the client appends (all optional, so old clients still
            // work): [fee_tiers PDA, Seeker Genesis Token account + its mint, SKR stake account]. Each proof is
            // verified against the account data itself; a discount is never granted on the client's word.
            let (sgt, stake, floor) = holder_discounts(&ctx.remaining_accounts, &ctx.accounts.user.key())?;
            fee_bps = fee_bps.saturating_sub(sgt).saturating_sub(stake).max(floor);
            fee_bps
        };
        // Move the tokens first, then book-keep (borrow checker: CPI needs &ctx.accounts).
        token::transfer(ctx.accounts.transfer_ctx(), amount)?;
        let user_key = ctx.accounts.user.key();
        let position_bump = ctx.bumps.position;
        let m = &mut ctx.accounts.market;
        let p = &mut ctx.accounts.position;
        if p.owner == Pubkey::default() {
            p.market = m.key();
            p.owner = user_key;
            p.payer = user_key;
            p.bump = position_bump;
            m.positions = m.positions.checked_add(1).unwrap();
            m.positions_open = m.positions_open.checked_add(1).unwrap();
        }
        let fee_w = (amount as u128).checked_mul(fee_bps as u128).unwrap();
        let b = bucket as usize;
        p.amounts[b] = p.amounts[b].checked_add(amount).unwrap();
        p.fee_w[b] = p.fee_w[b].checked_add(fee_w).unwrap();
        m.pools[b] = m.pools[b].checked_add(amount).unwrap();
        emit!(BetPlaced { market: m.key(), user: p.owner, bucket, amount, fee_bps, pools: m.pools });
        Ok(())
    }

    /// Proposer publishes the observed value plus the hash of the snapshot bundle
    /// it came from. The winning bucket is derived here, on-chain. Starts the dispute window.
    pub fn propose_resolution(ctx: Context<Propose>, observed_value: i64, snapshot_hash: [u8; 32]) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let m = &mut ctx.accounts.market;
        // A proposal may be corrected while it is still disputable; every re-proposal restarts the window.
        require!(m.status == MarketStatus::Open as u8 || m.status == MarketStatus::Proposed as u8, KubraiError::MarketNotOpen);
        require!(now >= m.resolve_after_ts, KubraiError::TooEarlyToResolve);
        let bucket = m.bucket_of(observed_value);
        m.status = MarketStatus::Proposed as u8;
        m.proposed_outcome = bucket;
        m.proposed_value = observed_value;
        m.proposed_at = now;
        m.snapshot_hash = snapshot_hash;
        emit!(ResolutionProposed { market: m.key(), bucket, observed_value, snapshot_hash, proposed_at: now });
        Ok(())
    }

    /// Anyone after the dispute window; admin immediately.
    pub fn finalize_resolution(ctx: Context<Finalize>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let c = &ctx.accounts.config;
        let m = &mut ctx.accounts.market;
        require!(m.status == MarketStatus::Proposed as u8, KubraiError::NotProposed);
        let is_admin = ctx.accounts.signer.key() == c.admin;
        require!(is_admin || now >= m.proposed_at.saturating_add(c.dispute_window_secs), KubraiError::DisputeWindowOpen);
        m.status = MarketStatus::Resolved as u8;
        m.outcome = m.proposed_outcome;
        m.resolved_at = now;
        emit!(MarketResolved { market: m.key(), bucket: m.outcome, voided: false });
        Ok(())
    }

    /// Admin escape hatch: every position is refunded in full, seed goes back to treasury.
    pub fn void_market(ctx: Context<AdminMarket>) -> Result<()> {
        let m = &mut ctx.accounts.market;
        require!(m.status == MarketStatus::Open as u8 || m.status == MarketStatus::Proposed as u8, KubraiError::AlreadyFinal);
        m.status = MarketStatus::Voided as u8;
        m.resolved_at = Clock::get()?.unix_timestamp;
        emit!(MarketResolved { market: m.key(), bucket: NO_OUTCOME, voided: true });
        Ok(())
    }

    /// Proposer (or admin) may void a market that is still without a proposal a full day after it could have had one:
    /// the evidence never verified, so nobody wins and every stake is refunded. Cannot touch a market that has a proposal.
    pub fn void_stale_market(ctx: Context<Propose>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let m = &mut ctx.accounts.market;
        require!(m.status == MarketStatus::Open as u8, KubraiError::MarketNotOpen);
        require!(stale_void_allowed(now, m.resolve_after_ts), KubraiError::NotStaleYet);
        m.status = MarketStatus::Voided as u8;
        m.resolved_at = now;
        emit!(MarketResolved { market: m.key(), bucket: NO_OUTCOME, voided: true });
        Ok(())
    }

    /// Permissionless payout + close. Winners are paid, losers just get their
    /// rent back. Works for Resolved and Voided markets.
    pub fn settle_position(ctx: Context<Settle>) -> Result<()> {
        let (payout, fee, owner, id_bytes, bump) = {
            let m = &ctx.accounts.market;
            let p = &ctx.accounts.position;
            require!(m.status == MarketStatus::Resolved as u8 || m.status == MarketStatus::Voided as u8, KubraiError::NotResolved);
            let (payout, fee) = compute_payout(m, p)?;
            (payout, fee, p.owner, m.id.to_le_bytes(), m.bump)
        };
        if payout > 0 {
            let seeds: &[&[u8]] = &[b"market", id_bytes.as_ref(), &[bump]];
            token::transfer(ctx.accounts.transfer_ctx().with_signer(&[seeds]), payout)?;
        }
        let m = &mut ctx.accounts.market;
        m.fee_collected = m.fee_collected.checked_add(fee).unwrap();
        m.paid_out = m.paid_out.checked_add(payout).unwrap();
        m.positions_open = m.positions_open.checked_sub(1).unwrap();
        emit!(PositionSettled { market: m.key(), user: owner, payout, fee });
        Ok(())
    }

    /// After every position is settled: fees + rounding dust (+ seed if voided or
    /// no winners) go to treasury, vault is closed.
    pub fn sweep_market(ctx: Context<Sweep>) -> Result<()> {
        let (id_bytes, bump) = {
            let m = &ctx.accounts.market;
            require!(m.status == MarketStatus::Resolved as u8 || m.status == MarketStatus::Voided as u8, KubraiError::NotResolved);
            require!(m.positions_open == 0, KubraiError::PositionsOutstanding);
            (m.id.to_le_bytes(), m.bump)
        };
        let remaining = ctx.accounts.vault.amount;
        let seeds: &[&[u8]] = &[b"market", id_bytes.as_ref(), &[bump]];
        if remaining > 0 {
            token::transfer(ctx.accounts.transfer_ctx().with_signer(&[seeds]), remaining)?;
        }
        token::close_account(ctx.accounts.close_ctx().with_signer(&[seeds]))?;
        let m = &mut ctx.accounts.market;
        m.swept = remaining;
        m.status = MarketStatus::Swept as u8;
        Ok(())
    }
}

/// Returns (payout_to_owner, fee_taken_from_that_payout).
pub fn compute_payout(m: &Market, p: &Position) -> Result<(u64, u64)> {
    let total_stake: u64 = p.amounts.iter().fold(0u64, |a, x| a.checked_add(*x).unwrap());
    let refund_all = || Ok::<(u64, u64), Error>((total_stake, 0));
    if m.status == MarketStatus::Voided as u8 {
        return refund_all();
    }
    let w = m.outcome as usize;
    require!(w < m.n_buckets as usize, KubraiError::NotResolved);
    let win_pool = m.pools[w];
    let lose_pool = m.total_pool().checked_sub(win_pool).unwrap();
    let stake = p.amounts[w];
    let fee_w = p.fee_w[w];
    // Nobody on the winning side: everyone is made whole, house seed returns via sweep.
    if win_pool == 0 {
        return refund_all();
    }
    if stake == 0 {
        return Ok((0, 0));
    }
    let stake128 = stake as u128;
    let win128 = win_pool as u128;
    let gross_share = (lose_pool as u128).checked_mul(stake128).ok_or(KubraiError::MathOverflow)? / win128;
    // Stake-weighted fee rate for this position: fee_w = Σ amount_i × bps_i, so fee_w / stake ≤ MAX_FEE_BPS.
    // Reducing to bps first keeps every product far below u128::MAX for any conceivable mint supply.
    let weighted_bps = (fee_w / stake128).min(MAX_FEE_BPS as u128);
    let fee = gross_share.checked_mul(weighted_bps).ok_or(KubraiError::MathOverflow)? / BPS;
    let seed_share = (m.seed_amount as u128).checked_mul(stake128).ok_or(KubraiError::MathOverflow)? / win128;
    let payout = stake128.checked_add(gross_share).and_then(|v| v.checked_sub(fee)).and_then(|v| v.checked_add(seed_share)).ok_or(KubraiError::MathOverflow)?;
    Ok((u64::try_from(payout).map_err(|_| KubraiError::MathOverflow)?, u64::try_from(fee).map_err(|_| KubraiError::MathOverflow)?))
}

// ---------- state ----------

impl Market {
    /// Seconds after open during which the early-bird discount applies: min(config cap, 25 % of the window).
    pub fn early_bird_secs(c: &Config, m: &Market) -> i64 {
        let quarter = m.close_ts.saturating_sub(m.open_ts) / 4;
        c.early_bird_secs.min(quarter).max(0)
    }
    /// Bucket index for a value: number of active thresholds the value reaches.
    /// bucket 0 = below thresholds[0]; bucket n-1 = at or above thresholds[n-2].
    pub fn bucket_of(&self, value: i64) -> u8 {
        let n = self.n_buckets as usize;
        let mut b = 0u8;
        for i in 0..(n - 1) {
            if value >= self.thresholds[i] {
                b = (i + 1) as u8;
            }
        }
        b
    }
    pub fn total_pool(&self) -> u64 {
        self.pools.iter().fold(0u64, |a, x| a.checked_add(*x).unwrap())
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum MarketStatus {
    Open = 0,
    Proposed = 1,
    Resolved = 2,
    Voided = 3,
    Swept = 4,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ConfigArgs {
    pub proposer: Pubkey,
    pub fee_bps: u16,
    pub early_bird_discount_bps: u16,
    pub early_bird_secs: i64,
    pub dispute_window_secs: i64,
    pub min_bet: u64,
}
impl ConfigArgs {
    fn validate(&self) -> Result<()> {
        require!(self.fee_bps <= MAX_FEE_BPS, KubraiError::FeeTooHigh);
        require!(self.early_bird_discount_bps <= self.fee_bps, KubraiError::FeeTooHigh);
        require!(self.early_bird_secs >= 0 && self.dispute_window_secs >= 0, KubraiError::BadSchedule);
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct FeeTiersArgs {
    pub sgt_group_mint: Pubkey,
    pub sgt_discount_bps: u16,
    pub stake_program: Pubkey,
    pub stake_owner_offset: u16,
    pub stake_amount_offset: u16,
    pub stake_min_amount: u64,
    pub stake_discount_bps: u16,
    pub min_fee_bps: u16,
}
impl FeeTiersArgs {
    fn validate(&self, fee_bps: u16) -> Result<()> {
        require!(self.sgt_discount_bps <= fee_bps && self.stake_discount_bps <= fee_bps && self.min_fee_bps <= fee_bps, KubraiError::FeeTooHigh);
        Ok(())
    }
}

/// Holder discounts, admin-settable without a redeploy. Zero discount / default pubkey = disabled.
#[account]
#[derive(InitSpace)]
pub struct FeeTiers {
    pub sgt_group_mint: Pubkey,     // Token-2022 group mint of the Seeker Genesis Token (GT22…99Te on mainnet)
    pub sgt_discount_bps: u16,
    pub stake_program: Pubkey,      // SKR staking program; its stake account layout is described by the two offsets
    pub stake_owner_offset: u16,
    pub stake_amount_offset: u16,
    pub stake_min_amount: u64,
    pub stake_discount_bps: u16,
    pub min_fee_bps: u16,           // discounts never take the fee below this
    pub bump: u8,
}

/// Returns (sgt_discount, stake_discount, fee_floor) proven by the remaining accounts; (0, 0, 0) when none apply.
fn holder_discounts(remaining: &[AccountInfo], user: &Pubkey) -> Result<(u16, u16, u16)> {
    let (tiers_pda, _) = Pubkey::find_program_address(&[b"fee_tiers"], &crate::ID);
    let Some(tiers_ai) = remaining.iter().find(|a| a.key() == tiers_pda) else { return Ok((0, 0, 0)) };
    require!(tiers_ai.owner == &crate::ID, KubraiError::BadProof);
    let tiers = FeeTiers::try_deserialize(&mut &tiers_ai.data.borrow()[..])?;
    let t22 = anchor_spl::token_2022::ID;
    let mut sgt = 0u16;
    let mut stake = 0u16;
    // Seeker Genesis Token: a Token-2022 token account owned by the user, balance ≥ 1, whose mint is a member of the group.
    if tiers.sgt_discount_bps > 0 && tiers.sgt_group_mint != Pubkey::default() {
        'outer: for acc in remaining.iter().filter(|a| a.owner == &t22) {
            let data = acc.data.borrow();
            let Ok(tok) = StateWithExtensions::<T22Account>::unpack(&data) else { continue };
            if tok.base.owner != *user || tok.base.amount == 0 { continue; }
            for mint_ai in remaining.iter().filter(|a| a.owner == &t22 && a.key() == tok.base.mint) {
                let mdata = mint_ai.data.borrow();
                let Ok(mint) = StateWithExtensions::<T22Mint>::unpack(&mdata) else { continue };
                if let Ok(member) = mint.get_extension::<TokenGroupMember>() {
                    if Pubkey::from(member.group.to_bytes()) == tiers.sgt_group_mint && Pubkey::from(member.mint.to_bytes()) == mint_ai.key() {
                        sgt = tiers.sgt_discount_bps;
                        break 'outer;
                    }
                }
            }
        }
    }
    // SKR staking: an account of the staking program whose owner field is the user and whose amount field clears the minimum.
    if tiers.stake_discount_bps > 0 && tiers.stake_program != Pubkey::default() {
        let (oo, ao) = (tiers.stake_owner_offset as usize, tiers.stake_amount_offset as usize);
        for acc in remaining.iter().filter(|a| a.owner == &tiers.stake_program) {
            let data = acc.data.borrow();
            if data.len() < oo + 32 || data.len() < ao + 8 { continue; }
            if data[oo..oo + 32] != user.to_bytes() { continue; }
            let amount = u64::from_le_bytes(data[ao..ao + 8].try_into().unwrap());
            if amount >= tiers.stake_min_amount { stake = tiers.stake_discount_bps; break; }
        }
    }
    Ok((sgt, stake, tiers.min_fee_bps))
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct MarketArgs {
    pub metric: [u8; 32],
    pub question_hash: [u8; 32],
    /// Sorted, strictly increasing; only the first n_buckets-1 entries are used.
    pub thresholds: [i64; MAX_THRESHOLDS],
    pub n_buckets: u8,
    pub open_ts: i64,
    pub close_ts: i64,
    pub resolve_after_ts: i64,
    /// Value of the metric at market open (from the opening snapshot). For weekly-increase
    /// markets the observed value is close − baseline; for level markets it is informational.
    pub baseline: i64,
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub proposer: Pubkey,
    pub treasury: Pubkey,
    pub mint: Pubkey,
    pub fee_bps: u16,
    pub early_bird_discount_bps: u16,
    pub early_bird_secs: i64,
    pub dispute_window_secs: i64,
    pub min_bet: u64,
    pub market_count: u64,
    pub paused: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Market {
    pub id: u64,
    pub metric: [u8; 32],
    pub question_hash: [u8; 32],
    pub thresholds: [i64; MAX_THRESHOLDS],
    pub n_buckets: u8,
    pub open_ts: i64,
    pub close_ts: i64,
    pub resolve_after_ts: i64,
    /// Metric value at open (see MarketArgs::baseline).
    pub baseline: i64,
    pub pools: [u64; MAX_BUCKETS],
    pub seed_amount: u64,
    pub status: u8,
    /// Winning bucket index once resolved; NO_OUTCOME otherwise.
    pub outcome: u8,
    pub proposed_outcome: u8,
    pub proposed_value: i64,
    pub proposed_at: i64,
    pub snapshot_hash: [u8; 32],
    pub resolved_at: i64,
    pub fee_collected: u64,
    pub paid_out: u64,
    pub swept: u64,
    pub positions: u32,
    pub positions_open: u32,
    pub vault: Pubkey,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Position {
    pub market: Pubkey,
    pub owner: Pubkey,
    pub payer: Pubkey,
    pub amounts: [u64; MAX_BUCKETS],
    pub fee_w: [u128; MAX_BUCKETS],
    pub bump: u8,
}

// ---------- contexts ----------

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(token::mint = mint)]
    pub treasury: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = admin @ KubraiError::Unauthorized)]
    pub config: Account<'info, Config>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct CreateMarket<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump,
        constraint = signer.key() == config.admin || signer.key() == config.proposer @ KubraiError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(init, payer = signer, space = 8 + Market::INIT_SPACE,
        seeds = [b"market", config.market_count.to_le_bytes().as_ref()], bump)]
    pub market: Account<'info, Market>,
    #[account(init, payer = signer, token::mint = mint, token::authority = market,
        seeds = [b"vault", market.key().as_ref()], bump)]
    pub vault: Account<'info, TokenAccount>,
    #[account(address = config.mint)]
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub signer: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SeedMarket<'info> {
    #[account(mut, seeds = [b"market", market.id.to_le_bytes().as_ref()], bump = market.bump, has_one = vault)]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = vault.mint, token::authority = funder.key())]
    pub funder_token: Account<'info, TokenAccount>,
    pub funder: Signer<'info>,
    pub token_program: Program<'info, Token>,
}
impl<'info> SeedMarket<'info> {
    fn transfer_ctx(&self) -> CpiContext<'_, '_, '_, 'info, Transfer<'info>> {
        CpiContext::new(self.token_program.key(), Transfer {
            from: self.funder_token.to_account_info(),
            to: self.vault.to_account_info(),
            authority: self.funder.to_account_info(),
        })
    }
}

#[derive(Accounts)]
pub struct SetFeeTiers<'info> {
    #[account(seeds = [b"config"], bump = config.bump, has_one = admin @ KubraiError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(init_if_needed, payer = admin, space = 8 + FeeTiers::INIT_SPACE, seeds = [b"fee_tiers"], bump)]
    pub fee_tiers: Account<'info, FeeTiers>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PlaceBet<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"market", market.id.to_le_bytes().as_ref()], bump = market.bump, has_one = vault)]
    pub market: Account<'info, Market>,
    #[account(init_if_needed, payer = user, space = 8 + Position::INIT_SPACE,
        seeds = [b"position", market.key().as_ref(), user.key().as_ref()], bump)]
    pub position: Account<'info, Position>,
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = config.mint, token::authority = user.key())]
    pub user_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
impl<'info> PlaceBet<'info> {
    fn transfer_ctx(&self) -> CpiContext<'_, '_, '_, 'info, Transfer<'info>> {
        CpiContext::new(self.token_program.key(), Transfer {
            from: self.user_token.to_account_info(),
            to: self.vault.to_account_info(),
            authority: self.user.to_account_info(),
        })
    }
}

#[derive(Accounts)]
pub struct Propose<'info> {
    #[account(seeds = [b"config"], bump = config.bump,
        constraint = proposer.key() == config.proposer || proposer.key() == config.admin @ KubraiError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"market", market.id.to_le_bytes().as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
    pub proposer: Signer<'info>,
}

#[derive(Accounts)]
pub struct Finalize<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"market", market.id.to_le_bytes().as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct AdminMarket<'info> {
    #[account(seeds = [b"config"], bump = config.bump, has_one = admin @ KubraiError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"market", market.id.to_le_bytes().as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(mut, seeds = [b"market", market.id.to_le_bytes().as_ref()], bump = market.bump, has_one = vault)]
    pub market: Account<'info, Market>,
    #[account(mut, close = payer, seeds = [b"position", market.key().as_ref(), position.owner.as_ref()], bump = position.bump,
        has_one = market, has_one = payer)]
    pub position: Account<'info, Position>,
    /// CHECK: rent goes back to whoever created the position; enforced by has_one.
    #[account(mut)]
    pub payer: UncheckedAccount<'info>,
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = vault.mint, token::authority = position.owner)]
    pub owner_token: Account<'info, TokenAccount>,
    pub cranker: Signer<'info>,
    pub token_program: Program<'info, Token>,
}
impl<'info> Settle<'info> {
    fn transfer_ctx(&self) -> CpiContext<'_, '_, '_, 'info, Transfer<'info>> {
        CpiContext::new(self.token_program.key(), Transfer {
            from: self.vault.to_account_info(),
            to: self.owner_token.to_account_info(),
            authority: self.market.to_account_info(),
        })
    }
}

#[derive(Accounts)]
pub struct Sweep<'info> {
    #[account(seeds = [b"config"], bump = config.bump, has_one = treasury)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"market", market.id.to_le_bytes().as_ref()], bump = market.bump, has_one = vault)]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub treasury: Account<'info, TokenAccount>,
    /// CHECK: vault rent is returned to the admin; address enforced.
    #[account(mut, address = config.admin)]
    pub rent_dest: UncheckedAccount<'info>,
    pub signer: Signer<'info>,
    pub token_program: Program<'info, Token>,
}
impl<'info> Sweep<'info> {
    fn transfer_ctx(&self) -> CpiContext<'_, '_, '_, 'info, Transfer<'info>> {
        CpiContext::new(self.token_program.key(), Transfer {
            from: self.vault.to_account_info(),
            to: self.treasury.to_account_info(),
            authority: self.market.to_account_info(),
        })
    }
    fn close_ctx(&self) -> CpiContext<'_, '_, '_, 'info, CloseAccount<'info>> {
        CpiContext::new(self.token_program.key(), CloseAccount {
            account: self.vault.to_account_info(),
            destination: self.rent_dest.to_account_info(),
            authority: self.market.to_account_info(),
        })
    }
}

// ---------- events & errors ----------

#[event]
pub struct MarketCreated { pub market: Pubkey, pub id: u64, pub metric: [u8; 32], pub n_buckets: u8, pub thresholds: [i64; MAX_THRESHOLDS], pub open_ts: i64, pub close_ts: i64 }
#[event]
pub struct BetPlaced { pub market: Pubkey, pub user: Pubkey, pub bucket: u8, pub amount: u64, pub fee_bps: u16, pub pools: [u64; MAX_BUCKETS] }
#[event]
pub struct ResolutionProposed { pub market: Pubkey, pub bucket: u8, pub observed_value: i64, pub snapshot_hash: [u8; 32], pub proposed_at: i64 }
#[event]
pub struct MarketResolved { pub market: Pubkey, pub bucket: u8, pub voided: bool }
#[event]
pub struct PositionSettled { pub market: Pubkey, pub user: Pubkey, pub payout: u64, pub fee: u64 }

#[error_code]
pub enum KubraiError {
    #[msg("discount proof account is malformed")]
    BadProof,
    #[msg("unauthorized")] Unauthorized,
    #[msg("fee above hard ceiling")] FeeTooHigh,
    #[msg("bad schedule")] BadSchedule,
    #[msg("amount must be > 0")] ZeroAmount,
    #[msg("below minimum bet")] BelowMinBet,
    #[msg("market is not open")] MarketNotOpen,
    #[msg("betting has not started")] BettingNotStarted,
    #[msg("betting is closed")] BettingClosed,
    #[msg("protocol paused")] Paused,
    #[msg("too early to resolve")] TooEarlyToResolve,
    #[msg("no resolution proposed")] NotProposed,
    #[msg("dispute window still open")] DisputeWindowOpen,
    #[msg("market already final")] AlreadyFinal,
    #[msg("market not resolved")] NotResolved,
    #[msg("positions still outstanding")] PositionsOutstanding,
    #[msg("bad bucket definition or index")] BadBuckets,
    #[msg("arithmetic overflow")] MathOverflow,
    #[msg("market is not stale yet: a day must pass after resolve_after_ts without a proposal")] NotStaleYet,
}

#[cfg(test)]
mod stale_tests {
    use super::*;
    #[test]
    fn stale_void_needs_a_full_day_after_resolve_after() {
        assert!(!stale_void_allowed(1_000, 1_000));
        assert!(!stale_void_allowed(1_000 + STALE_VOID_SECS - 1, 1_000));
        assert!(stale_void_allowed(1_000 + STALE_VOID_SECS, 1_000));
        assert!(stale_void_allowed(i64::MAX, i64::MAX - 5));
    }
}
