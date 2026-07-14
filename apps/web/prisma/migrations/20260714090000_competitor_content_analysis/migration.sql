-- AlterTable: deep content-opportunity analysis on competitor_post
ALTER TABLE "competitor_post" ADD COLUMN     "content_analysis" JSONB;
ALTER TABLE "competitor_post" ADD COLUMN     "content_analyzed_at" TIMESTAMP(3);
