import { evaluateExpression } from "../expression";
import { NodeExecutionError, type NodeExecutor } from "../types";

/**
 * Branches the run. The incoming value passes through unchanged, but only one
 * output handle is activated, so the executor skips the other branch.
 */
export const executeCondition: NodeExecutor = async ({ config, input, outputs }) => {
  const expression = String(config.expression ?? "");
  const result = evaluateExpression(expression, input.value, outputs);

  if (typeof result !== "boolean") {
    throw new NodeExecutionError(
      `Condition must evaluate to true or false, got ${typeof result}.`,
    );
  }

  return { output: input.value, activeHandles: [result ? "true" : "false"] };
};
