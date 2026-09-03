# Serverless Deployment Guide

This guide covers deploying the Miles & Points Tracker to Vercel with Turso as the database backend.

## Quick Start

### Local Development (SQLite - Default)

```bash
# No configuration needed - uses data/tracker.db automatically
python server.py
```

### Production Deployment (Turso + Vercel)

## Step 1: Set Up Turso Database

1. **Create a Turso account** at https://turso.tech

2. **Install Turso CLI** (optional but recommended):
   ```bash
   curl -sSfL https://get.tur.so/install.sh | bash
   ```

3. **Create a new database**:
   ```bash
   turso db create miles-tracker
   ```

4. **Get your database URL**:
   ```bash
   turso db show miles-tracker --url
   # Output: libsql://your-db-name.turso.io
   ```

5. **Create an authentication token**:
   ```bash
   turso tokens create miles-tracker-token
   # Save this token - you'll need it for Vercel
   ```

## Step 2: Migrate Your Data

1. **Export data from your local SQLite database**:
   ```bash
   # Make sure your local server is running
   curl http://localhost:3000/api/export > miles-tracker-export.json
   ```

2. **Deploy to Vercel first** (see Step 3) with temporary empty Turso DB

3. **Import data to Turso**:
   ```bash
   curl -X POST \
     -H "Content-Type: application/json" \
     -d @miles-tracker-export.json \
     "https://your-app.vercel.app/api/import?reset=true"
   ```

## Step 3: Deploy to Vercel

1. **Install Vercel CLI**:
   ```bash
   npm install -g vercel
   ```

2. **Login to Vercel**:
   ```bash
   vercel login
   ```

3. **Deploy**:
   ```bash
   vercel
   ```

4. **Set environment variables** in Vercel Dashboard:
   - Go to your project settings → Environment Variables
   - Add the following:
     ```
     DATABASE_PROVIDER=turso
     DATABASE_URL=libsql://your-db-name.turso.io
     TURSO_AUTH_TOKEN=your-auth-token-here
     ```

5. **Redeploy** with environment variables:
   ```bash
   vercel --prod
   ```

## Environment Variables Reference

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `DATABASE_PROVIDER` | Database driver: `sqlite`, `turso`, or `auto` | No | `auto` |
| `DATABASE_URL` | Connection URL (libsql:// for Turso, or file path for SQLite) | No | `data/tracker.db` |
| `TURSO_AUTH_TOKEN` | Authentication token for Turso | Yes (for Turso) | - |
| `FLASK_DEBUG` | Enable Flask debug mode | No | `0` |
| `PORT` | Local development port | No | `3000` |

## Testing Locally with Turso

You can test your Turso connection locally before deploying:

```bash
export DATABASE_PROVIDER=turso
export DATABASE_URL=libsql://your-db.turso.io
export TURSO_AUTH_TOKEN=your-token

python server.py
```

## Vercel Project Structure

```
miles-tracker/
├── api/
│   └── index.py          # Vercel serverless function entry point
├── static/               # Frontend assets (served by Vercel)
├── config.py             # Environment configuration
├── db_driver.py          # Database abstraction layer
├── db.py                 # Database access layer
├── server.py             # Flask application
├── vercel.json           # Vercel configuration
└── requirements.txt      # Python dependencies
```

## Troubleshooting

### Import Errors
If you see `ImportError: cannot import name 'libsql'`:
```bash
pip install libsql-client>=0.3.0
```

### Connection Refused
Make sure your Turso auth token is correct and the database URL is valid.

### Vercel Build Fails
Check the Vercel build logs in the dashboard. Common issues:
- Missing dependencies in `requirements.txt`
- Environment variables not set correctly

### Data Not Persisting
Verify that:
- `DATABASE_PROVIDER` is set to `turso`
- `TURSO_AUTH_TOKEN` is valid
- Database schema was created (check Vercel logs for `init_db` success)

## Rollback to SQLite

If you need to switch back to SQLite:

```bash
# In Vercel dashboard, set:
DATABASE_PROVIDER=sqlite
# Or remove the variable entirely (defaults to auto-detect)
```

## Cost Considerations

- **Turso Free Tier**: 9GB storage, 500M row reads/month, 50M row writes/month
- **Vercel Free Tier**: 100GB bandwidth/month, unlimited serverless function executions

Monitor your usage in both dashboards to avoid unexpected charges.
