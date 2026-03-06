import sqlite3
conn = sqlite3.connect('todos.db')
cursor = conn.cursor()
cursor.execute("PRAGMA table_info(todos)")
columns = cursor.fetchall()
print("Columns in 'todos':")
for col in columns:
    print(col)
conn.close()
