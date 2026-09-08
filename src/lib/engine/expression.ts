import { NodeExecutionError } from "./types";

/**
 * Evaluates a user-authored JavaScript expression with `input` and `outputs`
 * in scope.
 *
 * SECURITY: this is `new Function`, not a sandbox. Workflow definitions are
 * therefore trusted input — they run with the full privileges of the server
 * process. That is acceptable while a workflow can only be authored by the
 * operator running the app, and it is the same trust model as the HTTP node,
 * which will fetch whatever URL it is given.
 *
 * Before exposing workflow authoring to untrusted or multi-tenant users, this
 * must move behind a real sandbox (isolated-vm, QuickJS/WASM, or a subprocess
 * with a hard timeout). See the security note in README.
 */
export function evaluateExpression(
  expression: string,
  input: unknown,
  outputs: Record<string, unknown>,
): unknown {
  let compiled: (input: unknown, outputs: Record<string, unknown>) => unknown;

  try {
    compiled = new Function("input", "outputs", `"use strict"; return (${expression});`) as (
      input: unknown,
      outputs: Record<string, unknown>,
    ) => unknown;
  } catch (error) {
    throw new NodeExecutionError(
      `Expression could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    return compiled(input, outputs);
  } catch (error) {
    throw new NodeExecutionError(
      `Expression threw: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
