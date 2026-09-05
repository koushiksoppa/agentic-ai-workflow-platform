@AGENTS.md

# Agentic AI Workflow Platform

Visual workflow builder for AI agent pipelines. Users compose LLM calls, HTTP requests,
transforms, and conditionals as nodes on a drag-and-drop canvas, execute the resulting
graph, and inspect each node's input/output.

## Stack

- **Next.js 16** (App Router) + **React 19** + TypeScript (strict)
- **Tailwind CSS v4**
- **@xyflow/react** — the canvas
- **Zustand** — graph + run state
- **@anthropic-ai/sdk** — LLM nodes
- **Prisma + SQLite** — persistence

> The target dev machine has **no Docker**. Do not introduce Postgres/Redis containers;
> keep persistence on SQLite unless the user explicitly asks to move off it.

## Layout

| Path | Holds |
|---|---|
| `src/app` | Routes. `src/app/api/*` are the execution endpoints. |
| `src/components` | Canvas, node components, side panels |
| `src/lib/engine` | DAG validation, executor, per-node runners |
| `src/lib/store` | Zustand stores |
| `src/lib/types` | Shared workflow / node / run types |

## Conventions

- One node executor per file in `src/lib/engine/nodes/`, registered in `registry.ts`.
  Adding a node type means: type def, executor, registry entry, canvas component.
- **Never call the Anthropic API from a client component.** All model traffic goes
  through the server routes under `src/app/api/`.
- Model IDs are exact strings — default `claude-opus-5`. Never append a date suffix.
- LLM nodes use adaptive thinking (`thinking: { type: "adaptive" }`) and stream
  their output; `budget_tokens` is rejected by current models.
- Run state flows one way: engine emits step events -> store -> UI. UI never mutates run results.

## Commands

```bash
npm run dev     # dev server
npm run build   # production build
npm run lint    # eslint
```
