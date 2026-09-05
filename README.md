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
cp .env.example .env
npx prisma migrate dev
npm run dev
```

Then open http://localhost:3000.

`prisma migrate dev` creates `prisma/dev.db` and generates the client. No
database server is involved.

For Model nodes, also create `.env.local` with your `ANTHROPIC_API_KEY` — see
Configuration below.

## Configuration

Copy `.env.example` to `.env.local` and fill in:

| Variable | File | Purpose |
|---|---|---|
| `DATABASE_URL` | `.env` | SQLite path. Read by the Prisma CLI *and* Next, so it cannot live in `.env.local`. |
| `ANTHROPIC_API_KEY` | `.env.local` | Required for Model nodes to execute. |

Both files are gitignored. Next reads env files only at startup, so restart the
dev server after changing either.

## Persistence

Workflows and their run history are stored in SQLite via Prisma.

Each run stores a **snapshot of the graph as executed**, separate from the
workflow's current definition. Editing or even deleting a workflow therefore
leaves its history intact and still openable — run history describes what
actually ran, not what the workflow says today.

| Table | Holds |
|---|---|
| `Workflow` | The current, editable definition |
| `Run` | One execution: status, timing, and the graph snapshot |
| `RunStep` | Per-node status, output, error, and duration |

Open the **Library** panel in the toolbar to browse saved workflows and recent
runs. Selecting a run restores its snapshot to the canvas with each node's
recorded result.

Every step records the value that arrived on its edges as well as what it
produced, so selecting a node after a run shows both its input and its output.

> After changing `prisma/schema.prisma`, run `npx prisma generate` **and
> restart the dev server**. The generated client is cached in the running
> process, so a schema change is otherwise silently ignored at runtime.

## Keyboard shortcuts

| Keys | Action |
|---|---|
| `Ctrl`/`Cmd` + `Enter` | Run the workflow |
| `Ctrl`/`Cmd` + `S` | Save the workflow |
| `Ctrl`/`Cmd` + `B` | Toggle the library panel |
| `Backspace` / `Delete` | Delete the selected node or edge |
| `Escape` | Deselect, or close an open panel |
| `?` | Show the shortcut list |

## Theming

Light, dark, and system, cycled from the toolbar and remembered per browser. An
inline script resolves the choice before first paint, so the page never flashes
the wrong theme; every `dark:` style keys off a single `data-theme` attribute
rather than `prefers-color-scheme`, which is what lets an explicit choice
override the OS setting.

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

## Conditional branching

A Condition node evaluates a boolean expression and activates exactly one of
its two outputs. The other branch is not executed — its nodes are reported as
skipped rather than run and discarded.

```
Input → Model → Condition ├── true  → Node A
                          └── false → Node B
```

The decision is recorded, not inferred. A Condition passes its input through
unchanged so downstream nodes are unaffected, and the branch it chose travels
separately as step metadata. Both the run history and the inspector therefore
show which way a run went and why a node was skipped:

> Skipped — "condition_1" took the true branch.

Graphs are validated as acyclic when edges are drawn and again before
execution, so a cycle cannot reach the executor even through an imported file.

## Configuration validation

Every node kind declares a schema covering its own settings. The same check
runs in three places, so they can never disagree:

- the inspector, marking the offending field as you type
- the toolbar lint, warning before a run starts
- the engine, which refuses to execute a node whose configuration is invalid

A node that fails validation reports the field by name — `Prompt: Prompt is
required` — rather than failing incidentally somewhere inside its executor.
Saving is deliberately permissive: a half-configured workflow can be stored and
returned to, it just cannot run.

## Security model

**Outbound requests.** The HTTP node runs on the server, so an unrestricted
one could reach anything the server can: loopback services, private LAN
addresses, and cloud instance metadata endpoints that hand out credentials.
Requests are therefore validated before they are sent:

- Loopback, private, link-local (including `169.254.169.254`), carrier-grade
  NAT, multicast and reserved ranges are refused, for both IPv4 and IPv6,
  including IPv4-mapped forms such as `::ffff:127.0.0.1`.
- Hostnames are resolved first, and rejected if *any* resolved address is
  private, so a split-horizon name cannot slip through on its public record.
- Redirects are followed manually and re-validated at every hop, since
  following them blindly would let a public URL bounce the server into the
  internal network.
- Credentials embedded in a URL are rejected, and query strings are stripped
  from error messages, because they routinely carry API keys.
- `set-cookie`, `authorization` and the `*-authenticate` response headers are
  dropped from node output, so session material cannot be fed into a prompt or
  a stored run record.
- Responses are capped at 1 MB and requests carry a configurable timeout
  (1–120s) covering the whole redirect chain.

Set `ALLOW_PRIVATE_NETWORK_REQUESTS=true` to lift the address restrictions when
developing against a service on localhost.

*Known limitation:* the resolved address is not pinned for the connection
itself, so DNS rebinding between the check and the request is not defeated.
Closing that requires dialling the validated IP through a custom agent.

**Expression evaluation.** Transform and Condition nodes evaluate their
expression with `new Function`. This is not a sandbox — an expression runs with
the privileges of the server process. That is acceptable while the only person
who can author a workflow is the operator running the app, which is the current
single-user design. Before exposing workflow authoring to untrusted or
multi-tenant users, expression evaluation must move behind a real sandbox
(isolated-vm, QuickJS/WASM, or a subprocess with a hard timeout).

**Secrets.** API keys live in `.env.local`, which is gitignored. They are never
returned by the API, written to a run record, or rendered in the UI.

## Roadmap

- [x] Application foundation — Next.js, TypeScript, Tailwind, tooling
- [x] Canvas — drag-and-drop board, node palette, connection validation
- [x] Execution engine — DAG validation, topological execution, step streaming
- [x] Model-backed nodes — prompt templating, streaming output
- [x] Persistence — saved workflows, run history, replay
- [x] Run inspector — per-node input/output, error surfacing

## Scripts

```bash
npm run dev      # development server
npm run build    # production build
npm run lint     # eslint
npm test         # unit tests (vitest)
```

## License

MIT — see [LICENSE](LICENSE).
