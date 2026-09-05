import type { NodeConfig, NodeKind, WorkflowDocument } from "@/lib/types/workflow";
import { getDefinition } from "./definitions";

export interface WorkflowExample {
  id: string;
  name: string;
  description: string;
  /** Whether running it needs ANTHROPIC_API_KEY configured. */
  requiresApiKey: boolean;
  build: () => WorkflowDocument;
}

function node(
  id: string,
  kind: NodeKind,
  config: NodeConfig,
  x: number,
  y: number,
) {
  return {
    id,
    type: "workflow",
    position: { x, y },
    data: {
      kind,
      label: getDefinition(kind).label,
      config: { ...getDefinition(kind).defaultConfig, ...config },
    },
  };
}

function edge(source: string, sourceHandle: string, target: string) {
  return { id: `${source}:${sourceHandle}->${target}`, source, target, sourceHandle, targetHandle: "in" };
}

export const EXAMPLES: WorkflowExample[] = [
  {
    id: "routing",
    name: "Length-based routing",
    description:
      "Normalises a value, branches on its length, and captures a different result on each path. Runs without any credentials.",
    requiresApiKey: false,
    build: () => ({
      version: 1,
      name: "Length-based routing",
      nodes: [
        node("input_1", "input", { name: "topic", value: "sea otters" }, 0, 80),
        node("transform_1", "transform", { expression: "input.value.trim().toUpperCase()" }, 280, 80),
        node("condition_1", "condition", { expression: "input.length > 8" }, 560, 80),
        node("output_1", "output", { name: "long" }, 840, 0),
        node("output_2", "output", { name: "short" }, 840, 180),
      ],
      edges: [
        edge("input_1", "value", "transform_1"),
        edge("transform_1", "out", "condition_1"),
        edge("condition_1", "true", "output_1"),
        edge("condition_1", "false", "output_2"),
      ],
    }),
  },
  {
    id: "summarize",
    name: "Summarise and classify",
    description:
      "Sends text to a model, then branches on whether the summary mentions a topic. Needs ANTHROPIC_API_KEY.",
    requiresApiKey: true,
    build: () => ({
      version: 1,
      name: "Summarise and classify",
      nodes: [
        node(
          "input_1",
          "input",
          {
            name: "article",
            value:
              "Sea otters wrap themselves in kelp so they do not drift while sleeping. They also keep a favourite rock in a pouch of loose skin under one arm.",
          },
          0,
          80,
        ),
        node(
          "llm_1",
          "llm",
          {
            system: "You write terse, factual summaries.",
            prompt: "Summarise the following in one sentence:\n\n{{input.value}}",
            maxTokens: 500,
            effort: "low",
          },
          280,
          80,
        ),
        node("condition_1", "condition", { expression: "input.text.includes('otter')" }, 560, 80),
        node("output_1", "output", { name: "aboutOtters" }, 840, 0),
        node("output_2", "output", { name: "somethingElse" }, 840, 180),
      ],
      edges: [
        edge("input_1", "value", "llm_1"),
        edge("llm_1", "text", "condition_1"),
        edge("condition_1", "true", "output_1"),
        edge("condition_1", "false", "output_2"),
      ],
    }),
  },
];
