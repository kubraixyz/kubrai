// Devnet stand-in for the Seeker Genesis Token: a Token-2022 group mint plus one soulbound-ish member token per wallet.
//   ANCHOR_PROVIDER_URL=... ANCHOR_WALLET=... node scripts/devnet-sgt-mock.mjs create                -> prints the group mint (save it)
//   ... node scripts/devnet-sgt-mock.mjs mint <groupMint> <wallet> [<wallet>...]                     -> one member token per wallet
import anchor from "@coral-xyz/anchor";
import { createInitializeGroupInstruction, createInitializeMemberInstruction } from "@solana/spl-token-group";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, ExtensionType, getMintLen, createInitializeMintInstruction, createInitializeGroupPointerInstruction, createInitializeGroupMemberPointerInstruction, createInitializeNonTransferableMintInstruction, getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction, createSetAuthorityInstruction, AuthorityType, TOKEN_GROUP_SIZE, TOKEN_GROUP_MEMBER_SIZE, TYPE_SIZE, LENGTH_SIZE } from "@solana/spl-token";
const provider = anchor.AnchorProvider.env(); const conn = provider.connection; const payer = provider.wallet.payer;
const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "create") {
  const group = Keypair.generate();
  const mintLen = getMintLen([ExtensionType.GroupPointer]); const space = mintLen + TYPE_SIZE + LENGTH_SIZE + TOKEN_GROUP_SIZE;
  const lamports = await conn.getMinimumBalanceForRentExemption(space);
  const tx = new Transaction().add(
    SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: group.publicKey, space: mintLen, lamports, programId: TOKEN_2022_PROGRAM_ID }),
    createInitializeGroupPointerInstruction(group.publicKey, payer.publicKey, group.publicKey, TOKEN_2022_PROGRAM_ID),
    createInitializeMintInstruction(group.publicKey, 0, payer.publicKey, null, TOKEN_2022_PROGRAM_ID),
    createInitializeGroupInstruction({ programId: TOKEN_2022_PROGRAM_ID, group: group.publicKey, mint: group.publicKey, mintAuthority: payer.publicKey, updateAuthority: payer.publicKey, maxSize: BigInt(1_000_000) }),
  );
  const sig = await provider.sendAndConfirm(tx, [group]);
  console.log(JSON.stringify({ groupMint: group.publicKey.toBase58(), authority: payer.publicKey.toBase58(), signature: sig }));
} else if (cmd === "mint") {
  const [groupStr, ...wallets] = rest; const group = new PublicKey(groupStr);
  for (const w of wallets) {
    const owner = new PublicKey(w); const member = Keypair.generate();
    const mintLen = getMintLen([ExtensionType.GroupMemberPointer, ExtensionType.NonTransferable]); const space = mintLen + TYPE_SIZE + LENGTH_SIZE + TOKEN_GROUP_MEMBER_SIZE;
    const lamports = await conn.getMinimumBalanceForRentExemption(space);
    const ata = getAssociatedTokenAddressSync(member.publicKey, owner, true, TOKEN_2022_PROGRAM_ID);
    const tx = new Transaction().add(
      SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: member.publicKey, space: mintLen, lamports, programId: TOKEN_2022_PROGRAM_ID }),
      createInitializeGroupMemberPointerInstruction(member.publicKey, payer.publicKey, member.publicKey, TOKEN_2022_PROGRAM_ID),
      createInitializeNonTransferableMintInstruction(member.publicKey, TOKEN_2022_PROGRAM_ID),
      createInitializeMintInstruction(member.publicKey, 0, payer.publicKey, null, TOKEN_2022_PROGRAM_ID),
      createInitializeMemberInstruction({ programId: TOKEN_2022_PROGRAM_ID, member: member.publicKey, memberMint: member.publicKey, memberMintAuthority: payer.publicKey, group, groupUpdateAuthority: payer.publicKey }),
      createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata, owner, member.publicKey, TOKEN_2022_PROGRAM_ID),
      createMintToInstruction(member.publicKey, ata, payer.publicKey, 1, [], TOKEN_2022_PROGRAM_ID),
      createSetAuthorityInstruction(member.publicKey, payer.publicKey, AuthorityType.MintTokens, null, [], TOKEN_2022_PROGRAM_ID),
    );
    const sig = await provider.sendAndConfirm(tx, [member]);
    console.log(JSON.stringify({ wallet: w, memberMint: member.publicKey.toBase58(), tokenAccount: ata.toBase58(), signature: sig }));
  }
} else { console.error("usage: create | mint <groupMint> <wallet>..."); process.exit(2); }
