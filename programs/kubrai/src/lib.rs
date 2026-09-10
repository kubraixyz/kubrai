//! Kubrai — parimutuel prediction pools on Seeker-ecosystem metrics.
//!
//! Money model (see README):
//! * Each market has a YES pool and a NO pool (SPL token, SKR on mainnet).
//! * Winners get their stake back plus a pro-rata share of the losing pool.
//! * The protocol fee is charged ONLY on the share of the losing pool a winner
//!   receives, never on the winner's own stake. Fee bps is locked per bet
//!   (stake-weighted per position) so early-bird / staking discounts cannot be
//!   gamed by topping up later.
//! * House "seed" (prize added by the treasury) is split pro-rata among winners
//!   with no fee.
//! * Resolution is two-step: the proposer (server key) proposes an outcome with
//!   the snapshot hash it used; anyone can finalize after the dispute window,
//!   or the admin key can finalize/void immediately.
//! * Settlement is permissionless: a crank pays every position out to its
//!   owner's token account and closes it, refunding rent to whoever paid it.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, Transfer};

declare_id!("F9qowxW3hmwrzDeKQXpL4rVmFcPvWe7e43oGnWU3AvQb");

pub const BPS: u128 = 10_000;
pub const MAX_FEE_BPS: u16 = 1_000; // 10% hard ceiling, protects users from a hostile config

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

    pub fn create_market(ctx: Context<CreateMarket>, args: MarketArgs) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(args.close_ts > args.open_ts, KubraiError::BadSchedule);
        require!(args.close_ts > now, KubraiError::BadSchedule);
        require!(args.resolve_after_ts >= args.close_ts, KubraiError::BadSchedule);
        let c = &mut ctx.accounts.config;
        let m = &mut ctx.accounts.market;
        m.id = c.market_count;
        m.metric = args.metric;
        m.question_hash = args.question_hash;
        m.threshold = args.threshold;
        m.open_ts = args.open_ts;
        m.close_ts = args.close_ts;
        m.resolve_after_ts = args.resolve_after_ts;
        m.status = MarketStatus::Open as u8;
        m.vault = ctx.accounts.vault.key();
        m.bump = ctx.bumps.market;
        c.market_count = c.market_count.checked_add(1).unwrap();
        emit!(MarketCreated { market: m.key(), id: m.id, metric: m.metric, threshold: m.threshold, open_ts: m.open_ts, close_ts: m.close_ts });
        Ok(())
    }

    /// Anyone (normally the treasury) adds a fee-free prize to the pot.
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

    pub fn place_bet(ctx: Context<PlaceBet>, side: Side, amount: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let fee_bps = {
            let c = &ctx.accounts.config;
            let m = &ctx.accounts.market;
            require!(!c.paused, KubraiError::Paused);
            require!(m.status == MarketStatus::Open as u8, KubraiError::MarketNotOpen);
            require!(now >= m.open_ts, KubraiError::BettingNotStarted);
            require!(now < m.close_ts, KubraiError::BettingClosed);
            require!(amount >= c.min_bet, KubraiError::BelowMinBet);
            // Fee tier is decided now and locked into the position, stake-weighted.
            let mut fee_bps = c.fee_bps;
            if now < m.open_ts.saturating_add(c.early_bird_secs) {
                fee_bps = fee_bps.saturating_sub(c.early_bird_discount_bps);
            }
            // TODO(v1.1): SKR staking tier discount — read the staker account of the
            // SKR staking program (SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ) passed as
            // an optional remaining account; layout to be confirmed on mainnet.
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
        match side {
            Side::Yes => {
                p.yes_amount = p.yes_amount.checked_add(amount).unwrap();
                p.yes_fee_w = p.yes_fee_w.checked_add(fee_w).unwrap();
                m.pool_yes = m.pool_yes.checked_add(amount).unwrap();
            }
            Side::No => {
                p.no_amount = p.no_amount.checked_add(amount).unwrap();
                p.no_fee_w = p.no_fee_w.checked_add(fee_w).unwrap();
                m.pool_no = m.pool_no.checked_add(amount).unwrap();
            }
        }
        emit!(BetPlaced { market: m.key(), user: p.owner, side: side.code(), amount, fee_bps, pool_yes: m.pool_yes, pool_no: m.pool_no });
        Ok(())
    }

    /// Proposer publishes the outcome plus the hash of the snapshot bundle it
    /// derived it from. Starts the dispute window.
    pub fn propose_resolution(ctx: Context<Propose>, outcome: Side, observed_value: i64, snapshot_hash: [u8; 32]) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let m = &mut ctx.accounts.market;
        require!(m.status == MarketStatus::Open as u8, KubraiError::MarketNotOpen);
        require!(now >= m.resolve_after_ts, KubraiError::TooEarlyToResolve);
        m.status = MarketStatus::Proposed as u8;
        m.proposed_outcome = outcome.code();
        m.proposed_value = observed_value;
        m.proposed_at = now;
        m.snapshot_hash = snapshot_hash;
        emit!(ResolutionProposed { market: m.key(), outcome: outcome.code(), observed_value, snapshot_hash, proposed_at: now });
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
        emit!(MarketResolved { market: m.key(), outcome: m.outcome, voided: false });
        Ok(())
    }

    /// Admin escape hatch: every position is refunded in full, seed goes back to treasury.
    pub fn void_market(ctx: Context<AdminMarket>) -> Result<()> {
        let m = &mut ctx.accounts.market;
        require!(m.status == MarketStatus::Open as u8 || m.status == MarketStatus::Proposed as u8, KubraiError::AlreadyFinal);
        m.status = MarketStatus::Voided as u8;
        m.resolved_at = Clock::get()?.unix_timestamp;
        emit!(MarketResolved { market: m.key(), outcome: 0, voided: true });
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
    let refund_all = || Ok::<(u64, u64), Error>((p.yes_amount.checked_add(p.no_amount).unwrap(), 0));
    if m.status == MarketStatus::Voided as u8 {
        return refund_all();
    }
    let (win_pool, lose_pool, stake, fee_w) = if m.outcome == Side::Yes.code() {
        (m.pool_yes, m.pool_no, p.yes_amount, p.yes_fee_w)
    } else {
        (m.pool_no, m.pool_yes, p.no_amount, p.no_fee_w)
    };
    // Nobody on the winning side: everyone is made whole, house seed returns via sweep.
    if win_pool == 0 {
        return refund_all();
    }
    if stake == 0 {
        return Ok((0, 0));
    }
    let stake128 = stake as u128;
    let gross_share = (lose_pool as u128).checked_mul(stake128).unwrap() / win_pool as u128;
    // fee = gross_share * (fee_w / stake) / BPS, computed without intermediate truncation
    let fee = gross_share.checked_mul(fee_w).unwrap() / (stake128.checked_mul(BPS).unwrap());
    let seed_share = (m.seed_amount as u128).checked_mul(stake128).unwrap() / win_pool as u128;
    let payout = stake128 + gross_share - fee + seed_share;
    Ok((u64::try_from(payout).unwrap(), u64::try_from(fee).unwrap()))
}

