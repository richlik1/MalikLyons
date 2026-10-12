// Bump CONSENT_VERSION whenever the text changes; each photo stores the version accepted.
export const CONSENT_VERSION = "2026-10-12.v1";

export const CONSENT_POINTS = [
  "My photo is used only to generate try-on previews that I request.",
  "It is sent to our AI provider for processing and is not used by TrendSet to train models.",
  "It is stored privately and deleted automatically after the retention period, or immediately when I delete it.",
  "I am 18 or older and this is a photo of me.",
] as const;

export const FIT_DISCLAIMER =
  "AI-generated preview for visual reference only. It does not show accurate sizing or guarantee fit.";
