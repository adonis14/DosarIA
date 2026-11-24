import { DeterministicSummaryProvider } from "./deterministic";
import type { SummaryProvider } from "./types";

/**
 * The MVP always uses deterministic templates. `GatedLlmSummaryProvider`
 * exists as an interface for a later phase and refuses to construct without
 * the documented EU-processing and contractual prerequisites.
 */
export function getSummaryProvider(): SummaryProvider {
  return new DeterministicSummaryProvider();
}
