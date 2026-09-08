import { NodeExecutionError } from "./types";

// `*` rather than `+` so an empty {{}} still matches and reports itself,
// instead of being silently left in the output as literal text.
const REFERENCE = /\{\{([^}]*)\}\}/g;

/** Walks a dotted path, returning undefined the moment the chain breaks. */
export function readPath(source: unknown, path: string[]): unknown {
  let current = source;
  for (const segment of path) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, null, 2);
}

/**
 * Substitutes {{nodeId}} and {{nodeId.path.to.field}} against the outputs
 * produced so far.
 *
 * An unresolvable reference throws rather than silently rendering an empty
 * string — a typo in a prompt is far cheaper to find here than in the model's
 * response.
 */
export function resolveTemplate(text: string, outputs: Record<string, unknown>): string {
  return text.replace(REFERENCE, (_match, expression: string) => {
    const trimmed = expression.trim();
    if (!trimmed) {
      throw new NodeExecutionError("Empty reference: {{}}");
    }

    const [nodeId, ...path] = trimmed.split(".").map((part) => part.trim());

    if (!(nodeId in outputs)) {
      const known = Object.keys(outputs);
      throw new NodeExecutionError(
        known.length > 0
          ? `Unknown reference "{{${trimmed}}}" — no result from "${nodeId}". Available: ${known.join(", ")}.`
          : `Unknown reference "{{${trimmed}}}" — no upstream node has produced a result yet.`,
      );
    }

    const value = path.length === 0 ? outputs[nodeId] : readPath(outputs[nodeId], path);

    if (value === undefined) {
      throw new NodeExecutionError(
        `Reference "{{${trimmed}}}" resolved to nothing — "${nodeId}" has no field "${path.join(".")}".`,
      );
    }

    return stringify(value);
  });
}

/** True when the text contains at least one {{...}} reference. */
export function hasReferences(text: string): boolean {
  REFERENCE.lastIndex = 0;
  return REFERENCE.test(text);
}

/**
 * Template scope for a node: every completed node's output, plus `input` bound
 * to this node's own incoming value.
 *
 * `input` cannot collide with a node id — ids are always suffixed (`input_1`),
 * so the bare name is free.
 */
export function scopeFor(
  outputs: Record<string, unknown>,
  inputValue: unknown,
): Record<string, unknown> {
  return inputValue === undefined ? outputs : { ...outputs, input: inputValue };
}
