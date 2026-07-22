-- Add board_card_id to competitor_post so a reel can be pushed straight to the
-- Content Board as an idea card (lights the "On board" badge without a script).
ALTER TABLE "competitor_post" ADD COLUMN "board_card_id" TEXT;
