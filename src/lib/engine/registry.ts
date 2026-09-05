import type { NodeKind } from "@/lib/types/workflow";
import type { NodeExecutor } from "./types";
import { executeInput } from "./nodes/input";
import { executeLlm } from "./nodes/llm";
import { executeHttp } from "./nodes/http";
import { executeTransform } from "./nodes/transform";
import { executeCondition } from "./nodes/condition";
import { executeOutput } from "./nodes/output";

/**
 * Every node kind maps to exactly one executor. Adding a kind means adding a
 * file under ./nodes and an entry here; the Record type makes a missing one a
 * compile error rather than a runtime surprise.
 */
export const EXECUTORS: Record<NodeKind, NodeExecutor> = {
  input: executeInput,
  llm: executeLlm,
  http: executeHttp,
  transform: executeTransform,
  condition: executeCondition,
  output: executeOutput,
};

export function getExecutor(kind: NodeKind): NodeExecutor {
  return EXECUTORS[kind];
}
