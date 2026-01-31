import React from "react";
import { Stamp } from "./Stamp";

type StepStatus = "idle" | "working" | "success" | "error";

interface StepPanelProps {
  step: number;
  title: string;
  helper: string;
  status: StepStatus;
  buttonLabel: string;
  disabled?: boolean;
  onAction: () => void;
  children?: React.ReactNode;
}

// Map internal state to display label and stamp tone.
const statusMap: Record<StepStatus, { label: string; variant: "idle" | "pending" | "success" | "error" }> = {
  idle: { label: "Idle", variant: "idle" },
  working: { label: "Working", variant: "pending" },
  success: { label: "Success", variant: "success" },
  error: { label: "Failed", variant: "error" },
};

export function StepPanel({
  step,
  title,
  helper,
  status,
  buttonLabel,
  disabled,
  onAction,
  children,
}: StepPanelProps) {
  const statusDisplay = statusMap[status];

  return (
    <section className="panel">
      <header className="panel__header">
        <div>
          <div className="panel__step">Step {step}</div>
          <h2 className="panel__title">{title}</h2>
        </div>
        <Stamp text={statusDisplay.label.toUpperCase()} variant={statusDisplay.variant} />
      </header>
      <p className="panel__helper">{helper}</p>
      <div className="panel__actions">
        <button className="button button--primary" onClick={onAction} disabled={disabled || status === "working"}>
          {status === "working" ? "Processing..." : buttonLabel}
        </button>
        {children ? <div className="panel__extras">{children}</div> : null}
      </div>
      <div className="panel__status">
        <span>Status:</span>
        <span className="panel__status-value">{statusDisplay.label}</span>
      </div>
    </section>
  );
}
