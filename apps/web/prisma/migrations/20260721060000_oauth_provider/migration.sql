-- CreateTable: OAuth 2.1 authorization-server storage for MCP connector sign-in
CREATE TABLE "oauth_client" (
    "id" TEXT NOT NULL,
    "client_name" TEXT,
    "redirect_uris" TEXT[],
    "token_endpoint_auth_method" TEXT NOT NULL DEFAULT 'none',
    "client_secret_hash" TEXT,
    "grant_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_client_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "oauth_auth_code" (
    "id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "code_challenge" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_auth_code_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "oauth_refresh_token" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_refresh_token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "oauth_auth_code_code_hash_key" ON "oauth_auth_code"("code_hash");
CREATE INDEX "oauth_auth_code_client_id_idx" ON "oauth_auth_code"("client_id");
CREATE UNIQUE INDEX "oauth_refresh_token_token_hash_key" ON "oauth_refresh_token"("token_hash");
CREATE INDEX "oauth_refresh_token_client_id_idx" ON "oauth_refresh_token"("client_id");
CREATE INDEX "oauth_refresh_token_user_id_idx" ON "oauth_refresh_token"("user_id");
