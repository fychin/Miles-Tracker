#!/usr/bin/env python3
"""
Miles & Points Tracker — Backend API
Stack: Python · Flask · SQLite
"""

import sqlite3
import json
import os
import time
import urllib.request
import urllib.error
from datetime import datetime
from flask import Flask, request, jsonify, send_from_directory, g

# ── Config ──────────────────────────────────────────────────────────────────
BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
DB_PATH    = os.path.join(BASE_DIR, "data", "tracker.db")
STATIC_DIR = os.path.join(BASE_DIR, "static")
PORT       = int(os.environ.get("PORT", 3000))
DEBUG      = os.environ.get("FLASK_DEBUG", "0") == "1"

# Public, keyless airport database (IATA/ICAO, lat/lon, city, country).
# Source: https://github.com/mwgg/Airports — maintained public dataset, ~29k airports.
AIRPORTS_SOURCE_URL   = "https://raw.githubusercontent.com/mwgg/Airports/master/airports.json"
AIRPORTS_CACHE_PATH   = os.path.join(BASE_DIR, "data", "airports_cache.json")
AIRPORTS_CACHE_MAX_AGE = 30 * 24 * 3600  # 30 days — airport coordinates rarely change

os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
os.makedirs(STATIC_DIR, exist_ok=True)

app = Flask(__name__, static_folder=STATIC_DIR)

# ── Database helpers ─────────────────────────────────────────────────────────
def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH, detect_types=sqlite3.PARSE_DECLTYPES)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA journal_mode=WAL")
        g.db.execute("PRAGMA foreign_keys=ON")
    return g.db

