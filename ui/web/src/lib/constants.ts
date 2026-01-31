import { PublicKey } from "@solana/web3.js";

// Solana Network Configuration
export const SOLANA_NETWORK = import.meta.env.VITE_SOLANA_NETWORK || "devnet";
export const SOLANA_RPC_URL =
  import.meta.env.VITE_SOLANA_RPC_URL || "https://api.devnet.solana.com";

// Program IDs (set by deployment script)
const voteProgramIdStr = import.meta.env.VITE_VOTE_PROGRAM_ID;
const verifierProgramIdStr = import.meta.env.VITE_VERIFIER_PROGRAM_ID;

export const VOTE_PROGRAM_ID = voteProgramIdStr
  ? new PublicKey(voteProgramIdStr)
  : undefined;

export const VERIFIER_PROGRAM_ID = verifierProgramIdStr
  ? new PublicKey(verifierProgramIdStr)
  : undefined;

// Verifier Service
export const VERIFIER_SERVICE_URL =
  import.meta.env.VITE_VERIFIER_SERVICE_URL || "http://127.0.0.1:8787";

// Default proposal ID for demo
export const DEFAULT_PROPOSAL_ID = "42";

// Vote choices
export const VOTE_CHOICE_YES = 1;
export const VOTE_CHOICE_NO = 0;
