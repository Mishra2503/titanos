from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Central, typed application settings. Loaded once from env (Rail #2: secrets server-side)."""

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore", case_sensitive=False
    )

    environment: Literal["development", "staging", "production"] = "development"
    api_base_url: str = "http://localhost:8000"
    web_base_url: str = "http://localhost:3000"
    cors_origins: str = "http://localhost:3000"

    database_url: str = "postgresql+asyncpg://titan:titan_dev_password@localhost:5432/titan"
    redis_url: str = "redis://localhost:6379/0"

    jwt_secret: str = "change_me"
    jwt_algorithm: str = "HS256"
    access_token_ttl_minutes: int = 30
    refresh_token_ttl_days: int = 30
    fernet_key: str = ""

    instagram_app_id: str = ""
    instagram_app_secret: str = ""
    instagram_redirect_uri: str = "http://localhost:8000/api/connections/oauth/callback"
    instagram_graph_version: str = "v21.0"
    max_connections_per_workspace: int = 10

    anthropic_api_key: str = ""
    anthropic_model: str = "claude-opus-4-7"
    anthropic_monthly_token_budget: int = 2_000_000

    # --- AWS Bedrock (alternative auth path to Claude) ---
    # When bedrock_api_key is set we route AI calls through Bedrock instead of the
    # Anthropic API directly. Set AWS_BEARER_TOKEN_BEDROCK at process start.
    bedrock_api_key: str = ""
    bedrock_aws_region: str = "us-east-1"
    bedrock_model: str = "us.anthropic.claude-haiku-4-5-20251001-v1:0"

    cloudinary_cloud_name: str = ""
    cloudinary_api_key: str = ""
    cloudinary_api_secret: str = ""
    cloudinary_signed_url_ttl: int = 86_400

    # 'real' actually calls Meta media_publish; 'dry_run' simulates the final publish step.
    publish_mode: Literal["real", "dry_run"] = "real"
    # In-process publisher: how often to poll for due posts, and the per-post processing cap.
    publisher_tick_seconds: int = 60
    publisher_max_attempts: int = 3
    # Reels spec guard rails (FR-SCHED-1)
    reel_min_duration_sec: int = 5
    reel_max_duration_sec: int = 90
    reel_aspect_ratio: float = 9 / 16  # width / height

    # --- Account safety defaults (anti-ban guardrails, on top of Meta's 100/24h cap) ---
    # Conservative defaults from PRD §16 "Cap UI guidance (1-3 reels/day)". Per-account
    # overrides can be added later; today these apply workspace-wide.
    safety_enabled: bool = True
    safety_daily_cap: int = 3              # max posts per account per 24h rolling
    safety_hourly_cap: int = 1             # max posts per account per 1h rolling
    safety_min_gap_minutes: int = 90       # min spacing between two posts on same account
    safety_jitter_seconds: int = 90        # ±N seconds randomized at publish time

    ghl_webhook_outbound_url: str = ""
    ghl_webhook_secret: str = ""

    sentry_dsn: str = ""

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @field_validator("cors_origins")
    @classmethod
    def reject_wildcard_cors(cls, v: str) -> str:
        # Rail #2 / PRD §12: CORS locked to app origin, never "*".
        if "*" in v:
            raise ValueError("CORS_ORIGINS must list exact origins, never '*'")
        return v

    @field_validator("database_url")
    @classmethod
    def use_asyncpg_driver(cls, v: str) -> str:
        # Render / Supabase / Heroku-style URLs come as `postgres://` or `postgresql://`
        # without a driver. SQLAlchemy async needs `postgresql+asyncpg://`. Auto-upgrade
        # so we can paste the URL straight from the hosting provider.
        if v.startswith("postgres://"):
            return "postgresql+asyncpg://" + v[len("postgres://"):]
        if v.startswith("postgresql://") and "+asyncpg" not in v:
            return "postgresql+asyncpg://" + v[len("postgresql://"):]
        return v


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
