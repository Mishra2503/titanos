-- CreateTable: async jobs for long-running MCP tool calls
CREATE TABLE "mcp_job" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "args" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "result" JSONB,
    "error" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mcp_job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mcp_job_workspace_id_created_at_idx" ON "mcp_job"("workspace_id", "created_at");
CREATE INDEX "mcp_job_status_created_at_idx" ON "mcp_job"("status", "created_at");

-- AddForeignKey
ALTER TABLE "mcp_job" ADD CONSTRAINT "mcp_job_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