@app.teardown_appcontext
def close_db(exc=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()

def init_db():
    """Create tables if they don't exist (idempotent)."""
    with app.app_context():
        db = get_db()
        db.executescript("""
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
        """)

        # Idempotent migration: add cash_value/taxes_fees/origin/destination/via to pre-existing redemptions tables
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

        # Idempotent migration: lot-tracking fields on cost_entries (supports transfer reconciliation)
        cost_cols = {r["name"] for r in db.execute("PRAGMA table_info(cost_entries)").fetchall()}
        if "entry_type" not in cost_cols:
            db.execute("ALTER TABLE cost_entries ADD COLUMN entry_type TEXT NOT NULL DEFAULT 'acquisition'")
        if "remaining_miles" not in cost_cols:
            db.execute("ALTER TABLE cost_entries ADD COLUMN remaining_miles INTEGER NOT NULL DEFAULT 0")
            # Backfill: every pre-existing row starts fully "unconsumed"
            db.execute("UPDATE cost_entries SET remaining_miles = miles_acquired WHERE remaining_miles = 0")

        # Idempotent migration: explicit conversion-rate snapshot on transfer links (Plan item A).
        # This was always implicitly true (dest_miles/miles_consumed never changes after creation),
        # but making it an explicit stored column means it survives even if that derivation logic
        # ever changes, and gives the UI/audit trail a field to read directly.
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

        db.commit()

# ── CORS (manual, no extra package needed) ───────────────────────────────────
@app.after_request
def add_cors(response):
    origin = request.headers.get("Origin", "*")
    response.headers["Access-Control-Allow-Origin"]  = origin
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    response.headers["Access-Control-Max-Age"]       = "600"
    return response

@app.route("/api/<path:path>", methods=["OPTIONS"])
@app.route("/api", methods=["OPTIONS"])
def preflight(path=""):
    return jsonify({}), 200

# ── Health ────────────────────────────────────────────────────────────────────
@app.route("/api/health")
def health():
    return jsonify({"status": "ok", "db": DB_PATH, "ts": datetime.utcnow().isoformat()})

# ── Airports (public dataset, cached locally) ──────────────────────────────────
def _fetch_and_cache_airports():
    """Download the public airport dataset, slim it to IATA-keyed coords, cache to disk."""
    req = urllib.request.Request(AIRPORTS_SOURCE_URL, headers={"User-Agent": "miles-tracker/1.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        raw = json.loads(resp.read().decode("utf-8"))

    slim = {}
    for _icao, v in raw.items():
        iata = (v.get("iata") or "").strip().upper()
        if len(iata) != 3:
            continue
        slim[iata] = {
            "lat":     round(float(v.get("lat", 0) or 0), 4),
            "lon":     round(float(v.get("lon", 0) or 0), 4),
            "city":    v.get("city") or v.get("name") or iata,
            "name":    v.get("name", ""),
            "country": v.get("country", ""),
        }

    payload = {"fetched_at": time.time(), "source": AIRPORTS_SOURCE_URL, "airports": slim}
    with open(AIRPORTS_CACHE_PATH, "w") as f:
        json.dump(payload, f, separators=(",", ":"))
    return payload

def _load_airports_cache(force_refresh=False):
    """Return cached airport data, refreshing from source if missing/stale/forced."""
    if not force_refresh and os.path.exists(AIRPORTS_CACHE_PATH):
        try:
            with open(AIRPORTS_CACHE_PATH) as f:
                cached = json.load(f)
            age = time.time() - cached.get("fetched_at", 0)
            if age < AIRPORTS_CACHE_MAX_AGE:
                return cached
        except (json.JSONDecodeError, OSError):
            pass
    try:
        return _fetch_and_cache_airports()
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as e:
        # Network unavailable — fall back to whatever is cached, even if stale
        if os.path.exists(AIRPORTS_CACHE_PATH):
            with open(AIRPORTS_CACHE_PATH) as f:
                return json.load(f)
        return {"fetched_at": None, "source": AIRPORTS_SOURCE_URL, "airports": {}, "error": str(e)}

@app.route("/api/airports", methods=["GET"])
def get_airports():
    """Serve the cached IATA→coordinates map. Refreshed from the public source
    at most once every 30 days, so this stays fast after the first request."""
    force = request.args.get("refresh", "false").lower() == "true"
    data = _load_airports_cache(force_refresh=force)
    resp = jsonify(data)
    resp.headers["Cache-Control"] = "public, max-age=86400"  # browsers may cache 1 day
    return resp

# ── FFP endpoints ─────────────────────────────────────────────────────────────
@app.route("/api/ffp", methods=["GET"])
def get_ffp():
    db   = get_db()
    rows = db.execute("SELECT * FROM ffp_balances").fetchall()
    return jsonify([dict(r) for r in rows])

@app.route("/api/ffp/<ffp_id>", methods=["GET"])
def get_ffp_one(ffp_id):
    db  = get_db()
    row = db.execute("SELECT * FROM ffp_balances WHERE id = ?", (ffp_id,)).fetchone()
    if row is None:
        return jsonify({"error": "not found"}), 404
    return jsonify(dict(row))

@app.route("/api/ffp/<ffp_id>", methods=["PUT"])
def upsert_ffp(ffp_id):
    body  = request.get_json(force=True)
    miles = int(body.get("miles", 0))
    exp   = str(body.get("expiry", "")).strip()
    notes = str(body.get("notes",  "")).strip()
    now   = datetime.now().strftime("%-d %b %Y")

    db = get_db()
    old = db.execute("SELECT miles FROM ffp_balances WHERE id = ?", (ffp_id,)).fetchone()
    old_miles = old["miles"] if old else None

    db.execute("""
        INSERT INTO ffp_balances (id, miles, expiry, notes, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            miles      = excluded.miles,
            expiry     = excluded.expiry,
            notes      = excluded.notes,
            updated_at = excluded.updated_at
    """, (ffp_id, miles, exp, notes, now))

    db.execute("""
        INSERT INTO activity_log (kind, record_id, old_val, new_val, note)
        VALUES ('ffp', ?, ?, ?, ?)
    """, (ffp_id, old_miles, miles, notes))

    db.commit()
    row = db.execute("SELECT * FROM ffp_balances WHERE id = ?", (ffp_id,)).fetchone()
    return jsonify(dict(row))

# ── Bank endpoints ────────────────────────────────────────────────────────────
@app.route("/api/bank", methods=["GET"])
def get_bank():
    db   = get_db()
    rows = db.execute("SELECT * FROM bank_balances").fetchall()
    return jsonify([dict(r) for r in rows])

@app.route("/api/bank/<bank_id>", methods=["GET"])
def get_bank_one(bank_id):
    db  = get_db()
    row = db.execute("SELECT * FROM bank_balances WHERE id = ?", (bank_id,)).fetchone()
    if row is None:
        return jsonify({"error": "not found"}), 404
    return jsonify(dict(row))

@app.route("/api/bank/<bank_id>", methods=["PUT"])
def upsert_bank(bank_id):
    body   = request.get_json(force=True)
    points = int(body.get("points", 0))
    exp    = str(body.get("expiry", "")).strip()
    now    = datetime.now().strftime("%-d %b %Y")

    db = get_db()
    old = db.execute("SELECT points FROM bank_balances WHERE id = ?", (bank_id,)).fetchone()
    old_pts = old["points"] if old else None

    db.execute("""
        INSERT INTO bank_balances (id, points, expiry, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            points     = excluded.points,
            expiry     = excluded.expiry,
            updated_at = excluded.updated_at
    """, (bank_id, points, exp, now))

    db.execute("""
        INSERT INTO activity_log (kind, record_id, old_val, new_val)
        VALUES ('bank', ?, ?, ?)
    """, (bank_id, old_pts, points))

    db.commit()
    row = db.execute("SELECT * FROM bank_balances WHERE id = ?", (bank_id,)).fetchone()
    return jsonify(dict(row))

# ── Activity log ──────────────────────────────────────────────────────────────
@app.route("/api/activity", methods=["GET"])
def get_activity():
    db   = get_db()
    rows = db.execute(
        "SELECT * FROM activity_log ORDER BY id DESC LIMIT 100"
    ).fetchall()
    return jsonify([dict(r) for r in rows])

# -- Redemptions -------------------------------------------------------------------
@app.route("/api/redemptions", methods=["GET"])
def get_redemptions():
    db = get_db()
    rows = db.execute("SELECT * FROM redemptions ORDER BY travel_date DESC, id DESC").fetchall()
    return jsonify([dict(r) for r in rows])

@app.route("/api/redemptions", methods=["POST"])
def create_redemption():
    body = request.get_json(force=True)
    db = get_db()
    cur = db.execute(
        "INSERT INTO redemptions (program_id,travel_date,miles_used,cabin,route,origin,destination,via,airline,one_way,notes,cash_value,taxes_fees,block_time_minutes) "
        "VALUES (:program_id,:travel_date,:miles_used,:cabin,:route,:origin,:destination,:via,:airline,:one_way,:notes,:cash_value,:taxes_fees,:block_time_minutes)",
        {
            "program_id":  str(body.get("program_id","")).strip(),
            "travel_date": str(body.get("travel_date","")).strip(),
            "miles_used":  int(body.get("miles_used",0)),
            "cabin":       str(body.get("cabin","")).strip(),
            "route":       str(body.get("route","")).strip(),
            "origin":      str(body.get("origin","")).strip().upper(),
            "destination": str(body.get("destination","")).strip().upper(),
            "via":         str(body.get("via","")).strip().upper(),
            "airline":     str(body.get("airline","")).strip(),
            "one_way":     1 if body.get("one_way") else 0,
            "notes":       str(body.get("notes","")).strip(),
            "cash_value":  float(body.get("cash_value",0) or 0),
            "taxes_fees":  float(body.get("taxes_fees",0) or 0),
            "block_time_minutes": int(body.get("block_time_minutes",0) or 0),
        }
    )
    db.commit()
    row = db.execute("SELECT * FROM redemptions WHERE id=?", (cur.lastrowid,)).fetchone()
    return jsonify(dict(row)), 201

@app.route("/api/redemptions/<int:rid>", methods=["PUT"])
def update_redemption(rid):
    body = request.get_json(force=True)
    db = get_db()
    db.execute(
        "UPDATE redemptions SET program_id=:program_id, travel_date=:travel_date, "
        "miles_used=:miles_used, cabin=:cabin, route=:route, origin=:origin, destination=:destination, via=:via, "
        "airline=:airline, one_way=:one_way, notes=:notes, cash_value=:cash_value, taxes_fees=:taxes_fees, "
        "block_time_minutes=:block_time_minutes WHERE id=:id",
        {
            "id": rid,
            "program_id":  str(body.get("program_id","")).strip(),
            "travel_date": str(body.get("travel_date","")).strip(),
            "miles_used":  int(body.get("miles_used",0)),
            "cabin":       str(body.get("cabin","")).strip(),
            "route":       str(body.get("route","")).strip(),
            "origin":      str(body.get("origin","")).strip().upper(),
            "destination": str(body.get("destination","")).strip().upper(),
            "via":         str(body.get("via","")).strip().upper(),
            "airline":     str(body.get("airline","")).strip(),
            "one_way":     1 if body.get("one_way") else 0,
            "notes":       str(body.get("notes","")).strip(),
            "cash_value":  float(body.get("cash_value",0) or 0),
            "taxes_fees":  float(body.get("taxes_fees",0) or 0),
            "block_time_minutes": int(body.get("block_time_minutes",0) or 0),
        }
    )
    db.commit()
    row = db.execute("SELECT * FROM redemptions WHERE id=?", (rid,)).fetchone()
    if row is None:
        return jsonify({"error":"not found"}), 404
    return jsonify(dict(row))

@app.route("/api/redemptions/<int:rid>", methods=["DELETE"])
def delete_redemption(rid):
    db = get_db()
    db.execute("DELETE FROM redemptions WHERE id=?", (rid,))
    db.commit()
    return jsonify({"deleted": rid})

# ── Cost basis (effective cost per mile) ─────────────────────────────────────
#
# Lot model: every cost_entries row is a "lot" of miles/points acquired at a
# known cost. entry_type is 'acquisition' (bought/earned directly) or
# 'transfer' (produced by converting one or more source lots into a
# destination program — see /api/cost-transfers below). remaining_miles
# tracks how much of a lot's original miles_acquired have NOT yet been
# consumed by a downstream transfer, so a lot that's been transferred out
# stops contributing to its origin program's cost basis (no double counting).

def _row_to_dict(row):
    return dict(row) if row is not None else None

def _annotate_entry(d):
    """Add a computed 'status' to a cost_entries dict — live / partially_consumed /
    consumed — derived from remaining_miles vs miles_acquired, so the frontend
    doesn't have to re-derive this comparison on every render."""
    if d is None:
        return d
    remaining, total = d.get("remaining_miles", 0), d.get("miles_acquired", 0)
    if total <= 0 or remaining >= total:
        d["status"] = "live"
    elif remaining <= 0:
        d["status"] = "consumed"
    else:
        d["status"] = "partially_consumed"
    return d

@app.route("/api/cost-entries", methods=["GET"])
def get_cost_entries():
    db = get_db()
    program   = request.args.get("program_id")
    available = request.args.get("available")  # "true" → only lots with remaining_miles > 0
    q = "SELECT * FROM cost_entries WHERE 1=1"
    params = []
    if program:
        q += " AND program_id=?"
        params.append(program)
    if str(available).lower() == "true":
        q += " AND remaining_miles > 0"
    q += " ORDER BY entry_date DESC, id DESC"
    rows = db.execute(q, params).fetchall()
    return jsonify([_annotate_entry(dict(r)) for r in rows])

@app.route("/api/cost-entries", methods=["POST"])
def create_cost_entry():
    """Create an 'acquisition' lot (bought points, annual fee, cash-buy, etc.).
    Transfer-produced lots are created via POST /api/cost-transfers instead."""
    body = request.get_json(force=True)
    db = get_db()
    miles = int(body.get("miles_acquired", 0) or 0)
    cur = db.execute(
        "INSERT INTO cost_entries (program_id,entry_date,source,miles_acquired,cost_sgd,notes,entry_type,remaining_miles) "
        "VALUES (:program_id,:entry_date,:source,:miles_acquired,:cost_sgd,:notes,'acquisition',:remaining_miles)",
        {
            "program_id":     str(body.get("program_id","")).strip(),
            "entry_date":     str(body.get("entry_date","")).strip(),
            "source":         str(body.get("source","")).strip(),
            "miles_acquired": miles,
            "cost_sgd":       float(body.get("cost_sgd",0) or 0),
            "notes":          str(body.get("notes","")).strip(),
            "remaining_miles": miles,
        }
    )
    db.commit()
    row = db.execute("SELECT * FROM cost_entries WHERE id=?", (cur.lastrowid,)).fetchone()
    return jsonify(_annotate_entry(dict(row))), 201

@app.route("/api/cost-entries/<int:cid>", methods=["PUT"])
def update_cost_entry(cid):
    body = request.get_json(force=True)
    db = get_db()
    existing = db.execute("SELECT * FROM cost_entries WHERE id=?", (cid,)).fetchone()
    if existing is None:
        return jsonify({"error":"not found"}), 404
    existing = dict(existing)

    if existing["entry_type"] == "transfer":
        # Transfer lots are derived (miles/cost come from their source links) —
        # only descriptive fields can be edited here. Delete-and-recreate the
        # transfer via /api/cost-transfers to change amounts.
        db.execute(
            "UPDATE cost_entries SET entry_date=:entry_date, source=:source, notes=:notes WHERE id=:id",
            {"id": cid, "entry_date": str(body.get("entry_date", existing["entry_date"])).strip(),
             "source": str(body.get("source", existing["source"])).strip(),
             "notes": str(body.get("notes", existing["notes"])).strip()}
        )
    else:
        consumed = existing["miles_acquired"] - existing["remaining_miles"]  # miles already sent onward
        new_miles = int(body.get("miles_acquired", existing["miles_acquired"]) or 0)
        if new_miles < consumed:
            return jsonify({"error": f"Can't reduce to {new_miles}mi — {consumed}mi from this lot has "
                                      f"already been transferred out. Delete the transfer(s) first."}), 400
        db.execute(
            "UPDATE cost_entries SET program_id=:program_id, entry_date=:entry_date, source=:source, "
            "miles_acquired=:miles_acquired, cost_sgd=:cost_sgd, notes=:notes, remaining_miles=:remaining_miles "
            "WHERE id=:id",
            {
                "id": cid,
                "program_id":     str(body.get("program_id", existing["program_id"])).strip(),
                "entry_date":     str(body.get("entry_date", existing["entry_date"])).strip(),
                "source":         str(body.get("source", existing["source"])).strip(),
                "miles_acquired": new_miles,
                "cost_sgd":       float(body.get("cost_sgd", existing["cost_sgd"]) or 0),
                "notes":          str(body.get("notes", existing["notes"])).strip(),
                "remaining_miles": new_miles - consumed,
            }
        )
    db.commit()
    row = db.execute("SELECT * FROM cost_entries WHERE id=?", (cid,)).fetchone()
    return jsonify(_annotate_entry(dict(row)))

@app.route("/api/cost-entries/<int:cid>", methods=["DELETE"])
def delete_cost_entry(cid):
    db = get_db()
    row = db.execute("SELECT * FROM cost_entries WHERE id=?", (cid,)).fetchone()
    if row is None:
        return jsonify({"error": "not found"}), 404
    row = dict(row)

    if row["entry_type"] == "transfer":
        return jsonify({"error": "This is a transfer-produced lot. Delete it from the Transfers view "
                                  "so the miles it consumed are restored to their source lots."}), 400
    if row["remaining_miles"] < row["miles_acquired"]:
        return jsonify({"error": f"{row['miles_acquired'] - row['remaining_miles']}mi from this lot has "
                                  f"already been transferred out. Delete the transfer(s) first."}), 400

    db.execute("DELETE FROM cost_entries WHERE id=?", (cid,))
    db.commit()
    return jsonify({"deleted": cid})

@app.route("/api/cost-basis", methods=["GET"])
def get_cost_basis():
    """Cost-per-mile for every program that has cost entries.

    Two views are returned per program:
      - all-time totals (total_miles/total_cost): every lot ever logged, gross —
        useful for "how much have I spent acquiring miles in this program, ever".
      - remaining totals (remaining_miles/remaining_cost): only the portion of
        each lot NOT yet consumed by a transfer out — this is the basis that
        should drive redemption-value math, since transferred-out miles no
        longer belong to this program.
    cost_per_mile is computed from the REMAINING totals (the economically
    correct "what would it cost to replace what I currently hold" figure).
    """
    db = get_db()
    rows = db.execute("""
        SELECT program_id,
               SUM(miles_acquired) AS total_miles,
               SUM(cost_sgd)       AS total_cost,
               SUM(remaining_miles) AS remaining_miles,
               SUM(CASE WHEN miles_acquired > 0
                        THEN cost_sgd * (1.0 * remaining_miles / miles_acquired)
                        ELSE 0 END) AS remaining_cost,
               COUNT(*)            AS entry_count
        FROM cost_entries
        GROUP BY program_id
    """).fetchall()
    out = {}
    for r in rows:
        d = dict(r)
        rem_miles = d["remaining_miles"] or 0
        rem_cost  = d["remaining_cost"] or 0
        d["cost_per_mile"] = round(rem_cost / rem_miles, 5) if rem_miles > 0 else 0
        out[d["program_id"]] = d
    return jsonify(out)

@app.route("/api/cost-transfer-rate-history", methods=["GET"])
def get_transfer_rate_history():
    """For each program that's ever been used as a transfer source, the most
    recently used conversion rate + when — so the UI can flag if a newly
    suggested rate has drifted from what you actually got last time. Purely
    informational: never touches stored transfer data."""
    db = get_db()
    rows = db.execute("""
        SELECT ce.program_id AS program_id, l.conversion_rate AS conversion_rate, l.created_at AS created_at
        FROM cost_transfer_links l
        JOIN cost_entries ce ON ce.id = l.source_entry_id
        ORDER BY l.created_at DESC, l.id DESC
    """).fetchall()
    out = {}
    for r in rows:
        d = dict(r)
        if d["program_id"] not in out:
            out[d["program_id"]] = {"conversion_rate": d["conversion_rate"], "last_used": d["created_at"]}
    return jsonify(out)

# ── App settings (small key/value store, e.g. ideal cost-per-mile valuation) ──
DEFAULT_SETTINGS = {"ideal_cpm": "1.5"}  # cents per mile — a common rough "good value" benchmark

@app.route("/api/settings", methods=["GET"])
def get_settings():
    db = get_db()
    rows = db.execute("SELECT key, value FROM app_settings").fetchall()
    out = dict(DEFAULT_SETTINGS)
    out.update({r["key"]: r["value"] for r in rows})
    return jsonify({"ideal_cpm": float(out.get("ideal_cpm", DEFAULT_SETTINGS["ideal_cpm"]))})

@app.route("/api/settings", methods=["PUT"])
def update_settings():
    body = request.get_json(force=True)
    db = get_db()
    if "ideal_cpm" in body:
        db.execute(
            "INSERT INTO app_settings (key,value) VALUES ('ideal_cpm',?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (str(float(body["ideal_cpm"])),)
        )
    db.commit()
    return get_settings()

# ── Transfers (convert one or more source lots into a destination lot) ───────
@app.route("/api/cost-transfers", methods=["POST"])
def create_cost_transfer():
    """Consume miles from one or more existing lots (possibly in different
    programs, e.g. bought bank points + organically-earned FFP miles in the
    same batch) and produce a single new destination lot, inheriting cost
    from each source pro-rated by its share of destination miles, plus its
    pro-rated share of the transfer fee. Prevents double counting because the
    consumed amount is subtracted from each source lot's remaining_miles."""
    body   = request.get_json(force=True)
    db     = get_db()
    dest_program = str(body.get("dest_program_id","")).strip()
    entry_date   = str(body.get("entry_date","")).strip()
    notes        = str(body.get("notes","")).strip()
    fee          = float(body.get("transfer_fee", 0) or 0)
    sources_in   = body.get("sources", [])

    if not dest_program:
        return jsonify({"error": "dest_program_id is required"}), 400
    if not sources_in:
        return jsonify({"error": "at least one source lot is required"}), 400

    # Validate + lock in source lots
    sources = []
    for s in sources_in:
        try:
            entry_id = int(s["entry_id"])
            miles_consumed = int(s.get("miles_consumed", 0) or 0)
            dest_miles = int(s.get("dest_miles_contributed", 0) or 0)
        except (KeyError, ValueError, TypeError):
            return jsonify({"error": "each source needs entry_id, miles_consumed, dest_miles_contributed"}), 400
        if miles_consumed <= 0 or dest_miles <= 0:
            return jsonify({"error": "miles_consumed and dest_miles_contributed must be > 0"}), 400
        lot = db.execute("SELECT * FROM cost_entries WHERE id=?", (entry_id,)).fetchone()
        if lot is None:
            return jsonify({"error": f"source lot {entry_id} not found"}), 404
        lot = dict(lot)
        if miles_consumed > lot["remaining_miles"]:
            return jsonify({"error": f"lot {entry_id} only has {lot['remaining_miles']}mi remaining, "
                                      f"can't consume {miles_consumed}mi"}), 400
        sources.append({"lot": lot, "miles_consumed": miles_consumed, "dest_miles": dest_miles})

    total_dest_miles = sum(s["dest_miles"] for s in sources)

    # Create the destination lot first (id needed for link rows)
    cur = db.execute(
        "INSERT INTO cost_entries (program_id,entry_date,source,miles_acquired,cost_sgd,notes,entry_type,remaining_miles) "
        "VALUES (:program_id,:entry_date,:source,0,0,:notes,'transfer',0)",
        {"program_id": dest_program, "entry_date": entry_date,
         "source": body.get("source") or "Transfer in", "notes": notes}
    )
    transfer_id = cur.lastrowid

    total_cost = 0.0
    for s in sources:
        lot, miles_consumed, dest_miles = s["lot"], s["miles_consumed"], s["dest_miles"]
        lot_cpm = (lot["cost_sgd"] / lot["miles_acquired"]) if lot["miles_acquired"] > 0 else 0
        inherited_cost = miles_consumed * lot_cpm
        fee_share = fee * (dest_miles / total_dest_miles) if total_dest_miles > 0 else 0
        line_cost = inherited_cost + fee_share
        total_cost += line_cost

        # Snapshot the conversion rate used for THIS transfer at THIS moment.
        # It's derived from dest_miles/miles_consumed (which never changes after
        # insert) but is stored explicitly so it survives independent of that
        # derivation and gives the audit trail a readable rate + label directly,
        # even if the bank's published rate changes later.
        conversion_rate = round(dest_miles / miles_consumed, 6) if miles_consumed > 0 else 0
        rate_label = f"{miles_consumed:,} → {dest_miles:,} ({conversion_rate:.4f} mi/pt)"

        db.execute(
            "INSERT INTO cost_transfer_links (transfer_entry_id,source_entry_id,miles_consumed,dest_miles,inherited_cost,fee_share,conversion_rate,source_rate_label) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (transfer_id, lot["id"], miles_consumed, dest_miles, round(inherited_cost, 5), round(fee_share, 5),
             conversion_rate, rate_label)
        )
        db.execute(
            "UPDATE cost_entries SET remaining_miles = remaining_miles - ? WHERE id = ?",
            (miles_consumed, lot["id"])
        )

    db.execute(
        "UPDATE cost_entries SET miles_acquired=?, remaining_miles=?, cost_sgd=? WHERE id=?",
        (total_dest_miles, total_dest_miles, round(total_cost, 5), transfer_id)
    )
    db.commit()

    row   = _annotate_entry(dict(db.execute("SELECT * FROM cost_entries WHERE id=?", (transfer_id,)).fetchone()))
    links = [dict(r) for r in db.execute(
        "SELECT * FROM cost_transfer_links WHERE transfer_entry_id=?", (transfer_id,)
    ).fetchall()]
    return jsonify({"entry": row, "links": links}), 201

@app.route("/api/cost-transfers/<int:transfer_id>", methods=["GET"])
def get_cost_transfer(transfer_id):
    db  = get_db()
    row = db.execute("SELECT * FROM cost_entries WHERE id=? AND entry_type='transfer'", (transfer_id,)).fetchone()
    if row is None:
        return jsonify({"error": "not found"}), 404
    links = [dict(r) for r in db.execute(
        "SELECT * FROM cost_transfer_links WHERE transfer_entry_id=?", (transfer_id,)
    ).fetchall()]
    return jsonify({"entry": _annotate_entry(dict(row)), "links": links})

@app.route("/api/cost-transfers/<int:transfer_id>", methods=["DELETE"])
def delete_cost_transfer(transfer_id):
    """Reverse a transfer: restore consumed miles to each source lot, then
    remove the destination lot. Blocked if the destination lot has itself
    already been partially transferred onward."""
    db  = get_db()
    row = db.execute("SELECT * FROM cost_entries WHERE id=? AND entry_type='transfer'", (transfer_id,)).fetchone()
    if row is None:
        return jsonify({"error": "not found"}), 404
    row = dict(row)
    if row["remaining_miles"] < row["miles_acquired"]:
        return jsonify({"error": f"{row['miles_acquired'] - row['remaining_miles']}mi produced by this "
                                  f"transfer has already been used in a further transfer. Undo that one first."}), 400

    links = [dict(r) for r in db.execute(
        "SELECT * FROM cost_transfer_links WHERE transfer_entry_id=?", (transfer_id,)
    ).fetchall()]
    for link in links:
        db.execute(
            "UPDATE cost_entries SET remaining_miles = remaining_miles + ? WHERE id = ?",
            (link["miles_consumed"], link["source_entry_id"])
        )
    db.execute("DELETE FROM cost_transfer_links WHERE transfer_entry_id=?", (transfer_id,))
    db.execute("DELETE FROM cost_entries WHERE id=?", (transfer_id,))
    db.commit()
    return jsonify({"deleted": transfer_id, "restored_links": len(links)})

# ── Bulk export / import ──────────────────────────────────────────────────────
@app.route("/api/export", methods=["GET"])
def export_all():
    db      = get_db()
    ffp     = [dict(r) for r in db.execute("SELECT * FROM ffp_balances").fetchall()]
    bank    = [dict(r) for r in db.execute("SELECT * FROM bank_balances").fetchall()]
    log     = [dict(r) for r in db.execute("SELECT * FROM activity_log ORDER BY id DESC LIMIT 500").fetchall()]
    redemps = [dict(r) for r in db.execute("SELECT * FROM redemptions ORDER BY travel_date DESC").fetchall()]
    costs   = [dict(r) for r in db.execute("SELECT * FROM cost_entries ORDER BY entry_date DESC").fetchall()]
    links   = [dict(r) for r in db.execute("SELECT * FROM cost_transfer_links ORDER BY id").fetchall()]
    settings = {r["key"]: r["value"] for r in db.execute("SELECT * FROM app_settings").fetchall()}
    payload = {"ffp": ffp, "bank": bank, "activity_log": log, "redemptions": redemps, "cost_entries": costs,
               "cost_transfer_links": links, "settings": settings, "exported_at": datetime.utcnow().isoformat()}
    resp    = app.response_class(
        response=json.dumps(payload, indent=2),
        mimetype="application/json"
    )
    resp.headers["Content-Disposition"] = "attachment; filename=miles-tracker-export.json"
    return resp

@app.route("/api/import", methods=["POST"])
def import_all():
    data  = request.get_json(force=True)
    reset = request.args.get("reset", "false").lower() == "true"
    db    = get_db()
    now   = datetime.now().strftime("%-d %b %Y")
    count = {"ffp": 0, "bank": 0, "redemptions": 0, "cost_entries": 0, "cost_transfer_links": 0}

    if reset:
        db.execute("DELETE FROM ffp_balances")
        db.execute("DELETE FROM bank_balances")
        db.execute("DELETE FROM activity_log")
        db.execute("DELETE FROM redemptions")
        db.execute("DELETE FROM cost_transfer_links")
        db.execute("DELETE FROM cost_entries")
        db.execute(
            "INSERT INTO activity_log (kind, record_id, old_val, new_val, note) "
            "VALUES ('system', 'import', NULL, NULL, 'Database reset via import')"
        )

    for row in data.get("ffp", []):
        db.execute("""
            INSERT INTO ffp_balances (id, miles, expiry, notes, updated_at)
            VALUES (:id, :miles, :expiry, :notes, :updated_at)
            ON CONFLICT(id) DO UPDATE SET
                miles=excluded.miles, expiry=excluded.expiry,
                notes=excluded.notes, updated_at=excluded.updated_at
        """, {**row, "updated_at": row.get("updated_at", now)})
        count["ffp"] += 1
    for row in data.get("bank", []):
        db.execute("""
            INSERT INTO bank_balances (id, points, expiry, updated_at)
            VALUES (:id, :points, :expiry, :updated_at)
            ON CONFLICT(id) DO UPDATE SET
                points=excluded.points, expiry=excluded.expiry,
                updated_at=excluded.updated_at
        """, {**row, "updated_at": row.get("updated_at", now)})
        count["bank"] += 1
    for row in data.get("redemptions", []):
        db.execute(
            "INSERT INTO redemptions "
            "(program_id,travel_date,miles_used,cabin,route,origin,destination,via,airline,one_way,notes,cash_value,taxes_fees,block_time_minutes,created_at) "
            "VALUES (:program_id,:travel_date,:miles_used,:cabin,:route,:origin,:destination,:via,:airline,:one_way,:notes,:cash_value,:taxes_fees,:block_time_minutes,:created_at)",
            {k: row.get(k,"") for k in ["program_id","travel_date","cabin","route","origin","destination","via","airline","notes","created_at"]}
            | {"miles_used": int(row.get("miles_used",0)), "one_way": int(row.get("one_way",0)),
               "cash_value": float(row.get("cash_value",0) or 0), "taxes_fees": float(row.get("taxes_fees",0) or 0),
               "block_time_minutes": int(row.get("block_time_minutes",0) or 0)}
        )
        count["redemptions"] += 1
    for row in data.get("cost_entries", []):
        miles = int(row.get("miles_acquired",0) or 0)
        db.execute(
            "INSERT INTO cost_entries (id,program_id,entry_date,source,miles_acquired,cost_sgd,notes,created_at,entry_type,remaining_miles) "
            "VALUES (:id,:program_id,:entry_date,:source,:miles_acquired,:cost_sgd,:notes,:created_at,:entry_type,:remaining_miles) "
            "ON CONFLICT(id) DO UPDATE SET program_id=excluded.program_id, entry_date=excluded.entry_date, "
            "source=excluded.source, miles_acquired=excluded.miles_acquired, cost_sgd=excluded.cost_sgd, "
            "notes=excluded.notes, entry_type=excluded.entry_type, remaining_miles=excluded.remaining_miles",
            {k: row.get(k,"") for k in ["program_id","entry_date","source","notes","created_at"]}
            | {"id": row.get("id"), "miles_acquired": miles, "cost_sgd": float(row.get("cost_sgd",0) or 0),
               "entry_type": row.get("entry_type") or "acquisition",
               "remaining_miles": int(row.get("remaining_miles", miles) or 0)}
        )
        count["cost_entries"] += 1
    for row in data.get("cost_transfer_links", []):
        miles_consumed = int(row.get("miles_consumed",0) or 0)
        dest_miles = int(row.get("dest_miles",0) or 0)
        conversion_rate = row.get("conversion_rate")
        if conversion_rate is None:
            conversion_rate = round(dest_miles / miles_consumed, 6) if miles_consumed > 0 else 0
        db.execute(
            "INSERT INTO cost_transfer_links (transfer_entry_id,source_entry_id,miles_consumed,dest_miles,inherited_cost,fee_share,conversion_rate,source_rate_label,created_at) "
            "VALUES (:transfer_entry_id,:source_entry_id,:miles_consumed,:dest_miles,:inherited_cost,:fee_share,:conversion_rate,:source_rate_label,:created_at)",
            {"transfer_entry_id": int(row.get("transfer_entry_id")), "source_entry_id": int(row.get("source_entry_id")),
             "miles_consumed": miles_consumed, "dest_miles": dest_miles,
             "inherited_cost": float(row.get("inherited_cost",0) or 0), "fee_share": float(row.get("fee_share",0) or 0),
             "conversion_rate": float(conversion_rate or 0),
             "source_rate_label": row.get("source_rate_label") or f"{miles_consumed:,} → {dest_miles:,} ({conversion_rate:.4f} mi/pt)",
             "created_at": row.get("created_at","")}
        )
        count["cost_transfer_links"] += 1
    for key, value in (data.get("settings") or {}).items():
        db.execute(
            "INSERT INTO app_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (str(key), str(value))
        )
    db.commit()
    return jsonify({"imported": count, "reset": reset})

# ── Serve frontend ────────────────────────────────────────────────────────────
@app.route("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")

@app.route("/<path:filename>")
def static_files(filename):
    return send_from_directory(STATIC_DIR, filename)

# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    init_db()
    print(f"Miles & Points Tracker API running on http://localhost:{PORT}")
    print(f"  DB:     {DB_PATH}")
    print(f"  Static: {STATIC_DIR}")
    app.run(host="0.0.0.0", port=PORT, debug=DEBUG)
