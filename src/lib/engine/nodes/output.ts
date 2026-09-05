import type { NodeExecutor } from "../types";

/** Terminal node. Captures whatever reached it under a named key. */
export const executeOutput: NodeExecutor = async ({ config, input }) => {
  return { output: { name: String(config.name ?? "result"), value: input.value } };
};
