-- CreateTable
CREATE TABLE "Workflow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "document" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workflowId" TEXT,
    "workflowName" TEXT NOT NULL,
    "document" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "durationMs" INTEGER,
    CONSTRAINT "Run_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RunStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "nodeKind" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "output" TEXT,
    "error" TEXT,
    "durationMs" INTEGER,
    CONSTRAINT "RunStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Workflow_updatedAt_idx" ON "Workflow"("updatedAt");

-- CreateIndex
CREATE INDEX "Run_startedAt_idx" ON "Run"("startedAt");

-- CreateIndex
CREATE INDEX "Run_workflowId_idx" ON "Run"("workflowId");

-- CreateIndex
CREATE INDEX "RunStep_runId_position_idx" ON "RunStep"("runId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "RunStep_runId_nodeId_key" ON "RunStep"("runId", "nodeId");
