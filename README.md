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

## Roadmap

- [x] Application foundation — Next.js, TypeScript, Tailwind, tooling
- [x] Canvas — drag-and-drop board, node palette, connection validation
- [ ] Execution engine — DAG validation, topological execution, step streaming
- [ ] Model-backed nodes — prompt templating, streaming output
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
