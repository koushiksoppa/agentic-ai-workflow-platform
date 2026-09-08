import { z } from "zod";
import type { NodeConfig, NodeKind, PortSpec } from "@/lib/types/workflow";
import { DEFAULT_MODEL, MODEL_OPTIONS } from "./models";
import {
  DEFAULT_TIMEOUT_MS,
  MAX_RETRIES,
  MAX_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
} from "./execution-config";

/**
 * Reliability settings shared by the nodes that perform I/O. Both are optional
 * so workflows saved before they existed remain valid.
 */
const reliabilitySchema = {
  timeoutMs: z
    .number()
    .int()
    .min(MIN_TIMEOUT_MS, `Minimum ${MIN_TIMEOUT_MS}ms`)
    .max(MAX_TIMEOUT_MS, `Maximum ${MAX_TIMEOUT_MS}ms`)
    .optional(),
  retries: z
    .number()
    .int()
    .min(0, "Cannot be negative")
    .max(MAX_RETRIES, `At most ${MAX_RETRIES}`)
    .optional(),
};

const RELIABILITY_FIELDS: FieldSpec[] = [
  {
    key: "timeoutMs",
    label: "Timeout (ms)",
    kind: "number",
    min: MIN_TIMEOUT_MS,
    max: MAX_TIMEOUT_MS,
    step: 1000,
    help: "Applies to the whole attempt.",
  },
  {
    key: "retries",
    label: "Retries",
    kind: "number",
    min: 0,
    max: MAX_RETRIES,
    step: 1,
    help: "Extra attempts after a transient failure. Deterministic errors are never retried.",
  },
];

export { MODEL_OPTIONS } from "./models";

export const EFFORT_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra high" },
  { value: "max", label: "Max" },
] as const;

/** Describes one editable config field so the inspector can render it generically. */
export type FieldSpec =
  | { key: string; label: string; kind: "text"; placeholder?: string; help?: string }
  | {
      key: string;
      label: string;
      kind: "textarea";
      rows?: number;
      mono?: boolean;
      placeholder?: string;
      help?: string;
    }
  | {
      key: string;
      label: string;
      kind: "select";
      options: readonly { value: string; label: string }[];
      help?: string;
    }
  | {
      key: string;
      label: string;
      kind: "number";
      min?: number;
      max?: number;
      step?: number;
      help?: string;
    };

export type NodeCategory = "Trigger" | "Model" | "Data" | "Logic" | "Output";

export interface NodeDefinition {
  kind: NodeKind;
  label: string;
  description: string;
  category: NodeCategory;
  /** Tailwind classes for the node card accent bar and palette dot. */
  accent: string;
  inputs: PortSpec[];
  outputs: PortSpec[];
  schema: z.ZodType;
  defaultConfig: NodeConfig;
  fields: FieldSpec[];
  /** One-line summary rendered on the node card body. */
  summary: (config: NodeConfig) => string;
}

const TEMPLATE_HELP = "Reference upstream results with {{nodeId.field}} - resolved at run time.";

const MODEL_VALUES = MODEL_OPTIONS.map((m) => m.value) as [string, ...string[]];
const EFFORT_VALUES = EFFORT_OPTIONS.map((e) => e.value) as [string, ...string[]];

