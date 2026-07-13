-- AlterTable
ALTER TABLE "competitor_post" ADD COLUMN     "video_url" TEXT;

-- CreateTable
CREATE TABLE "video_analysis" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "competitor_post_id" TEXT,
    "ig_media_id" TEXT,
    "ig_account_id" TEXT,
    "video_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "processing_started_at" TIMESTAMP(3),
    "error" TEXT,
    "model" TEXT,
    "duration_s" DOUBLE PRECISION,
    "transcript" TEXT,
    "analysis" JSONB,
    "summary" TEXT,
    "analyzed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_analysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "video_analysis_competitor_post_id_key" ON "video_analysis"("competitor_post_id");

-- CreateIndex
CREATE INDEX "video_analysis_status_created_at_idx" ON "video_analysis"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "video_analysis_workspace_id_ig_media_id_key" ON "video_analysis"("workspace_id", "ig_media_id");

-- AddForeignKey
ALTER TABLE "video_analysis" ADD CONSTRAINT "video_analysis_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_analysis" ADD CONSTRAINT "video_analysis_competitor_post_id_fkey" FOREIGN KEY ("competitor_post_id") REFERENCES "competitor_post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
