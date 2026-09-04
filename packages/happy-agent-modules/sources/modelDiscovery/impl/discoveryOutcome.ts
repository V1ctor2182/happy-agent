import type { DiscoveredAgentModel, DiscoveredModelSource } from "../../config/index.js";

/** What one vendor listing produced, kept apart from "could not ask" and "asked and failed". */
export type ModelDiscoveryOutcome =
    | {
          readonly status: "discovered";
          readonly source: DiscoveredModelSource;
          readonly models: readonly DiscoveredAgentModel[];
      }
    | { readonly status: "no-credentials" }
    | { readonly status: "failed"; readonly error: string };
