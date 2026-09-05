export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-6 font-sans dark:bg-zinc-950">
      <main className="w-full max-w-xl">
        <p className="font-mono text-xs uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
          Early development
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Agentic AI Workflow Platform
        </h1>
        <p className="mt-4 text-lg leading-8 text-zinc-600 dark:text-zinc-400">
          A visual builder for AI agent pipelines. Compose model calls, HTTP
          requests, transforms, and conditional branches on a canvas, run the
          graph, and inspect every step.
        </p>
        <p className="mt-8 text-sm text-zinc-500 dark:text-zinc-500">
          The workflow canvas is being built and will replace this page.
        </p>
      </main>
    </div>
  );
}
