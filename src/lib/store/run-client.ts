import type { RunEvent } from "@/lib/engine/types";
import { useWorkflowStore } from "./workflow-store";

/**
 * Splits an SSE byte stream into decoded `data:` payloads. Chunk boundaries
 * fall wherever the network puts them, so partial frames are held back until
 * the terminating blank line arrives.
 */
async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<RunEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        const payload = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("");

        if (payload) {
          try {
            yield JSON.parse(payload) as RunEvent;
          } catch {
            // A frame we cannot parse is not worth aborting the run over.
          }
        }

        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Executes the current workflow, folding each streamed event into the store so
 * node cards update while the run is still in flight.
 */
export async function runWorkflow(signal?: AbortSignal): Promise<void> {
  const store = useWorkflowStore.getState();
  store.beginRun();

  let response: Response;
  try {
    response = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflow: store.toDocument(),
        // Links the run record to the saved workflow, when one is open.
        workflowId: store.workflowId,
        // Only names the user edited; the rest use their node's own value.
        inputs: store.inputValues,
      }),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) {
      useWorkflowStore.setState({ runPhase: "cancelled" });
      return;
    }
    store.failRun(error instanceof Error ? error.message : String(error));
    return;
  }

  if (!response.ok || !response.body) {
    let detail = `Server responded ${response.status}.`;
    try {
      const problem = (await response.json()) as { error?: string };
      if (problem.error) detail = problem.error;
    } catch {
      // Non-JSON error body; the status line is all we have.
    }
    store.failRun(detail);
    return;
  }

  try {
    for await (const event of readEvents(response.body)) {
      useWorkflowStore.getState().applyRunEvent(event);
    }
  } catch (error) {
    if (signal?.aborted) {
      useWorkflowStore.setState({ runPhase: "cancelled" });
      return;
    }
    useWorkflowStore.getState().failRun(error instanceof Error ? error.message : String(error));
  }
}
