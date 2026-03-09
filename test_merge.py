import sqlite3
import os

# Create base DB
if os.path.exists("base.db"): os.remove("base.db")
conn1 = sqlite3.connect("base.db")
conn1.execute("CREATE TABLE todos (id TEXT PRIMARY KEY, text TEXT, updated_at TIMESTAMP)")
conn1.execute("INSERT INTO todos VALUES ('1', 'base', '2020-01-01')")
conn1.execute("INSERT INTO todos VALUES ('2', 'base', '2020-01-03')")
conn1.commit()

# Create import DB
if os.path.exists("import.db"): os.remove("import.db")
conn2 = sqlite3.connect("import.db")
conn2.execute("CREATE TABLE todos (id TEXT PRIMARY KEY, text TEXT, updated_at TIMESTAMP)")
conn2.execute("INSERT INTO todos VALUES ('1', 'import', '2020-01-02')") # newer, should overwrite
conn2.execute("INSERT INTO todos VALUES ('2', 'import', '2020-01-02')") # older, should not overwrite
conn2.execute("INSERT INTO todos VALUES ('3', 'import', '2020-01-02')") # new, should insert
conn2.commit()

# Merge
conn1.execute("ATTACH DATABASE 'import.db' AS import_db")
conn1.execute("""
INSERT INTO todos (id, text, updated_at)
SELECT id, text, updated_at FROM import_db.todos
WHERE true
ON CONFLICT(id) DO UPDATE SET
    text = excluded.text,
    updated_at = excluded.updated_at
WHERE excluded.updated_at > todos.updated_at
""")
conn1.commit()

for row in conn1.execute("SELECT * FROM todos ORDER BY id").fetchall():
    print(row)
