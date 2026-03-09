import requests
import os
import json

BASE_URL = "http://localhost:8000"
SESSION_COOKIE = None

# We can query the SQLite DB directly to get an admin token if the /api/auth endpoints are hard to hit
import sqlite3
import datetime
import secrets

def get_admin_token():
    conn = sqlite3.connect("todos.db")
    conn.row_factory = sqlite3.Row
    # Find an admin user or create one
    admin = conn.execute("SELECT id FROM users WHERE role = 'admin' LIMIT 1").fetchone()
    if not admin:
        print("No admin user found. Creating dummy admin...")
        conn.execute("INSERT INTO users (id, email, name, role) VALUES ('admin123', 'admin@example.com', 'Admin', 'admin')")
        admin_id = 'admin123'
    else:
        admin_id = admin['id']
        
    token = secrets.token_urlsafe(32)
    expires = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=1)).strftime('%Y-%m-%d %H:%M:%S')
    conn.execute("INSERT INTO sessions (session_token, user_id, expires_at) VALUES (?, ?, ?)", (token, admin_id, expires))
    conn.commit()
    conn.close()
    return {"session_token": token}

cookies = get_admin_token()

# 1. Export the database
print("Test 1: Exporting DB...")
res = requests.get(f"{BASE_URL}/api/admin/database/export", cookies=cookies)
if res.status_code == 200:
    with open("test_backup.db", "wb") as f:
        f.write(res.content)
    print("Export successful, saved test_backup.db")
else:
    print("Export failed:", res.text)
    exit(1)

# 2. Modify something realistically? We can skip and just test import works
print("Test 2: Importing DB...")
with open("test_backup.db", "rb") as f:
    files = {"file": ("test_backup.db", f, "application/octet-stream")}
    res = requests.post(f"{BASE_URL}/api/admin/database/import", cookies=cookies, files=files)
    if res.status_code == 200:
        print("Import successful!")
    else:
        print("Import failed:", res.text)
        
os.remove("test_backup.db")
