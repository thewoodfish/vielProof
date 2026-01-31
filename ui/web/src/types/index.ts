export interface VoteSession {
  proposalId: string;
  programId: string;
  voteChoice: number; // 1 = YES, 0 = NO
  transactionSignature?: string;
  proof?: ProofData;
}

export interface ProofData {
  publicInputs: {
    expected_program_id: string;
    expected_proposal_id: string;
    raw: string;
  };
  proof: string;
  vkHash: string;
  meta?: {
    mock: boolean;
    note: string;
  };
}

export interface VerifierAttestation {
  ok: boolean;
  attestation: {
    scheme: string;
    signer_pubkey_hex: string;
    message_hash_hex: string;
    expected_program_id: string;
    expected_proposal_id: string;
    vk_hash_hex: string;
    proof_hash_hex: string;
    public_inputs_hash_hex: string;
  };
  signature_base64: string;
}

export type StepStatus = "idle" | "working" | "success" | "error";

export interface StepState {
  status: StepStatus;
  error?: string;
}