// ---------- state ----------

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    Yes,
    No,
}
impl Side {
    /// Stored value; 0 is reserved for "no outcome".
    pub fn code(self) -> u8 {
        match self {
            Side::Yes => 1,
            Side::No => 2,
        }
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
pub struct MarketArgs {
    pub metric: [u8; 32],
    pub question_hash: [u8; 32],
    pub threshold: i64,
    pub open_ts: i64,
    pub close_ts: i64,
    pub resolve_after_ts: i64,
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
    pub threshold: i64,
    pub open_ts: i64,
    pub close_ts: i64,
    pub resolve_after_ts: i64,
    pub pool_yes: u64,
    pub pool_no: u64,
    pub seed_amount: u64,
    pub status: u8,
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
    pub yes_amount: u64,
    pub no_amount: u64,
    pub yes_fee_w: u128,
    pub no_fee_w: u128,
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
pub struct MarketCreated { pub market: Pubkey, pub id: u64, pub metric: [u8; 32], pub threshold: i64, pub open_ts: i64, pub close_ts: i64 }
#[event]
pub struct BetPlaced { pub market: Pubkey, pub user: Pubkey, pub side: u8, pub amount: u64, pub fee_bps: u16, pub pool_yes: u64, pub pool_no: u64 }
#[event]
pub struct ResolutionProposed { pub market: Pubkey, pub outcome: u8, pub observed_value: i64, pub snapshot_hash: [u8; 32], pub proposed_at: i64 }
#[event]
pub struct MarketResolved { pub market: Pubkey, pub outcome: u8, pub voided: bool }
#[event]
pub struct PositionSettled { pub market: Pubkey, pub user: Pubkey, pub payout: u64, pub fee: u64 }

#[error_code]
pub enum KubraiError {
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
}
