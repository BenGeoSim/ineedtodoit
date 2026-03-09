import sqlite3
import os
import db
import shutil

db_path = db.DB_PATH
temp_path = db_path + ".tmp"
shutil.copy("test_backup.db", temp_path)

conn = db.get_db()
cursor = conn.cursor()
try:
    cursor.execute(f"ATTACH DATABASE ? AS import_db", (temp_path,))
    cursor.execute('''
        INSERT INTO settings (key, value)
        SELECT key, value FROM import_db.settings
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
    ''')
    cursor.execute('''
        INSERT INTO users (id, email, name, picture, role, created_at)
        SELECT id, email, name, picture, role, created_at FROM import_db.users
        ON CONFLICT(id) DO UPDATE SET
            email = excluded.email,
            name = excluded.name,
            picture = excluded.picture,
            role = excluded.role,
            created_at = excluded.created_at
    ''')
    cursor.execute('''
        INSERT INTO shared_spaces (id, name, user1_id, user2_id, created_at)
        SELECT id, name, user1_id, user2_id, created_at FROM import_db.shared_spaces
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            user1_id = excluded.user1_id,
            user2_id = excluded.user2_id,
            created_at = excluded.created_at
    ''')
    cursor.execute('''
        INSERT INTO todos (id, user_id, parent_id, text, completed, deleted, tags, priority, space_id, created_at, updated_at)
        SELECT id, user_id, parent_id, text, completed, deleted, tags, priority, space_id, created_at, updated_at 
        FROM import_db.todos
        WHERE true
        ON CONFLICT(id) DO UPDATE SET
            user_id = excluded.user_id,
            parent_id = excluded.parent_id,
            text = excluded.text,
            completed = excluded.completed,
            deleted = excluded.deleted,
            tags = excluded.tags,
            priority = excluded.priority,
            space_id = excluded.space_id,
            updated_at = excluded.updated_at
        WHERE excluded.updated_at > todos.updated_at OR todos.updated_at IS NULL
    ''')
    conn.commit()
    cursor.execute("DETACH DATABASE import_db")
finally:
    cursor.close()
    conn.close()
    
print("Success!")
