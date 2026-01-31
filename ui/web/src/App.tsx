import React, { useMemo, useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { StepPanel } from "./components/StepPanel";
import { Stamp } from "./components/Stamp";
import {
  castVote,
  generateZkProof,
  submitProof,
  setDemoMode,
  setForceFailure,
  createConnection,
  type VoteContext,
} from "./lib/api";
import { useVoteSession } from "./hooks/useVoteSession";
import { DEFAULT_PROPOSAL_ID, VOTE_CHOICE_YES } from "./lib/constants";
import type { ProofData } from "./types";

type StepStatus = "idle" | "working" | "success" | "error";

type ForceFailureState = {
  cast: boolean;
  proof: boolean;
  submit: boolean;
};

const SAMPLE_PROPOSALS = [
  { id: "1", title: "Increase treasury allocation" },
  { id: "2", title: "Add new governance token" },
  { id: "42", title: "Launch community rewards program" },
  { id: "100", title: "Protocol upgrade v2.0" },
];

export default function App() {
  const wallet = useWallet();
  const { connection } = useConnection();
  const {
    session,
    setTransactionSignature,
    setProof: saveProof,
    setProposalId,
    clearSession
  } = useVoteSession();

  // Three-step state machine: cast -> prove -> submit.
  const [demoModeState, setDemoModeState] = useState(true);
  const [forceFailure, setForceFailureState] = useState<ForceFailureState>({
    cast: false,
    proof: false,
    submit: false,
  });
  const [step1, setStep1] = useState<StepStatus>("idle");
  const [step2, setStep2] = useState<StepStatus>("idle");
  const [step3, setStep3] = useState<StepStatus>("idle");
  const [proofData, setProofData] = useState<ProofData | null>(null);

  // Check if real mode is available (wallet connected)
  const realModeAvailable = wallet.connected && wallet.publicKey;

  // Derive final result banner based on step 3 outcome.
  const finalStamp = useMemo(() => {
    if (step3 === "success") {
      return { text: "YES vote accepted without revealing who voted.", variant: "success" as const };
    }
    if (step3 === "error") {
      return { text: "Proof rejected. No private information was revealed.", variant: "error" as const };
    }
    return { text: "Awaiting verification.", variant: "pending" as const };
  }, [step3]);

  function handleDemoModeToggle() {
    const next = !demoModeState;
    setDemoModeState(next);
    setDemoMode(next);
  }

  function handleForceFailureToggle(step: keyof ForceFailureState) {
    const next = { ...forceFailure, [step]: !forceFailure[step] };
    setForceFailureState(next);
    setForceFailure(step, next[step]);
  }

  async function handleCastVote() {
    setStep1("working");
    setStep2("idle");
    setStep3("idle");
    setProofData(null);
    try {
      const context: VoteContext = {
        wallet,
        connection,
        proposalId: session.proposalId,
        voteChoice: VOTE_CHOICE_YES, // Always YES
      };
      const signature = await castVote(context);
      setTransactionSignature(signature);
      setStep1("success");
    } catch (err) {
      console.error("Cast vote error:", err);
      setStep1("error");
    }
  }

  async function handleGenerateProof() {
    setStep2("working");
    setStep3("idle");
    try {
      const result = await generateZkProof(
        session.transactionSignature || "",
        session.proposalId,
        session.programId,
        VOTE_CHOICE_YES // Always YES
      );
      setProofData(result);
      saveProof(result);
      setStep2("success");
    } catch (err) {
      console.error("Generate proof error:", err);
      setStep2("error");
    }
  }

  async function handleSubmitProof() {
    setStep3("working");
    try {
      if (!proofData) {
        throw new Error("No proof data available");
      }
      const context: VoteContext = {
        wallet,
        connection,
        proposalId: session.proposalId,
      };
      await submitProof(proofData, context);
      setStep3("success");
    } catch (err) {
      console.error("Submit proof error:", err);
      setStep3("error");
    }
  }

  function resetDemo() {
    setStep1("idle");
    setStep2("idle");
    setStep3("idle");
    setProofData(null);
    clearSession();
  }

  function handleProposalChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setProposalId(e.target.value);
    // Reset workflow when proposal changes
    if (step1 !== "idle") {
      resetDemo();
    }
  }

  return (
    <div className="page">
      <header className="hero">
        <div>
          <p className="hero__tag">VeilProof</p>
          <h1 className="hero__title">A Private Proof of Vote on Solana</h1>
          <p className="hero__subtitle">Verify truth. Reveal nothing.</p>
        </div>
        <div className="hero__controls">
          <WalletMultiButton />
          <label className="toggle">
            <input type="checkbox" checked={demoModeState} onChange={handleDemoModeToggle} />
            <span>Demo Mode</span>
          </label>
          {!realModeAvailable && !demoModeState && (
            <span style={{ color: "#d97706", fontSize: "0.875rem" }}>
              ⚠️ Connect wallet for real mode
            </span>
          )}
          <button className="button" onClick={resetDemo}>Reset Demo</button>
        </div>
      </header>

      {/* Proposal Selection Panel */}
      <section className="panel panel--config">
        <header className="panel__header">
          <h2 className="panel__title">Select Proposal</h2>
        </header>
        <div className="config-single">
          <label className="config-label" htmlFor="proposal-select">
            Choose a proposal to vote YES on
          </label>
          <select
            id="proposal-select"
            className="config-select"
            value={session.proposalId}
            onChange={handleProposalChange}
            disabled={step1 === "working"}
          >
            {SAMPLE_PROPOSALS.map((proposal) => (
              <option key={proposal.id} value={proposal.id}>
                #{proposal.id} - {proposal.title}
              </option>
            ))}
          </select>
        </div>
      </section>

      <main className="grid">
        <StepPanel
          step={1}
          title="Cast Vote"
          helper={`Sends a YES vote transaction for proposal #${session.proposalId}. Identity is not used for verification.`}
          status={step1}
          buttonLabel="Cast YES Vote"
          onAction={handleCastVote}
          disabled={step1 === "working" || (!demoModeState && !realModeAvailable)}
        >
          {demoModeState && (
            <label className="toggle toggle--inline">
              <input
                type="checkbox"
                checked={forceFailure.cast}
                onChange={() => handleForceFailureToggle("cast")}
              />
              <span>Force Failure</span>
            </label>
          )}
        </StepPanel>

        <StepPanel
          step={2}
          title="Generate Proof"
          helper="Generates a Noir proof locally. No wallet or tx hash is disclosed."
          status={step2}
          buttonLabel="Generate Zero-Knowledge Proof"
          onAction={handleGenerateProof}
          disabled={step1 !== "success" || step2 === "working"}
        >
          {demoModeState && (
            <label className="toggle toggle--inline">
              <input
                type="checkbox"
                checked={forceFailure.proof}
                onChange={() => handleForceFailureToggle("proof")}
              />
              <span>Force Failure</span>
            </label>
          )}
        </StepPanel>

        <StepPanel
          step={3}
          title="Submit Proof"
          helper="Submits proof to the on-chain verifier. Only validity is learned."
          status={step3}
          buttonLabel="Submit Proof for Verification"
          onAction={handleSubmitProof}
          disabled={step2 !== "success" || step3 === "working"}
        >
          {demoModeState && (
            <label className="toggle toggle--inline">
              <input
                type="checkbox"
                checked={forceFailure.submit}
                onChange={() => handleForceFailureToggle("submit")}
              />
              <span>Force Failure</span>
            </label>
          )}
        </StepPanel>

        <section className="panel panel--result">
          <header className="panel__header">
            <h2 className="panel__title">Final Result</h2>
            <Stamp text={finalStamp.variant.toUpperCase()} variant={finalStamp.variant} size="lg" />
          </header>
          <p className="panel__helper">{finalStamp.text}</p>
          <div className="panel__note">
            <p>
              No wallet, transaction signature, or private inputs are shown or stored. The verifier only
              learns that a YES vote was proven for proposal #{session.proposalId}.
            </p>
            {session.transactionSignature && !demoModeState && (
              <p style={{ marginTop: "0.5rem", fontSize: "0.875rem", opacity: 0.7 }}>
                Tx: {session.transactionSignature.substring(0, 8)}...
              </p>
            )}
          </div>
        </section>
      </main>

      <footer className="footer">
        <span>VeilProof • Hackathon Prototype • Noir + Solana</span>
        <span className="footer__rule" />
      </footer>
    </div>
  );
}
