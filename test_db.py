import sqlite3
import json
from datetime import datetime, timedelta, timezone

conn = sqlite3.connect('todos.db')
conn.execute("INSERT OR IGNORE INTO users (id, email, name) VALUES ('test_user', 'test@example.com', 'Test User')")

expires = (datetime.now(timezone.utc) + timedelta(days=1)).strftime('%Y-%m-%d %H:%M:%S')
conn.execute("INSERT OR REPLACE INTO sessions (session_token, user_id, expires_at) VALUES ('test_token', 'test_user', ?)", (expires,))

conn.commit()
conn.close()
print("Test user and session created")
