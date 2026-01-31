import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { WalletContextState } from "@solana/wallet-adapter-react";
import {
  buildVoteInstruction,
  buildEd25519Instruction,
  buildVerifierInstruction,
  sendAndConfirmTransaction,
} from "./solana";
import {
  SOLANA_RPC_URL,
  VERIFIER_SERVICE_URL,
  VOTE_PROGRAM_ID,
  DEFAULT_PROPOSAL_ID,
} from "./constants";
import type { ProofData, VerifierAttestation } from "../types";

// Demo mode is the default for hackathon flow; real mode is a stub for later wiring.
let demoMode = true;
const forceFailure = {
  cast: false,
  proof: false,
  submit: false,
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomLatency() {
  return 800 + Math.floor(Math.random() * 700);
}

export function setDemoMode(enabled: boolean) {
  demoMode = enabled;
}

export function setForceFailure(step: "cast" | "proof" | "submit", enabled: boolean) {
  forceFailure[step] = enabled;
}

// ============================================================================
// Real Mode API Functions
// ============================================================================

export interface VoteContext {
  wallet: WalletContextState;
  connection: Connection;
  proposalId: string;
  voteChoice?: number; // 1 = YES, 0 = NO
}

/**
 * Cast a vote on a proposal
 * @returns Transaction signature
 */
export async function castVote(context: VoteContext): Promise<string> {
  const voteChoice = context.voteChoice ?? 1; // Default to YES
  if (demoMode) {
    await sleep(randomLatency());
    if (forceFailure.cast) {
      throw new Error("Vote transaction failed");
    }
    return "demo_tx_signature_" + Math.random().toString(36).substring(7);
  }

  const { wallet, connection, proposalId } = context;

  // Note: For now, the Noir circuit only supports YES votes (vote_choice == 1)
  // To support NO votes, the circuit would need to be updated

  if (!wallet.publicKey) {
    throw new Error("Wallet not connected");
  }

  if (!wallet.signTransaction) {
    throw new Error("Wallet does not support signing");
  }

  if (!VOTE_PROGRAM_ID) {
    throw new Error("Vote program not deployed");
  }

  // Build vote instruction
  const instruction = buildVoteInstruction(proposalId, wallet.publicKey);

  // Create transaction
  const transaction = new Transaction().add(instruction);

  // Send and confirm
  const signature = await sendAndConfirmTransaction(
    connection,
    transaction,
    wallet.signTransaction,
    wallet.publicKey
  );

  return signature;
}

/**
 * Generate ZK proof from a vote transaction
 * @param transactionSignature - The vote transaction signature
 * @param proposalId - Proposal ID
 * @param programId - Program ID
 * @param voteChoice - Vote choice (1 = YES, 0 = NO)
 * @returns Proof data
 */
export async function generateZkProof(
  transactionSignature: string,
  proposalId: string,
  programId: string,
  voteChoice: number = 1
): Promise<ProofData> {
  if (demoMode) {
    await sleep(randomLatency());
    if (forceFailure.proof) {
      throw new Error("Proof generation failed");
    }
    // Placeholder base64 string; replace with real proof bytes later.
    return {
      publicInputs: {
        expected_program_id: programId,
        expected_proposal_id: proposalId,
        raw: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKg==",
      },
      proof: "dmVpbHByb29mX2R1bW15X2Jhc2U2NA==",
      vkHash: "21aad3031ddace2afb225e198b8b807b9384e8dc8f59903a71da07cbf28724f1",
      meta: {
        mock: true,
        note: "Demo mode proof",
      },
    };
  }

  // Call verifier service /generate-proof endpoint
  const response = await fetch(`${VERIFIER_SERVICE_URL}/generate-proof`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      proposal_id: proposalId,
      program_id: programId,
      vote_choice: voteChoice,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Proof generation failed");
  }

  const data = await response.json();
  return data.proof;
}

/**
 * Submit proof to blockchain via verifier program
 * @param proof - The proof data
 * @param context - Wallet and connection context
 * @returns Transaction signature
 */
export async function submitProof(
  proof: ProofData,
  context: VoteContext
): Promise<string> {
  if (demoMode) {
    await sleep(randomLatency());
    if (forceFailure.submit) {
      throw new Error("Proof submission failed");
    }
    return "demo_verify_tx_" + Math.random().toString(36).substring(7);
  }

  const { wallet, connection, proposalId } = context;

  if (!wallet.publicKey) {
    throw new Error("Wallet not connected");
  }

  if (!wallet.signTransaction) {
    throw new Error("Wallet does not support signing");
  }

  // Step 1: Get signed attestation from verifier service
  const verifyResponse = await fetch(`${VERIFIER_SERVICE_URL}/verify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      proof_bytes_base64: proof.proof,
      public_inputs_json: proof.publicInputs,
      vk_hash_hex: proof.vkHash,
      expected_program_id: proof.publicInputs.expected_program_id,
      expected_proposal_id: proof.publicInputs.expected_proposal_id,
    }),
  });

  if (!verifyResponse.ok) {
    const error = await verifyResponse.json();
    throw new Error(error.error || "Proof verification failed");
  }

  const attestation: VerifierAttestation = await verifyResponse.json();

  // Step 2: Build Ed25519 instruction for signature verification
  const signerPubkey = Buffer.from(attestation.attestation.signer_pubkey_hex, "hex");
  const signature = Buffer.from(attestation.signature_base64, "base64");
  const messageHash = Buffer.from(attestation.attestation.message_hash_hex, "hex");

  const ed25519Ix = buildEd25519Instruction(signerPubkey, signature, messageHash);

  // Step 3: Build verifier program instruction
  // Note: We only send attestation data, not the full proof (too large for Solana tx)
  const verifierIx = buildVerifierInstruction(
    proposalId,
    proof.publicInputs.expected_program_id,
    attestation.attestation.vk_hash_hex,
    attestation.attestation.public_inputs_hash_hex,
    attestation.signature_base64,
    "", // Empty proof - not needed on-chain, verified off-chain
    wallet.publicKey
  );

  // Step 4: Create and send transaction with both instructions
  const transaction = new Transaction();
  transaction.add(ed25519Ix);
  transaction.add(verifierIx);

  const txSignature = await sendAndConfirmTransaction(
    connection,
    transaction,
    wallet.signTransaction,
    wallet.publicKey
  );

  return txSignature;
}

// ============================================================================
// Helper function to create connection
// ============================================================================

export function createConnection(): Connection {
  return new Connection(SOLANA_RPC_URL, "confirmed");
}
