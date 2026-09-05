# Agentic AI Workflow Platform

A visual builder for AI agent pipelines. Compose model calls, HTTP requests, data
transforms, and conditional branches as nodes on a drag-and-drop canvas, execute the
resulting graph, and inspect the input and output of every step.

## Status

Early development. The application foundation is in place; the canvas and execution
engine are actively being built. The roadmap below reflects what actually works today —
unchecked items are not implemented yet.

## Motivation

Agent pipelines are usually expressed in code and debugged through log output. That works
until a pipeline branches, retries, and fans out — at which point "which step produced this
garbage?" becomes genuinely hard to answer. This project takes the opposite approach: the
pipeline *is* the diagram, every node records what went in and what came out, and a failed
run is inspected by clicking the node that failed.

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router), React 19 |
| Language | TypeScript, strict mode |
| Styling | Tailwind CSS v4 |
| Canvas | React Flow (`@xyflow/react`) |
| State | Zustand |
| Validation | Zod |
| Tests | Vitest |
| Persistence | Prisma + SQLite |

SQLite is deliberate — the project runs with no database server, no containers, and no
setup beyond `npm install`.

## Getting started

Requires Node.js 20 or newer.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Then open http://localhost:3000.

## Configuration

Copy `.env.example` to `.env.local` and fill in:

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Required for model-backed nodes to execute |
| `DATABASE_URL` | SQLite connection string; defaults to `file:./dev.db` |

`.env.local` is gitignored and must never be committed.

## Project structure

```
src/
  app/            Routes; app/api/* holds the execution endpoints
  components/     Canvas, node components, inspector panels
  lib/
    engine/       DAG validation, executor, per-node runners
    store/        Zustand stores
    types/        Shared workflow, node, and run types
```

Node executors live one-per-file under `src/lib/engine/nodes/` and are registered in
`registry.ts`. Adding a node type means four things: a type definition, an executor, a
registry entry, and a canvas component.

## Model nodes

A Model node sends a prompt to Claude and returns the response text.

**Templating.** Prompts and system prompts resolve `{{...}}` references before
the request is sent:

- `{{input}}` — the value arriving on this node's incoming edges
- `{{node_id.field}}` — any field of any upstream node's result, e.g.
  `{{http_1.body.title}}`

An unresolvable reference fails the node rather than sending a prompt with a
hole in it.

**Models.** Parameters are gated per model, because the API rejects a request
carrying an option the model does not support:

| Model | Adaptive thinking | Effort |
|---|---|---|
| Claude Opus 5 (default) | yes | yes |
| Claude Sonnet 5 | yes | yes |
| Claude Haiku 4.5 | no | no |

**Streaming.** Responses stream, so partial text appears on the node while it
is still generating. Large `max_tokens` values would otherwise risk an HTTP
timeout on a single blocking request.

**Cost.** Model nodes spend real money on every run. `usage` (input and output
tokens) is returned with each result and shown in the inspector.

## Security model

Two nodes execute what the workflow tells them to, and both treat the workflow
definition as **trusted input**:

- **Transform** and **Condition** evaluate their expression with `new Function`.
  This is not a sandbox — an expression runs with the full privileges of the
  server process.
- **HTTP Request** will fetch whatever URL it is given, from the server.

That is fine while the only person who can author a workflow is the operator
running the app, which is the current single-user design. Before exposing
workflow authoring to untrusted or multi-tenant users, expression evaluation
must move behind a real sandbox (isolated-vm, QuickJS/WASM, or a subprocess
with a hard timeout) and the HTTP node needs egress restrictions to block
requests to internal addresses.

## Roadmap

- [x] Application foundation — Next.js, TypeScript, Tailwind, tooling
- [x] Canvas — drag-and-drop board, node palette, connection validation
- [x] Execution engine — DAG validation, topological execution, step streaming
- [x] Model-backed nodes — prompt templating, streaming output
- [ ] Persistence — saved workflows, run history, replay
- [ ] Run inspector — per-node input/output, error surfacing

## Scripts

```bash
npm run dev      # development server
npm run build    # production build
npm run lint     # eslint
npm test         # unit tests (vitest)
```

## License

MIT — see [LICENSE](LICENSE).
