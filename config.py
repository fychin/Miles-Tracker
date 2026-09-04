#!/usr/bin/env python3
"""
Environment configuration for Miles & Points Tracker.

Supports both SQLite (local development) and Turso (serverless production)
database backends. Configuration is driven by environment variables.

Environment Variables:
    DATABASE_PROVIDER: "sqlite", "turso", or "auto" (default: "auto")
    DATABASE_URL: Connection URL or file path
    TURSO_AUTH_TOKEN: Auth token for Turso (required for Turso)
"""

import os
from dataclasses import dataclass
from typing import Optional

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


@dataclass
class DatabaseConfig:
    """Database configuration container."""
    
    provider: str  # "sqlite" or "turso"
    url: str       # SQLite path or Turso libsql:// URL
    auth_token: Optional[str] = None
    
    @classmethod
    def from_env(cls) -> "DatabaseConfig":
        """Create DatabaseConfig from environment variables."""
        provider = os.environ.get("DATABASE_PROVIDER", "auto").lower()
        database_url = os.environ.get("DATABASE_URL", "")
        turso_database_url = os.environ.get("TURSO_DATABASE_URL")
        auth_token = os.environ.get("TURSO_AUTH_TOKEN")
        
        # If TURSO_DATABASE_URL is provided and no explicit DATABASE_URL, prefer TURSO URL
        if not database_url and turso_database_url:
            database_url = turso_database_url
        
        # Auto-detect provider if requested
        if provider == "auto":
            # Inspect the URL (if any) to decide between sqlite and turso
            url_to_inspect = database_url or ""
            if url_to_inspect.startswith("libsql://") or url_to_inspect.startswith("turso://"):
                provider = "turso"
            else:
                provider = "sqlite"
        
        if provider == "sqlite" and not database_url:
            # Default to local SQLite file
            base_dir = os.path.dirname(os.path.abspath(__file__))
            database_url = os.path.join(base_dir, "data", "tracker.db")
        
        return cls(provider=provider, url=database_url, auth_token=auth_token)


# Global config instance
db_config = DatabaseConfig.from_env()
