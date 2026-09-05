import { resolveTemplate } from "../template";
import type { NodeExecutor } from "../types";

/**
 * Entry point. Emits its configured value; the run may override it by name
 * through the run request's `inputs` map.
 */
export const executeInput: NodeExecutor = async ({ config, outputs }) => {
  const name = String(config.name ?? "input");
  const raw = String(config.value ?? "");
  return { output: { name, value: resolveTemplate(raw, outputs) } };
};
