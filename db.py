import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "todos.db")

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    # Enable foreign keys so ON DELETE CASCADE works
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def init_db():
    conn = get_db()
    conn.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            name TEXT,
            picture TEXT,
            role TEXT DEFAULT 'user',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    conn.execute('''
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    ''')
    
    # Initialize default settings if not exists
    conn.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('max_users', '10')")
    
    conn.execute('''
        CREATE TABLE IF NOT EXISTS sessions (
            session_token TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            expires_at TIMESTAMP NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    ''')

    conn.execute('''
        CREATE TABLE IF NOT EXISTS shared_spaces (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL DEFAULT 'Shared Space',
            user1_id TEXT NOT NULL,
            user2_id TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user1_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY(user2_id) REFERENCES users(id) ON DELETE CASCADE
        )
    ''')

    conn.execute('''
        CREATE TABLE IF NOT EXISTS space_members (
            space_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (space_id, user_id),
            FOREIGN KEY(space_id) REFERENCES shared_spaces(id) ON DELETE CASCADE,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    ''')

    # Migrate existing spaces into space_members
    conn.execute('''
        INSERT OR IGNORE INTO space_members (space_id, user_id)
        SELECT id, user1_id FROM shared_spaces
    ''')
    conn.execute('''
        INSERT OR IGNORE INTO space_members (space_id, user_id)
        SELECT id, user2_id FROM shared_spaces
    ''')

    conn.execute('''
        CREATE TABLE IF NOT EXISTS todos (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            parent_id TEXT,
            text TEXT NOT NULL,
            description TEXT DEFAULT '',
            completed BOOLEAN NOT NULL DEFAULT 0,
            deleted BOOLEAN NOT NULL DEFAULT 0,
            tags TEXT DEFAULT '[]',
            priority INTEGER NOT NULL DEFAULT 3,
            space_id TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY(parent_id) REFERENCES todos(id) ON DELETE CASCADE,
            FOREIGN KEY(space_id) REFERENCES shared_spaces(id) ON DELETE CASCADE
        )
    ''')
    
    cursor = conn.execute("PRAGMA table_info(shared_spaces)")
    shared_space_columns = [row["name"] for row in cursor.fetchall()]
    if "name" not in shared_space_columns:
        conn.execute("ALTER TABLE shared_spaces ADD COLUMN name TEXT NOT NULL DEFAULT 'Shared Space'")

    # Run migrations for todos
    cursor = conn.execute("PRAGMA table_info(todos)")
    columns = [row["name"] for row in cursor.fetchall()]
    if "user_id" not in columns:
        conn.execute("ALTER TABLE todos ADD COLUMN user_id TEXT NOT NULL DEFAULT 'unknown'")
    if "parent_id" not in columns:
        conn.execute("ALTER TABLE todos ADD COLUMN parent_id TEXT")
    if "completed" not in columns:
        conn.execute("ALTER TABLE todos ADD COLUMN completed BOOLEAN NOT NULL DEFAULT 0")
    if "deleted" not in columns:
        conn.execute("ALTER TABLE todos ADD COLUMN deleted BOOLEAN NOT NULL DEFAULT 0")
    if "tags" not in columns:
        conn.execute("ALTER TABLE todos ADD COLUMN tags TEXT DEFAULT '[]'")
    if "priority" not in columns:
        conn.execute("ALTER TABLE todos ADD COLUMN priority INTEGER NOT NULL DEFAULT 3")
    if "space_id" not in columns:
        conn.execute("ALTER TABLE todos ADD COLUMN space_id TEXT REFERENCES shared_spaces(id) ON DELETE CASCADE")
    if "updated_at" not in columns:
        conn.execute("ALTER TABLE todos ADD COLUMN updated_at TIMESTAMP")
        conn.execute("UPDATE todos SET updated_at = created_at")
    if "description" not in columns:
        conn.execute("ALTER TABLE todos ADD COLUMN description TEXT DEFAULT ''")
    # Migration: Add role column to users if it doesn't exist
    user_columns = [info['name'] for info in conn.execute("PRAGMA table_info(users)").fetchall()]
    if 'role' not in user_columns:
        conn.execute("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'")
        
        # Make the very first created user an admin during migration
        first_user = conn.execute("SELECT id FROM users ORDER BY created_at ASC LIMIT 1").fetchone()
        if first_user:
            conn.execute("UPDATE users SET role = 'admin' WHERE id = ?", (first_user['id'],))
        
    conn.commit()
    conn.close()
