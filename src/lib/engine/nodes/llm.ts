import { NodeExecutionError, type NodeExecutor } from "../types";

/**
 * Placeholder. The real implementation — prompt templating, streaming, and the
 * Anthropic client — lands in the next step. Failing loudly here keeps a graph
 * containing a Model node from appearing to succeed.
 */
export const executeLlm: NodeExecutor = async () => {
  throw new NodeExecutionError(
    "Model nodes are not wired up yet — coming in the next step.",
  );
};
