-- CreateTable: persisted scripts (Scriptwriter tab)
CREATE TABLE "script" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "competitor_id" TEXT,
    "competitor_post_id" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "source_reel" JSONB,
    "research" JSONB,
    "hook" TEXT,
    "body" TEXT NOT NULL DEFAULT '',
    "caption" TEXT,
    "hashtags" JSONB NOT NULL DEFAULT '[]',
    "model" TEXT,
    "board_card_id" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "script_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "script_workspace_id_status_idx" ON "script"("workspace_id", "status");

-- AddForeignKey
ALTER TABLE "script" ADD CONSTRAINT "script_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
