import { evaluateExpression } from "../expression";
import type { NodeExecutor } from "../types";

/** Reshapes the incoming value with a JavaScript expression. */
export const executeTransform: NodeExecutor = async ({ config, input, outputs }) => {
  const expression = String(config.expression ?? "input");
  return { output: evaluateExpression(expression, input.value, outputs) };
};
