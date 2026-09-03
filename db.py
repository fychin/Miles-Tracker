#!/usr/bin/env python3
"""
Database access layer — Miles & Points Tracker.

Refactored to use pluggable database drivers (SQLite or Turso/libsql).
The public API (get_db, close_db, init_db) remains unchanged for
backward compatibility with server.py route handlers.

The actual database driver is selected based on environment configuration:
- Local development: SQLite (data/tracker.db)
- Serverless production: Turso (libsql:// URL)
"""

import os
from flask import g, has_app_context

from config import db_config, BASE_DIR
from db_driver import create_database_adapter, ConnectionLike

# Ensure data directory exists for local SQLite fallback
os.makedirs(os.path.join(BASE_DIR, "data"), exist_ok=True)

# DB_PATH is exposed for backward compatibility with server.py
# In serverless mode (Turso), this path is not used but kept for reference
DB_PATH = os.path.join(BASE_DIR, "data", "tracker.db")


def get_db() -> ConnectionLike:
    """
    Return the request-scoped database connection.
    
    The connection type (SQLite or Turso) is determined by the
    DATABASE_PROVIDER environment variable.
    """
    if "db" not in g:
        g.db = create_database_adapter(db_config)
    return g.db


def close_db(exc=None):
    """
    Close the request-scoped connection, if one was opened.
    
    Wired up by the app via `app.teardown_appcontext(close_db)`.
    """
    db = g.pop("db", None)
    if db is not None:
        db.close()


def query_all(sql, params=()):
    """Run a SELECT and return all rows."""
    return get_db().execute(sql, params).fetchall()


def query_one(sql, params=()):
    """Run a SELECT and return the first row, or None."""
    return get_db().execute(sql, params).fetchone()


def execute(sql, params=()):
    """Run an INSERT/UPDATE/DELETE and return the cursor."""
    return get_db().execute(sql, params)


def commit():
    """Commit the current transaction."""
    get_db().commit()


# ---- Schema + migrations ----
_SCHEMA = """
    CREATE TABLE IF NOT EXISTS ffp_balances (
        id         TEXT PRIMARY KEY,
        miles      INTEGER  NOT NULL DEFAULT 0,
        expiry     TEXT     NOT NULL DEFAULT '',
        notes      TEXT     NOT NULL DEFAULT '',
        updated_at TEXT     NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS bank_balances (
        id         TEXT PRIMARY KEY,
        points     INTEGER  NOT NULL DEFAULT 0,
        expiry     TEXT     NOT NULL DEFAULT '',
        updated_at TEXT     NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS activity_log (
        id         INTEGER  PRIMARY KEY AUTOINCREMENT,
        ts         TEXT     NOT NULL DEFAULT (datetime('now')),
        kind       TEXT     NOT NULL,
        record_id  TEXT     NOT NULL,
        old_val    INTEGER,
        new_val    INTEGER,
        note       TEXT     DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS redemptions (
        id          INTEGER  PRIMARY KEY AUTOINCREMENT,
        program_id  TEXT     NOT NULL,
        travel_date TEXT     NOT NULL DEFAULT '',
        miles_used  INTEGER  NOT NULL DEFAULT 0,
        cabin       TEXT     NOT NULL DEFAULT '',
        route       TEXT     NOT NULL DEFAULT '',
        airline     TEXT     NOT NULL DEFAULT '',
        one_way     INTEGER  NOT NULL DEFAULT 0,
        notes       TEXT     NOT NULL DEFAULT '',
        cash_value  REAL     NOT NULL DEFAULT 0,
        taxes_fees  REAL     NOT NULL DEFAULT 0,
        created_at  TEXT     NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cost_entries (
        id             INTEGER  PRIMARY KEY AUTOINCREMENT,
        program_id     TEXT     NOT NULL,
        entry_date     TEXT     NOT NULL DEFAULT '',
        source         TEXT     NOT NULL DEFAULT '',
        miles_acquired INTEGER  NOT NULL DEFAULT 0,
        cost_sgd       REAL     NOT NULL DEFAULT 0,
        notes          TEXT     NOT NULL DEFAULT '',
        created_at     TEXT     NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cost_transfer_links (
        id                  INTEGER  PRIMARY KEY AUTOINCREMENT,
        transfer_entry_id   INTEGER  NOT NULL,
        source_entry_id     INTEGER  NOT NULL,
        miles_consumed      INTEGER  NOT NULL DEFAULT 0,
        dest_miles          INTEGER  NOT NULL DEFAULT 0,
        inherited_cost      REAL     NOT NULL DEFAULT 0,
        fee_share           REAL     NOT NULL DEFAULT 0,
        conversion_rate     REAL     NOT NULL DEFAULT 0,
        source_rate_label   TEXT     NOT NULL DEFAULT '',
        created_at          TEXT     NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (transfer_entry_id) REFERENCES cost_entries(id) ON DELETE CASCADE,
        FOREIGN KEY (source_entry_id)   REFERENCES cost_entries(id)
    );

    CREATE TABLE IF NOT EXISTS app_settings (
        key    TEXT PRIMARY KEY,
        value  TEXT NOT NULL DEFAULT ''
    );
"""


