-- AlterTable
ALTER TABLE "board_card" ADD COLUMN     "scripted_at" TIMESTAMP(3),
ADD COLUMN     "tags" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "competitor_post" ADD COLUMN     "tags" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "used_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "video_analysis" ADD COLUMN     "board_card_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "video_analysis_board_card_id_key" ON "video_analysis"("board_card_id");

-- AddForeignKey
ALTER TABLE "video_analysis" ADD CONSTRAINT "video_analysis_board_card_id_fkey" FOREIGN KEY ("board_card_id") REFERENCES "board_card"("id") ON DELETE CASCADE ON UPDATE CASCADE;
