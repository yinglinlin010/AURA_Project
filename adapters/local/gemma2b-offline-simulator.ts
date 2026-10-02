import type { ActionProposalCandidate, LocalIntentModel } from "../../packages/core-runtime/src/intelligence-router.js";

/** Offline Gemma-2B seam simulation. It recognizes a small deterministic command set and performs no inference. */
export class Gemma2BOfflineSimulator implements LocalIntentModel {
  readonly modelName = "gemma-2b-simulated-deterministic-only";

  proposeDeterministicCommand(text: string): ActionProposalCandidate | undefined {
    const normalized = text.trim().toLowerCase();
    const volumeDirection = normalized.match(/\bvolume\s+(up|down)\b|\b(turn|make)\s+(it\s+)?(louder|quieter)\b/);
    if (volumeDirection) {
      const direction = volumeDirection[1] ?? (volumeDirection[4] === "louder" ? "up" : "down");
      return {
        kind: "CHANGE_CABIN_SETTING",
        summary: direction === "up" ? "Increase cabin audio volume" : "Decrease cabin audio volume",
        targetRole: "center",
        priority: "normal",
        requiresConsent: true,
        payload: { setting: "volume", direction },
      };
    }

    const setTemperature = normalized.match(/\b(?:set|make)\s+(?:the\s+)?(?:cabin\s+)?temperature\s+(?:to\s+)?(\d{1,2})(?:\s*°?\s*c)?\b/);
    if (setTemperature) {
      const temperatureCelsius = Number(setTemperature[1]);
      if (temperatureCelsius < 16 || temperatureCelsius > 30) return undefined;
      return {
        kind: "CHANGE_CABIN_SETTING",
        summary: `Set cabin temperature to ${temperatureCelsius} degrees`,
        targetRole: "center",
        priority: "normal",
        requiresConsent: true,
        payload: { setting: "temperature_celsius", value: temperatureCelsius },
      };
    }

    return undefined;
  }
}