export const NODE_DEFINITIONS: Record<NodeKind, NodeDefinition> = {
  input: {
    kind: "input",
    label: "Input",
    description: "Entry point. Supplies a starting value to the workflow.",
    category: "Trigger",
    accent: "bg-emerald-500",
    inputs: [],
    outputs: [{ id: "value", label: "Value", type: "text" }],
    schema: z.object({
      name: z.string().min(1, "Name is required"),
      value: z.string(),
    }),
    defaultConfig: { name: "input", value: "" },
    fields: [
      { key: "name", label: "Name", kind: "text", help: "Identifier for this input." },
      { key: "value", label: "Default value", kind: "textarea", rows: 4 },
    ],
    summary: (c) => String(c.name || "input"),
  },

  llm: {
    kind: "llm",
    label: "Model",
    description: "Sends a prompt to a language model and returns its response.",
    category: "Model",
    accent: "bg-violet-500",
    inputs: [{ id: "in", label: "Context", type: "any", multiple: true }],
    outputs: [{ id: "text", label: "Response", type: "text" }],
    schema: z.object({
      model: z.enum(MODEL_VALUES),
      system: z.string(),
      prompt: z.string().min(1, "Prompt is required"),
      maxTokens: z.number().int().min(1).max(128000),
      effort: z.enum(EFFORT_VALUES),
      ...reliabilitySchema,
    }),
    defaultConfig: {
      model: DEFAULT_MODEL,
      system: "",
      prompt: "",
      maxTokens: 16000,
      effort: "high",
      timeoutMs: 120000,
      retries: 1,
    },
    fields: [
      { key: "model", label: "Model", kind: "select", options: MODEL_OPTIONS },
      {
        key: "system",
        label: "System prompt",
        kind: "textarea",
        rows: 3,
        placeholder: "Optional. Sets the model's role and constraints.",
      },
      {
        key: "prompt",
        label: "Prompt",
        kind: "textarea",
        rows: 6,
        placeholder: "Summarize the following:\n\n{{input.value}}",
        help: TEMPLATE_HELP,
      },
      {
        key: "effort",
        label: "Effort",
        kind: "select",
        options: EFFORT_OPTIONS,
        help: "Higher effort means deeper reasoning and more tokens spent.",
      },
      {
        key: "maxTokens",
        label: "Max tokens",
        kind: "number",
        min: 1,
        max: 128000,
        step: 1000,
      },
      ...RELIABILITY_FIELDS,
    ],
    summary: (c) => String(c.model || DEFAULT_MODEL),
  },

  http: {
    kind: "http",
    label: "HTTP Request",
    description:
      "Calls an external endpoint and returns the parsed response. Requests to private and loopback addresses are blocked.",
    category: "Data",
    accent: "bg-sky-500",
    inputs: [{ id: "in", label: "Input", type: "any", multiple: true }],
    outputs: [{ id: "response", label: "Response", type: "json" }],
    schema: z.object({
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
      url: z.string().min(1, "URL is required"),
      headers: z.string(),
      body: z.string(),
      ...reliabilitySchema,
    }),
    defaultConfig: {
      method: "GET",
      url: "",
      headers: "{}",
      body: "",
      timeoutMs: DEFAULT_TIMEOUT_MS,
      retries: 2,
    },
    fields: [
      {
        key: "method",
        label: "Method",
        kind: "select",
        options: [
          { value: "GET", label: "GET" },
          { value: "POST", label: "POST" },
          { value: "PUT", label: "PUT" },
          { value: "PATCH", label: "PATCH" },
          { value: "DELETE", label: "DELETE" },
        ],
      },
      { key: "url", label: "URL", kind: "text", placeholder: "https://api.example.com/items" },
      { key: "headers", label: "Headers (JSON)", kind: "textarea", rows: 3, mono: true },
      { key: "body", label: "Body", kind: "textarea", rows: 4, mono: true, help: TEMPLATE_HELP },
      ...RELIABILITY_FIELDS,
    ],
    summary: (c) => `${String(c.method || "GET")} ${String(c.url || "not set")}`,
  },

  transform: {
    kind: "transform",
    label: "Transform",
    description: "Reshapes incoming data with a JavaScript expression.",
    category: "Data",
    accent: "bg-amber-500",
    inputs: [{ id: "in", label: "Input", type: "any", multiple: true }],
    outputs: [{ id: "out", label: "Output", type: "json" }],
    schema: z.object({ expression: z.string().min(1, "Expression is required") }),
    defaultConfig: { expression: "input" },
    fields: [
      {
        key: "expression",
        label: "Expression",
        kind: "textarea",
        rows: 5,
        mono: true,
        placeholder: "input.items.map(i => i.title)",
        help: "Evaluated with the incoming value bound to `input`.",
      },
    ],
    summary: (c) => String(c.expression || "input").slice(0, 40),
  },

  condition: {
    kind: "condition",
    label: "Condition",
    description: "Branches the workflow on a boolean expression.",
    category: "Logic",
    accent: "bg-rose-500",
    inputs: [{ id: "in", label: "Input", type: "any", multiple: true }],
    outputs: [
      { id: "true", label: "True", type: "any" },
      { id: "false", label: "False", type: "any" },
    ],
    schema: z.object({ expression: z.string().min(1, "Expression is required") }),
    defaultConfig: { expression: "input.length > 0" },
    fields: [
      {
        key: "expression",
        label: "Condition",
        kind: "textarea",
        rows: 3,
        mono: true,
        placeholder: "input.score > 0.8",
        help: "Evaluated with the incoming value bound to `input`. Must yield a boolean.",
      },
    ],
    summary: (c) => String(c.expression || "not set").slice(0, 40),
  },

  output: {
    kind: "output",
    label: "Output",
    description: "Terminal node. Captures a final result of the workflow.",
    category: "Output",
    accent: "bg-zinc-500",
    inputs: [{ id: "in", label: "Value", type: "any" }],
    outputs: [],
    schema: z.object({ name: z.string().min(1, "Name is required") }),
    defaultConfig: { name: "result" },
    fields: [{ key: "name", label: "Name", kind: "text" }],
    summary: (c) => String(c.name || "result"),
  },
};

export const NODE_LIST: NodeDefinition[] = Object.values(NODE_DEFINITIONS);

export function getDefinition(kind: NodeKind): NodeDefinition {
  return NODE_DEFINITIONS[kind];
}

/**
 * Resolves a handle id to its port spec. React Flow reports a null handle id
 * when a node has exactly one handle on that side, so fall back to the first.
 */
export function getPort(
  kind: NodeKind,
  direction: "inputs" | "outputs",
  portId: string | null | undefined,
): PortSpec | undefined {
  const ports = NODE_DEFINITIONS[kind][direction];
  if (!portId) return ports[0];
  return ports.find((p) => p.id === portId);
}
