import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";
import { VOTE_PROGRAM_ID, VERIFIER_PROGRAM_ID, VOTE_CHOICE_YES } from "./constants";

/**
 * Build instruction to vote on a proposal
 */
export function buildVoteInstruction(
  proposalId: string,
  userPublicKey: PublicKey
): TransactionInstruction {
  if (!VOTE_PROGRAM_ID) {
    throw new Error("VOTE_PROGRAM_ID not configured");
  }

  // Instruction data: proposal_id (8 bytes LE) + choice (1 byte)
  const data = Buffer.alloc(9);
  data.writeBigUInt64LE(BigInt(proposalId), 0);
  data.writeUInt8(VOTE_CHOICE_YES, 8);

  return new TransactionInstruction({
    keys: [],
    programId: VOTE_PROGRAM_ID,
    data,
  });
}

/**
 * Build Ed25519 signature verification instruction
 * This is required before the verifier program instruction
 */
export function buildEd25519Instruction(
  publicKey: Buffer,
  signature: Buffer,
  message: Buffer
): TransactionInstruction {
  const ED25519_PROGRAM_ID = new PublicKey(
    "Ed25519SigVerify111111111111111111111111111"
  );

  // Ed25519 instruction format
  const numSignatures = 1;
  const signatureOffset = 16;
  const publicKeyOffset = 80;
  const messageOffset = 112;
  const messageLength = message.length;

  const data = Buffer.alloc(16 + 64 + 32 + messageLength);

  // Header
  data.writeUInt8(numSignatures, 0);
  data.writeUInt8(0, 1); // padding

  // Offsets
  data.writeUInt16LE(signatureOffset, 2);
  data.writeUInt16LE(0xFFFF, 4); // instruction index
  data.writeUInt16LE(publicKeyOffset, 6);
  data.writeUInt16LE(0xFFFF, 8); // instruction index
  data.writeUInt16LE(messageOffset, 10);
  data.writeUInt16LE(messageLength, 12);
  data.writeUInt16LE(0xFFFF, 14); // instruction index

  // Data
  signature.copy(data, signatureOffset);
  publicKey.copy(data, publicKeyOffset);
  message.copy(data, messageOffset);

  return new TransactionInstruction({
    keys: [],
    programId: ED25519_PROGRAM_ID,
    data,
  });
}

/**
 * Build verifier program instruction with proof and attestation
 */
export function buildVerifierInstruction(
  proposalId: string,
  programId: string,
  vkHash: string,
  publicInputsHash: string,
  signature: string,
  proof: string,
  userPublicKey: PublicKey
): TransactionInstruction {
  if (!VERIFIER_PROGRAM_ID) {
    throw new Error("VERIFIER_PROGRAM_ID not configured");
  }

  // Convert hex strings to buffers
  const vkHashBuf = Buffer.from(vkHash, "hex");
  const publicInputsHashBuf = Buffer.from(publicInputsHash, "hex");
  const signatureBuf = Buffer.from(signature, "base64");
  const proofBuf = Buffer.from(proof, "base64");

  // Build instruction data
  const programIdLe = Buffer.alloc(8);
  programIdLe.writeBigUInt64LE(BigInt(programId));

  const proposalIdLe = Buffer.alloc(8);
  proposalIdLe.writeBigUInt64LE(BigInt(proposalId));

  const proofLen = Buffer.alloc(4);
  proofLen.writeUInt32LE(proofBuf.length);

  const data = Buffer.concat([
    programIdLe,      // 8 bytes
    proposalIdLe,     // 8 bytes
    vkHashBuf,        // 32 bytes
    publicInputsHashBuf, // 32 bytes
    signatureBuf,     // 64 bytes
    proofLen,         // 4 bytes
    proofBuf,         // variable length
  ]);

  // State account PDA (deterministic per proposal)
  const [stateAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("veilproof"), proposalIdLe],
    VERIFIER_PROGRAM_ID
  );

  return new TransactionInstruction({
    keys: [
      { pubkey: stateAccount, isSigner: false, isWritable: true },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
    ],
    programId: VERIFIER_PROGRAM_ID,
    data,
  });
}

/**
 * Send and confirm transaction with retries
 */
export async function sendAndConfirmTransaction(
  connection: Connection,
  transaction: Transaction,
  signTransaction: (tx: Transaction) => Promise<Transaction>
): Promise<string> {
  // Get recent blockhash
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = transaction.signatures[0].publicKey;

  // Sign transaction
  const signed = await signTransaction(transaction);

  // Send transaction
  const signature = await connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });

  // Confirm transaction
  await connection.confirmTransaction(
    {
      signature,
      blockhash,
      lastValidBlockHeight,
    },
    "confirmed"
  );

  return signature;
}