def _run_migrations(db):
    """
    Idempotent ALTER TABLE migrations for columns added after initial release.
    
    Note: PRAGMA table_info is supported by both SQLite and Turso/libsql.
    """
    # Migration: add cash_value/taxes_fees/origin/destination/via/block_time_minutes
    # to pre-existing redemptions tables created before these columns existed.
    cols = {r["name"] for r in db.execute("PRAGMA table_info(redemptions)").fetchall()}
    if "cash_value" not in cols:
        db.execute("ALTER TABLE redemptions ADD COLUMN cash_value REAL NOT NULL DEFAULT 0")
    if "taxes_fees" not in cols:
        db.execute("ALTER TABLE redemptions ADD COLUMN taxes_fees REAL NOT NULL DEFAULT 0")
    if "origin" not in cols:
        db.execute("ALTER TABLE redemptions ADD COLUMN origin TEXT NOT NULL DEFAULT ''")
    if "destination" not in cols:
        db.execute("ALTER TABLE redemptions ADD COLUMN destination TEXT NOT NULL DEFAULT ''")
    if "via" not in cols:
        db.execute("ALTER TABLE redemptions ADD COLUMN via TEXT NOT NULL DEFAULT ''")
    if "block_time_minutes" not in cols:
        db.execute("ALTER TABLE redemptions ADD COLUMN block_time_minutes INTEGER NOT NULL DEFAULT 0")

    # Migration: lot-tracking fields on cost_entries (supports transfer reconciliation)
    cost_cols = {r["name"] for r in db.execute("PRAGMA table_info(cost_entries)").fetchall()}
    if "entry_type" not in cost_cols:
        db.execute("ALTER TABLE cost_entries ADD COLUMN entry_type TEXT NOT NULL DEFAULT 'acquisition'")
    if "remaining_miles" not in cost_cols:
        db.execute("ALTER TABLE cost_entries ADD COLUMN remaining_miles INTEGER NOT NULL DEFAULT 0")
        # Backfill: every pre-existing row starts fully "unconsumed"
        db.execute("UPDATE cost_entries SET remaining_miles = miles_acquired WHERE remaining_miles = 0")

    # Migration: explicit conversion-rate snapshot on transfer links.
    link_cols = {r["name"] for r in db.execute("PRAGMA table_info(cost_transfer_links)").fetchall()}
    if "conversion_rate" not in link_cols:
        db.execute("ALTER TABLE cost_transfer_links ADD COLUMN conversion_rate REAL NOT NULL DEFAULT 0")
        db.execute("""
            UPDATE cost_transfer_links
            SET conversion_rate = ROUND(1.0 * dest_miles / miles_consumed, 6)
            WHERE miles_consumed > 0
        """)
    if "source_rate_label" not in link_cols:
        db.execute("ALTER TABLE cost_transfer_links ADD COLUMN source_rate_label TEXT NOT NULL DEFAULT ''")


def init_db(app):
    """
    Create tables if they don't exist and apply idempotent migrations.
    
    Safe to call multiple times. Called at import time so schema
    creation/migration happens when the app is loaded by a WSGI server
    (gunicorn, Vercel serverless, etc.) as well as `python server.py`.
    """
    def _run():
        db = get_db()
        db.executescript(_SCHEMA)
        _run_migrations(db)
        db.commit()

    if has_app_context():
        _run()
    else:
        with app.app_context():
            _run()
