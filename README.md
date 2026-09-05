# Agentic AI Workflow Platform

A visual builder for AI agent pipelines. Compose model calls, HTTP requests, data
transforms, and conditional branches as nodes on a canvas, execute the graph, and
inspect the input and output of every step.

Built with Next.js, TypeScript, React Flow, and Prisma. 216 tests.

## The problem

Agent pipelines are usually written in code and debugged through log output. That
works until a pipeline branches, retries, and calls external services — at which
point *"which step produced this garbage?"* becomes genuinely hard to answer.
Logs tell you what happened in the order it was printed, not which branch was
taken or what a node actually received.

This project inverts that. The pipeline **is** the diagram, every step records
what went in and what came out, and a failed run is diagnosed by clicking the
node that failed.

## Features

- **Visual editor** — drag-and-drop canvas with connection validation: no cycles,
  no type-incompatible edges, no over-subscribed inputs. Refusals explain
  themselves rather than silently dropping the connection.
- **Six node types** — Input, Model, HTTP Request, Transform, Condition, Output.
- **Conditional branching** — one branch executes, the other is reported as
  skipped, and the decision is recorded rather than inferred.
- **Streaming execution** — run events arrive over SSE, so node status and model
  output appear on the canvas while the run is still going.
- **Run history and replay** — every run stores a snapshot of the graph as it was
  executed, with per-step input, output, timing, and errors.
- **Reliability** — per-node timeouts, opt-in retries with exponential backoff,
  cancellation, and partial history preserved when a run fails.
- **Run inputs** — supply values for a run without editing the graph.
- **Light, dark, and system themes**, keyboard shortcuts, and a full run inspector.

## Architecture

```
src/
  app/
    api/run          Execution endpoint, streams run events as SSE
    api/workflows    CRUD for saved workflows
    api/runs         Run history
  components/canvas  Editor: canvas, palette, inspector, library, toolbar
  lib/
    engine           Execution: ordering, executors, templating, retries
      nodes/         One executor per node kind
    nodes/           Node definitions, schemas, capability tables
    graph/           Connection rules and whole-graph lint
    db/              Prisma data access
    net/             Outbound request validation
    store/           Client state and API clients
    types/           Shared types
```

Two boundaries hold the design together:

**Node definitions are the single source of truth.** `lib/nodes/definitions.ts`
declares each kind's ports, configuration schema, defaults, and editor fields.
The palette, node cards, inspector, graph lint, and engine all read from it, so
adding a node type means editing one definition and adding one executor — not
touching five components.

**Client and server code never blend.** `definitions.ts` is imported by React
components, so it must not reach anything using Node built-ins. Execution limits
therefore live in a dependency-free module (`lib/nodes/execution-config.ts`)
that both the editor and the executors can import.

## Workflow execution model

A workflow is a directed acyclic graph. Execution is:

1. **Ordered** — Kahn's algorithm produces a topological order. Cycles are
   rejected when an edge is drawn *and* re-checked before execution, since an
   imported file never passed through the editor.
2. **Validated** — each node's configuration is checked against its schema
   immediately before it runs. An invalid node fails by name (`Prompt: Prompt is
   required`) rather than throwing something incidental from inside an executor.
3. **Branch-aware** — an executor returns which output handles carry its result.
   A Condition activates exactly one, so the other branch is genuinely not
   executed. Its nodes report as skipped, with the reason naming the decision:
   *"condition_1" took the true branch.*
4. **Fault-isolating** — a failing node does not abort the run. Its descendants
   are skipped while independent branches still execute, and the run reports
   `error` at the end. One broken HTTP call cannot hide results the rest of the
   graph produced.
5. **Streamed** — the engine is an async generator yielding one event per state
   change (`node:start`, `node:delta`, `node:retry`, `node:success`,
   `node:error`, `node:skipped`, `run:finish`). The API serialises these to SSE
   and the client folds them into the canvas as they arrive.

### Reliability

Retries are opt-in per node and apply only to failures that could plausibly
succeed on another attempt. `NodeExecutionError` carries a `retryable` flag that
defaults to false: a bad prompt, an invalid URL, or a `400` fails identically
every time, and re-running a model call costs money. HTTP marks timeouts,
connection failures, `5xx` and `429` as retryable; the model node marks rate
limits, connection failures, and `5xx`.

Every node has a deadline enforced by the engine, and each attempt gets its own.
Cancellation propagates through in-flight requests, and a run always reaches a
terminal state — including when the client disconnects mid-stream.

*Limitation:* a timeout aborts I/O, but JavaScript cannot preempt synchronous
code. A Transform expression containing an infinite loop will still block.

## Persistence

SQLite via Prisma. No database server, no containers — `npm install` and a
migration is the whole setup.

| Table | Holds |
|---|---|
| `Workflow` | The current, editable definition |
| `Run` | One execution: status, timing, and a graph snapshot |
| `RunStep` | Per-node status, input, output, metadata, error, duration |

**Each run snapshots the graph it executed**, stored separately from the
workflow's current definition. Editing or even deleting a workflow therefore
leaves its history intact and still openable — run history describes what
actually ran, not what the workflow says today. Deleting a workflow nulls the
relation rather than cascading.

