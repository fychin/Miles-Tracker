#!/usr/bin/env python3
"""
Vercel Serverless Function Entry Point

This module wraps the Flask application for execution on Vercel's
serverless platform. All API requests are routed through this handler.

For Vercel deployment, set these environment variables:
    DATABASE_PROVIDER: "turso"
    DATABASE_URL: "libsql://your-db.turso.io"
    TURSO_AUTH_TOKEN: "your-auth-token"
"""

import sys
import os

# Add parent directory to path to import server module
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from server import app


def handler(request):
    """
    Vercel serverless function handler.
    
    Args:
        request: Vercel request object with path, method, headers, body
        
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
