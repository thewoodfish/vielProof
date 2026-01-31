import React from "react";

type StampVariant = "idle" | "pending" | "success" | "error";

interface StampProps {
  text: string;
  variant?: StampVariant;
  size?: "sm" | "md" | "lg";
}

// Stamp-like badge for status labels.
export function Stamp({ text, variant = "idle", size = "md" }: StampProps) {
  return (
    <span className={`stamp stamp--${variant} stamp--${size}`}>
      {text}
    </span>
  );
}
