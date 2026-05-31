import os
import logging
from supabase import create_client, Client

logger = logging.getLogger("supabase_client")

# ─── Supabase Configuration ───────────────────────────────────────────────────
# Reads from environment variables set before launching uvicorn.
# Set them via:
#   $env:SUPABASE_URL = "https://yqvjsmemxhbghvipwkap.supabase.co"
#   $env:SUPABASE_KEY = "<your-service-role-key>"  # Service role key for backend (not anon)
SUPABASE_URL: str = os.environ.get("SUPABASE_URL", "https://yqvjsmemxhbghvipwkap.supabase.co")
SUPABASE_KEY: str = os.environ.get("SUPABASE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxdmpzbWVteGhiZ2h2aXB3a2FwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNTM4NzIsImV4cCI6MjA5NTcyOTg3Mn0.3-3g_Gxw78y3FygU1pgOCK5HrOtW4QBQFWej48LGD80")




# Single shared Supabase client instance for the entire backend
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

logger.info(f"Supabase client initialized for project: {SUPABASE_URL}")
