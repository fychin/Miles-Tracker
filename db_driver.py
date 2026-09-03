#!/usr/bin/env python3
"""
Database driver abstraction layer for Miles & Points Tracker.

Provides a unified interface for both SQLite (local development) and
Turso/libsql (serverless production) database backends.

Usage:
    from config import db_config
    from db_driver import create_database_adapter
    
    adapter = create_database_adapter(db_config)
    cursor = adapter.execute("SELECT * FROM my_table")
    rows = cursor.fetchall()
    adapter.commit()
    adapter.close()
"""

from abc import ABC, abstractmethod
from typing import Any, Optional, List
import sqlite3

from config import DatabaseConfig


class CursorLike(ABC):
    """Abstract cursor interface for database results."""
    
    @abstractmethod
    def fetchall(self) -> List[Any]:
        """Fetch all remaining rows."""
        pass
    
    @abstractmethod
    def fetchone(self) -> Optional[Any]:
        """Fetch the next row, or None if no more rows."""
        pass


class ConnectionLike(ABC):
    """Abstract connection interface compatible with both drivers."""
    
    @abstractmethod
    def execute(self, sql: str, params: tuple = ()) -> CursorLike:
        """Execute SQL and return a cursor-like object."""
        pass
    
    @abstractmethod
    def executescript(self, sql_script: str) -> None:
        """Execute multiple SQL statements (for schema initialization)."""
        pass
    
    @abstractmethod
    def commit(self) -> None:
        """Commit the current transaction."""
        pass
    
    @abstractmethod
    def close(self) -> None:
        """Close the connection."""
        pass


class SQLiteCursorWrapper(CursorLike):
    """SQLite cursor wrapper implementing CursorLike."""
    
    def __init__(self, cursor: sqlite3.Cursor):
        self._cursor = cursor
    
    def fetchall(self) -> List[sqlite3.Row]:
        return self._cursor.fetchall()
    
    def fetchone(self) -> Optional[sqlite3.Row]:
        return self._cursor.fetchone()


class SQLiteAdapter(ConnectionLike):
    """
    SQLite driver adapter.
    
    Provides a connection interface compatible with TursoAdapter,
    allowing seamless switching between SQLite and Turso.
    """
    
    def __init__(self, db_path: str):
        self.db_path = db_path
        self._conn: Optional[sqlite3.Connection] = None
    
    def _get_conn(self) -> sqlite3.Connection:
        """Lazy connection initialization."""
        if self._conn is None:
            self._conn = sqlite3.connect(self.db_path, detect_types=sqlite3.PARSE_DECLTYPES)
            self._conn.row_factory = sqlite3.Row
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute("PRAGMA foreign_keys=ON")
        return self._conn
    
    def execute(self, sql: str, params: tuple = ()) -> SQLiteCursorWrapper:
        return SQLiteCursorWrapper(self._get_conn().execute(sql, params))
    
    def executescript(self, sql_script: str) -> None:
        """Execute multiple SQL statements."""
        self._get_conn().executescript(sql_script)
    
    def commit(self) -> None:
        self._get_conn().commit()
    
    def close(self) -> None:
        if self._conn:
            self._conn.close()
            self._conn = None


class TursoCursorWrapper(CursorLike):
    """Turso/libsql cursor wrapper implementing CursorLike."""
    
    def __init__(self, rows: Any):
        self._rows = rows
        self._index = 0
    
    def fetchall(self) -> List[Any]:
        # Convert to list to materialize results
        return list(self._rows)
    
    def fetchone(self) -> Optional[Any]:
        try:
            row = self._rows[self._index]
            self._index += 1
            return row
        except (IndexError, TypeError):
            return None


class TursoAdapter(ConnectionLike):
    """
    Turso/libsql driver adapter.
    
    Uses the official libsql-client Python package to connect
    to Turso cloud databases.
    """
    
    def __init__(self, url: str, auth_token: Optional[str] = None):
        self.url = url
        self.auth_token = auth_token
        self._conn = None
    
    def _get_conn(self):
        """Lazy connection initialization."""
        if self._conn is None:
            import libsql
            self._conn = libsql.connect(
                self.url,
                auth_token=self.auth_token
            )
        return self._conn
    
    def execute(self, sql: str, params: tuple = ()) -> TursoCursorWrapper:
        conn = self._get_conn()
        rows = conn.execute(sql, params)
        return TursoCursorWrapper(rows)
    
    def executescript(self, sql_script: str) -> None:
        """Execute multiple SQL statements by splitting and executing individually."""
        conn = self._get_conn()
        # Split by semicolon and execute each statement
        statements = [s.strip() for s in sql_script.split(';') if s.strip()]
        for stmt in statements:
            if not stmt.endswith(';'):
                stmt += ';'
            conn.execute(stmt)
        conn.commit()
    
    def commit(self) -> None:
        self._get_conn().commit()
    
    def close(self) -> None:
        if self._conn:
            self._conn.close()
            self._conn = None


def create_database_adapter(config: DatabaseConfig) -> ConnectionLike:
    """
    Factory function to create the appropriate database adapter.
    
    Args:
        config: DatabaseConfig with provider, url, and auth_token
        
    Returns:
        ConnectionLike adapter (SQLiteAdapter or TursoAdapter)
    """
    if config.provider == "turso":
        return TursoAdapter(config.url, config.auth_token)
    else:
        return SQLiteAdapter(config.url)
