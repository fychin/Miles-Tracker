#!/usr/bin/env python3
"""
Vercel Serverless Function Entry Point
"""

import sys
import os
import json
import traceback
from datetime import datetime

from server import app


def _to_bytes(value: object) -> bytes:
    if isinstance(value, (bytes, bytearray)):
        return bytes(value)
    if isinstance(value, str):
        return value.encode("utf-8")
    # Fallback: convert via str()
    return str(value).encode("utf-8")


def handler(request, response=None):
    """
    Vercel serverless function handler using the Flask test client.

    This wrapper is robust to the shape of the incoming request object, which
    may be a dict-like event from the platform or a Flask Request object.

    Returns a dict in shape { statusCode, headers, body } which the
    Vercel Python runtime translates into an HTTP response.
    """
    try:
        # Normalize input to something Flask test_client can consume
        if isinstance(request, dict):
            path = request.get("path", "/")
            method = (request.get("method") or "GET").upper()
            headers = dict(request.get("headers") or {})
            body = request.get("body") or b""
            if isinstance(body, (dict, list)):
                body = json.dumps(body).encode("utf-8")
        else:
            path = getattr(request, "path", "/")
            method = getattr(request, "method", "GET").upper()
            headers = dict(request.headers) if hasattr(request, "headers") else {}
            body = request.get_data() if hasattr(request, "get_data") else b""

        # Health check endpoint for quick reachability tests
        if path in ("/health", "/api/health"):
            ts = datetime.utcnow().isoformat()
            return {
                "statusCode": 200,
                "headers": {"Content-Type": "application/json"},
                "body": json.dumps({"status": "ok", "ts": ts})
            }

        with app.test_client() as client:
            resp = client.open(path, method=method, headers=headers, data=body)
            return {
                "statusCode": resp.status_code,
                "headers": dict(resp.headers),
                "body": resp.get_data(as_text=True)
            }
    except Exception as e:
        tb = traceback.format_exc()
        return {
            "statusCode": 500,
            "headers": {"Content-Type": "text/plain"},
            "body": f"Internal server error: {str(e)}\\n{tb}"
        }


if __name__ == "__main__":  # Local test helper (not used by Vercel)
    print("api/index.py entry point for Vercel.")
