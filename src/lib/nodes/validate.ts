import { getDefinition } from "./definitions";
import type { NodeConfig, NodeKind } from "@/lib/types/workflow";

export interface ConfigIssue {
  /** Config key the issue belongs to, or "" when it applies to the whole node. */
  field: string;
  /** The field's editor label, for messages a user can act on. */
  label: string;
  message: string;
}

export type ConfigCheck = { ok: true } | { ok: false; issues: ConfigIssue[] };

/**
 * Validates a node's config against its own schema.
 *
 * The schemas already existed for the inspector; this makes them enforceable
 * anywhere — most importantly in the engine, so an invalid node fails with a
 * precise reason instead of throwing something incidental from deep inside an
 * executor, or silently running on defaults.
 */
export function validateNodeConfig(kind: NodeKind, config: NodeConfig): ConfigCheck {
  const definition = getDefinition(kind);
  const parsed = definition.schema.safeParse(config);
  if (parsed.success) return { ok: true };

  const labels = new Map(definition.fields.map((field) => [field.key, field.label]));
  const seen = new Set<string>();
  const issues: ConfigIssue[] = [];

  for (const issue of parsed.error.issues) {
    const field = String(issue.path[0] ?? "");
    // One issue per field keeps the message readable; the first is the useful one.
    if (seen.has(field)) continue;
    seen.add(field);
    issues.push({ field, label: labels.get(field) ?? field, message: issue.message });
  }

  return { ok: false, issues };
}

/** Flattens issues into one sentence for an error message or a lint entry. */
export function describeConfigIssues(issues: ConfigIssue[]): string {
  return issues
    .map((issue) => (issue.label ? `${issue.label}: ${issue.message}` : issue.message))
    .join("; ");
}
