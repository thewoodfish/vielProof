import { useState, useEffect } from "react";
import type { VoteSession, ProofData } from "../types";

const SESSION_STORAGE_KEY = "veilproof_vote_session";

export function useVoteSession() {
  const [session, setSessionState] = useState<VoteSession>(() => {
    const stored = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        return {
          proposalId: parsed.proposalId || "42",
          programId: parsed.programId || "7",
          voteChoice: parsed.voteChoice ?? 1, // Default to YES
        };
      } catch {
        return {
          proposalId: "42",
          programId: "7",
          voteChoice: 1, // Default to YES
        };
      }
    }
    return {
      proposalId: "42",
      programId: "7",
      voteChoice: 1, // Default to YES
    };
  });

  useEffect(() => {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  }, [session]);

  const setTransactionSignature = (signature: string) => {
    setSessionState((prev) => ({
      ...prev,
      transactionSignature: signature,
    }));
  };

  const setProof = (proof: ProofData) => {
    setSessionState((prev) => ({
      ...prev,
      proof,
    }));
  };

  const setProposalId = (proposalId: string) => {
    setSessionState((prev) => ({
      ...prev,
      proposalId,
    }));
  };

  const clearSession = () => {
    const newSession: VoteSession = {
      proposalId: session.proposalId,
      programId: session.programId,
      voteChoice: session.voteChoice,
    };
    setSessionState(newSession);
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  };

  return {
    session,
    setTransactionSignature,
    setProof,
    setProposalId,
    clearSession,
  };
}
