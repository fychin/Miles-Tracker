#!/usr/bin/env python3
"""
Vercel Serverless Function Entry Point

This module exposes the Flask application for execution on Vercel's
serverless platform. All API requests are routed through this handler.

For Vercel deployment, set these environment variables:
    DATABASE_PROVIDER: "turso"
    TURSO_DATABASE_URL: "libsql://your-db.turso.io"
    TURSO_AUTH_TOKEN: "your-auth-token"

Note: TURSO_DATABASE_URL is preferred on Vercel (set automatically by the
Turso integration). DATABASE_URL is also accepted as an alias.
"""

import sys
import os

# Add parent directory to path to import server module
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from server import app


def handler(request, response=None):
    """
    Vercel serverless function handler using the Flask test client.

    This delegates the full WSGI request/response cycle to Flask so that
    routing, CORS, headers, and body handling all behave identically to
    local development. The handler returns a dict-shaped response that
    Vercel's Python runtime converts into an HTTP response.

    Args:
        request: Vercel request object with path, method, headers, body
        response: (unused) kept for API compatibility

    Returns:
        Dict with statusCode, headers, and body
    """
    with app.test_client() as client:
        # Extract request details
        path = request.path
        method = request.method
        headers = dict(request.headers)
        body = request.get_data()

        # Make request to Flask app
        response = client.open(
            path,
            method=method,
            headers=headers,
            data=body
        )

        return {
            "statusCode": response.status_code,
            "headers": dict(response.headers),
            "body": response.get_data(as_text=True)
        }