Run persistence is best-effort and isolated: a database failure is logged but
never breaks the stream or the run itself.

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router), React 19 |
| Language | TypeScript, strict mode |
| Styling | Tailwind CSS v4 |
| Canvas | React Flow (`@xyflow/react`) |
| State | Zustand |
| Validation | Zod |
| Persistence | Prisma 7 + SQLite |
| Model API | Anthropic SDK |
| Tests | Vitest |

## Example workflow

```
Input ──▶ Transform ──▶ Condition ─┬─ true ──▶ Output (long)
                                   └─ false ─▶ Output (short)
```

The Input supplies a value, the Transform normalises it, and the Condition routes
on its length. Only one Output executes; the other is recorded as skipped with
the reason.

Two examples are built into the empty state — one runs with no credentials, the
other demonstrates a model call and branching on its response.

## Screenshots

Screenshots live in `docs/`. Worth capturing: the canvas mid-run with status
rings and a branch badge, and the inspector showing a step's input and output.

## Local setup

Requires Node.js 20 or newer.

```bash
npm install
cp .env.example .env
npx prisma migrate dev
npm run dev
```

Open http://localhost:3000. `prisma migrate dev` creates `prisma/dev.db` and
generates the client.

To run Model nodes, add your key to `.env.local` and restart the dev server.

> After changing `prisma/schema.prisma`, run `npx prisma generate` **and restart
> the dev server**. The generated client is cached in the running process, so a
> schema change is otherwise ignored at runtime while type checking still passes.

## Environment variables

| Variable | File | Purpose |
|---|---|---|
| `DATABASE_URL` | `.env` | SQLite path. Read by the Prisma CLI *and* Next, so it cannot live in `.env.local`. |
| `ANTHROPIC_API_KEY` | `.env.local` | Required for Model nodes. |
| `ALLOW_PRIVATE_NETWORK_REQUESTS` | `.env.local` | Optional. Lets HTTP nodes reach localhost during development. |

Both files are gitignored. Next reads env files only at startup, so restart the
dev server after changing either. Keys are never returned by the API, written to
a run record, or rendered in the UI.

## Testing

```bash
npm test          # 216 tests
npm run test:watch
npm run lint
npm run build
```

Coverage focuses on behaviour that would be expensive to get wrong: DAG ordering
and cycle rejection, connection rules, template resolution, branch selection and
pruning, outbound request validation, retry and timeout semantics, cancellation,
the run-record lifecycle, and persistence round-trips. The Zustand store and
client modules are not directly unit-tested; they are exercised through the API
route and engine tests.

## Deployment

The app runs anywhere Node.js 20+ runs:

```bash
npm ci
npx prisma migrate deploy
npm run build
npm start
```

SQLite requires a persistent writable filesystem, so a platform with ephemeral
storage needs a mounted volume or a different datasource. Prisma's SQLite
provider can be swapped for PostgreSQL by changing the datasource and running a
migration — the data-access layer is isolated in `lib/db/`.

The run endpoint streams, so any proxy in front of it must not buffer responses.

## Security model

**Outbound requests.** The HTTP node runs on the server, so an unrestricted one
could reach anything the server can: loopback services, private LAN addresses,
and cloud instance metadata endpoints that hand out credentials. Requests are
validated before they are sent:

- Loopback, private, link-local (including `169.254.169.254`), carrier-grade NAT,
  multicast and reserved ranges are refused, for IPv4 and IPv6, including
  IPv4-mapped forms such as `::ffff:127.0.0.1`.
- Hostnames are resolved first and rejected if *any* resolved address is private,
  so a split-horizon name cannot slip through on its public record.
- Redirects are followed manually and re-validated at every hop; following them
  blindly would let a public URL bounce the server into the internal network.
- URL credentials are rejected, and query strings are stripped from error
  messages because they routinely carry API keys.
- `set-cookie`, `authorization` and the `*-authenticate` response headers are
  dropped from node output, so session material cannot be fed into a prompt or a
  stored run record.
- Responses are capped at 1 MB, with a configurable timeout covering the whole
  redirect chain.

*Known limitation:* the resolved address is not pinned for the connection, so DNS
rebinding between the check and the request is not defeated. Closing that
requires dialling the validated IP through a custom agent.

**Expression evaluation.** Transform and Condition nodes evaluate their
expression with `new Function`. This is not a sandbox — an expression runs with
the privileges of the server process. That is acceptable while the only person
who can author a workflow is the operator running the app, which is the current
single-user design. Multi-tenant use would require a real sandbox (isolated-vm,
QuickJS/WASM, or a subprocess with a hard timeout).

## Future improvements

- **Parallel execution** of independent branches; the engine currently runs the
  topological order sequentially.
- **Sandboxed expressions**, which is the prerequisite for multi-user authoring.
- **Loop and fan-out nodes** for iterating over collections.
- **Workflow versioning**, so a saved workflow keeps a history rather than only
  its latest state.
- **Authentication and per-user workspaces**, currently single-operator by design.
- **Postgres datasource** for deployments without persistent local storage.

## License

MIT — see [LICENSE](LICENSE).
