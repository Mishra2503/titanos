-- CreateTable
CREATE TABLE "workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'mvp',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "role" TEXT NOT NULL DEFAULT 'EDITOR',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "invite_token_hash" TEXT,
    "invite_expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ig_account" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "ig_user_id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "account_type" TEXT,
    "fb_page_id" TEXT,
    "access_token_enc" TEXT NOT NULL,
    "token_expires_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'CONNECTED',
    "followers_count" INTEGER,
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ig_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_column" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'slate',
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "board_column_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_card" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "column_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "emoji" TEXT,
    "status" TEXT,
    "platforms" JSONB NOT NULL DEFAULT '[]',
    "publish_date" TEXT,
    "hook" TEXT,
    "visual_hook" TEXT,
    "caption" TEXT,
    "hashtags" JSONB NOT NULL DEFAULT '[]',
    "reference_url" TEXT,
    "raw_footage_url" TEXT,
    "cover_image_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "board_card_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_asset" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "cloudinary_public_id" TEXT,
    "public_url" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "duration_s" DOUBLE PRECISION,
    "format" TEXT,
    "size_bytes" INTEGER,
    "uploaded_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "media_asset_id" TEXT NOT NULL,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'APPROVED',
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_post" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "ig_account_id" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "hashtags" JSONB NOT NULL DEFAULT '[]',
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "container_id" TEXT,
    "published_media_id" TEXT,
    "permalink" TEXT,
    "error" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "processing_started_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competitor" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "display_name" TEXT,
    "category" TEXT,
    "profile_url" TEXT,
    "avatar_url" TEXT,
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "competitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competitor_snapshot" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "competitor_id" TEXT NOT NULL,
    "captured_on" TIMESTAMP(3) NOT NULL,
    "followers_count" INTEGER,
    "following_count" INTEGER,
    "posts_count" INTEGER,
    "avg_likes" INTEGER,
    "avg_comments" INTEGER,
    "engagement_rate" DOUBLE PRECISION,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "competitor_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competitor_post" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "competitor_id" TEXT NOT NULL,
    "permalink" TEXT,
    "post_type" TEXT,
    "caption" TEXT,
    "hashtags" JSONB NOT NULL DEFAULT '[]',
    "likes" INTEGER,
    "comments" INTEGER,
    "views" INTEGER,
    "posted_on" TIMESTAMP(3),
    "thumbnail_url" TEXT,
    "what_works" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "competitor_post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competitor_report" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "competitor_id" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "model" TEXT,
    "generated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "competitor_report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_workspace_id_email_key" ON "user"("workspace_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "ig_account_workspace_id_ig_user_id_key" ON "ig_account"("workspace_id", "ig_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_post_idempotency_key_key" ON "scheduled_post"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "competitor_workspace_id_username_key" ON "competitor"("workspace_id", "username");

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ig_account" ADD CONSTRAINT "ig_account_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_column" ADD CONSTRAINT "board_column_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_card" ADD CONSTRAINT "board_card_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_card" ADD CONSTRAINT "board_card_column_id_fkey" FOREIGN KEY ("column_id") REFERENCES "board_column"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_post" ADD CONSTRAINT "scheduled_post_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_post" ADD CONSTRAINT "scheduled_post_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_post" ADD CONSTRAINT "scheduled_post_ig_account_id_fkey" FOREIGN KEY ("ig_account_id") REFERENCES "ig_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitor" ADD CONSTRAINT "competitor_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitor_snapshot" ADD CONSTRAINT "competitor_snapshot_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitor_snapshot" ADD CONSTRAINT "competitor_snapshot_competitor_id_fkey" FOREIGN KEY ("competitor_id") REFERENCES "competitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitor_post" ADD CONSTRAINT "competitor_post_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitor_post" ADD CONSTRAINT "competitor_post_competitor_id_fkey" FOREIGN KEY ("competitor_id") REFERENCES "competitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitor_report" ADD CONSTRAINT "competitor_report_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitor_report" ADD CONSTRAINT "competitor_report_competitor_id_fkey" FOREIGN KEY ("competitor_id") REFERENCES "competitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
