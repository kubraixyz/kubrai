// Devnet stand-in for the ORE program's Miner account, so the ORE-miner fee discount can be exercised where ORE is not
// deployed. Same layout as ORE's Miner (752 bytes: authority at byte 8, lifetime_deployed at byte 736) and the same PDA
// seeds (["miner", authority]), so the Kubrai clients use one code path on devnet and mainnet; only the program id differs.
// Anyone can register any authority (devnet only; the faucet does it for every wallet it funds). Never deployed to mainnet.
use anchor_lang::prelude::*;

declare_id!("7q9GeRXUv32MS8g6bz9eD8cbrTxXgbJou162bQK3fXiG");

#[program]
pub mod ore_miner_stub {
    use super::*;
    pub fn register(ctx: Context<Register>, authority: Pubkey) -> Result<()> {
        let m = &mut ctx.accounts.miner;
        m.authority = authority;
        m.lifetime_deployed = 1_000_000_000; // 1 SOL "ever deployed": clears any sane stake_min_amount
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(authority: Pubkey)]
pub struct Register<'info> {
    #[account(init_if_needed, payer = payer, space = 752, seeds = [b"miner", authority.as_ref()], bump)]
    pub miner: Account<'info, MinerStub>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// 8 (discriminator) + 32 + 696 + 8 + 8 = 752 bytes; field offsets match ORE's Miner.
#[account]
pub struct MinerStub {
    pub authority: Pubkey,      // @8
    pub pad: [u8; 696],         // @40
    pub lifetime_deployed: u64, // @736
    pub tail: u64,              // @744
}
