import contextlib
import os
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Cookie, Depends, FastAPI, HTTPException, Response, UploadFile, File
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import shutil
from fastapi.staticfiles import StaticFiles
from google.auth.transport import requests
from google.oauth2 import id_token
from pydantic import BaseModel
from typing import Optional, List

GOOGLE_CLIENT_ID = "99993409666-hstadhmvo49nkmjg8u9cr6fvjjo05hli.apps.googleusercontent.com"

import db

import asyncio

async def daily_backup_task():
    backup_dir = "backups"
    if not os.path.exists(backup_dir):
        os.makedirs(backup_dir)
    
    while True:
        try:
            date_str = datetime.now().strftime("%Y-%m-%d")
            backup_file = os.path.join(backup_dir, f"todos_backup_{date_str}.db")
            
            # Create safe online backup
            import sqlite3
            conn = db.get_db()
            bck = sqlite3.connect(backup_file)
            with bck:
                conn.backup(bck)
            bck.close()
            conn.close()
            
            # Keep only the last 7 backups
            backups = sorted([f for f in os.listdir(backup_dir) if f.startswith("todos_backup_") and f.endswith(".db")])
            for old_backup in backups[:-7]:
                try:
                    os.remove(os.path.join(backup_dir, old_backup))
                except OSError:
                    pass
        except Exception as e:
            print(f"Error during daily backup: {e}")
            
        # Sleep for 24 hours
        await asyncio.sleep(24 * 60 * 60)

@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup logic
    db.init_db()
    
    # Create static dir if it doesn't exist
    if not os.path.exists("static"):
        os.makedirs("static")
        
    backup_task = asyncio.create_task(daily_backup_task())
    
    yield
    
    backup_task.cancel()
    try:
        await backup_task
    except asyncio.CancelledError:
        pass

app = FastAPI(lifespan=lifespan)

import json

class TodoCreate(BaseModel):
    id: str
    text: str
    description: str = ''
    parent_id: Optional[str] = None
    completed: bool = False
    deleted: bool = False
    tags: List[str] = []
    priority: int = 3
    space_id: Optional[str] = None
    due_date: Optional[str] = None

class TodoUpdate(BaseModel):
    text: Optional[str] = None
    description: Optional[str] = None
    completed: Optional[bool] = None
    deleted: Optional[bool] = None
    tags: Optional[List[str]] = None
    priority: Optional[int] = None
    due_date: Optional[str] = None

class SharedSpaceCreate(BaseModel):
    name: str = "Shared Space"
    email: str

class SharedSpaceUpdate(BaseModel):
    name: str

class SpaceMemberAdd(BaseModel):
    email: str

class SettingsUpdate(BaseModel):
    max_users: int

class GoogleAuthRequest(BaseModel):
    credential: str

async def get_current_user(session_token: Optional[str] = Cookie(None)):
    if not session_token:
        raise HTTPException(status_code=401, detail="Not authenticated")
        
    conn = db.get_db()
    # Delete expired sessions to keep DB clean
    conn.execute("DELETE FROM sessions WHERE expires_at < CURRENT_TIMESTAMP")
    conn.commit()
    
    session = conn.execute("SELECT user_id FROM sessions WHERE session_token = ? AND expires_at > CURRENT_TIMESTAMP", (session_token,)).fetchone()
    user_id = session["user_id"]
    user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    conn.close()
    
    if not session or not user:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
        
    return dict(user)

async def get_current_admin(user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user

@app.post("/api/auth/google")
def google_auth(request: GoogleAuthRequest, response: Response):
    try:
        idinfo = id_token.verify_oauth2_token(request.credential, requests.Request(), GOOGLE_CLIENT_ID, clock_skew_in_seconds=30)
        
        user_id = idinfo['sub']
        email = idinfo['email']
        name = idinfo.get('name', '')
        picture = idinfo.get('picture', '')

        conn = db.get_db()
        
        # Check if user exists
        user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        
        if not user:
            # Check user limit
            max_users_row = conn.execute("SELECT value FROM settings WHERE key = 'max_users'").fetchone()
            max_users_limit = int(max_users_row["value"]) if max_users_row else 10
            
            user_count = conn.execute("SELECT COUNT(*) as count FROM users").fetchone()["count"]
            if user_count >= max_users_limit:
                conn.close()
                raise HTTPException(status_code=403, detail="User limit reached. Cannot register new users.")
                
            # If this is the very first user, they automatically get admin privileges
            new_role = "admin" if user_count == 0 else "user"
            
            # Create new user
            conn.execute(
                "INSERT INTO users (id, email, name, picture, role) VALUES (?, ?, ?, ?, ?)",
                (user_id, email, name, picture, new_role)
            )
            
            # Re-fetch new user
            user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            
        # Create new session
        session_token = secrets.token_urlsafe(32)
        # expire in 7 days
        expires_at = (datetime.now(timezone.utc) + timedelta(days=7)).strftime('%Y-%m-%d %H:%M:%S')
        
        conn.execute(
            "INSERT INTO sessions (session_token, user_id, expires_at) VALUES (?, ?, ?)",
            (session_token, user_id, expires_at)
        )
        conn.commit()
        conn.close()
        
        # Set cookie
        response.set_cookie(
            key="session_token",
            value=session_token,
            httponly=True,
            max_age=7 * 24 * 60 * 60, # 7 days
            samesite="lax",
            secure=False, # Set to True in production with HTTPS
            path="/"
        )
        
        return {"status": "success", "user": {"id": user_id, "name": name, "email": email, "picture": picture, "role": user["role"] if user else "user"}}
        
    except ValueError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {str(e)}")

@app.get("/api/auth/me")
def get_me(user: dict = Depends(get_current_user)):
    return {"user": user}

@app.post("/api/auth/logout")
def logout(response: Response, session_token: Optional[str] = Cookie(None)):
    if session_token:
        conn = db.get_db()
        conn.execute("DELETE FROM sessions WHERE session_token = ?", (session_token,))
        conn.commit()
        conn.close()
    
    # Delete cookie
    response.delete_cookie("session_token", path="/")
    return {"status": "logged_out"}

@app.get("/api/todos")
def get_todos(space_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    conn = db.get_db()
    
    if space_id:
        # verify access to space
        space = conn.execute("SELECT ss.id FROM shared_spaces ss JOIN space_members sm ON ss.id = sm.space_id WHERE ss.id = ? AND sm.user_id = ?", (space_id, user["id"])).fetchone()
        if not space:
            conn.close()
            raise HTTPException(status_code=403, detail="Not authorized for this space")
        rows = conn.execute(
            "SELECT t.*, u.name as creator_name, u.email as creator_email FROM todos t "
            "LEFT JOIN users u ON t.user_id = u.id "
            "WHERE t.space_id = ? ORDER BY t.created_at ASC", 
            (space_id,)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT t.*, u.name as creator_name, u.email as creator_email FROM todos t "
            "LEFT JOIN users u ON t.user_id = u.id "
            "WHERE t.user_id = ? AND t.space_id IS NULL ORDER BY t.created_at ASC", 
            (user["id"],)
        ).fetchall()
        
    conn.close()
    
    todos = []
    for r in rows:
        tags = []
        try:
            tags = json.loads(r["tags"]) if r["tags"] else []
        except Exception:
            pass
            
        todos.append({
            "id": r["id"], 
            "parent_id": r["parent_id"], 
            "text": r["text"],
            "description": r["description"] if "description" in r.keys() else '',
            "completed": bool(r["completed"]),
            "deleted": bool(r["deleted"]),
            "tags": tags,
            "priority": r["priority"],
            "space_id": r["space_id"],
            "created_at": r["created_at"],
            "updated_at": r["updated_at"],
            "creator_name": r["creator_name"] if "creator_name" in r.keys() else None,
            "creator_email": r["creator_email"] if "creator_email" in r.keys() else None,
            "due_date": r["due_date"] if "due_date" in r.keys() else None
        })
    return todos

@app.post("/api/todos")
def create_todo(todo: TodoCreate, user: dict = Depends(get_current_user)):
    conn = db.get_db()
    
    if todo.space_id:
        space = conn.execute("SELECT ss.id FROM shared_spaces ss JOIN space_members sm ON ss.id = sm.space_id WHERE ss.id = ? AND sm.user_id = ?", (todo.space_id, user["id"])).fetchone()
        if not space:
            conn.close()
            raise HTTPException(status_code=403, detail="Not authorized for this space")
            
    # Check if parent exists and belongs to correct context
    if todo.parent_id:
        if todo.space_id:
            parent = conn.execute("SELECT id FROM todos WHERE id = ? AND space_id = ?", (todo.parent_id, todo.space_id)).fetchone()
        else:
            parent = conn.execute("SELECT id FROM todos WHERE id = ? AND user_id = ? AND space_id IS NULL", (todo.parent_id, user["id"])).fetchone()
        if not parent:
            conn.close()
            raise HTTPException(status_code=400, detail="Invalid parent_id or parent does not belong to context")
            
    try:
        conn.execute(
            "INSERT INTO todos (id, user_id, parent_id, text, description, completed, deleted, tags, priority, space_id, due_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (todo.id, user["id"], todo.parent_id, todo.text, todo.description, todo.completed, todo.deleted, json.dumps(todo.tags), todo.priority, todo.space_id, todo.due_date)
        )
        conn.commit()
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=400, detail=str(e))
    conn.close()
    return todo

@app.put("/api/todos/{todo_id}")
def update_todo(todo_id: str, todo_update: TodoUpdate, user: dict = Depends(get_current_user)):
    conn = db.get_db()
    cursor = conn.execute('''
        SELECT t.* FROM todos t
        LEFT JOIN space_members sm ON t.space_id = sm.space_id AND sm.user_id = ?
        WHERE t.id = ? AND ((t.space_id IS NULL AND t.user_id = ?) OR (t.space_id IS NOT NULL AND sm.user_id IS NOT NULL))
    ''', (user["id"], todo_id, user["id"]))
    row = cursor.fetchone()
    if row is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Todo not found or not authorized")
        
    print(f"Row before update: {dict(row)}")
    
    new_text = todo_update.text if todo_update.text is not None else row["text"]
    new_description = todo_update.description if todo_update.description is not None else (row["description"] if "description" in row.keys() else '')
    new_completed = todo_update.completed if todo_update.completed is not None else row["completed"]
    new_deleted = todo_update.deleted if todo_update.deleted is not None else row["deleted"]
    new_priority = todo_update.priority if todo_update.priority is not None else row["priority"]
    new_due_date = todo_update.due_date if todo_update.due_date is not None else (row["due_date"] if "due_date" in row.keys() else None)
    # Allow explicitly clearing due_date by sending empty string
    if todo_update.due_date == '':
        new_due_date = None

    if todo_update.tags is not None:
        new_tags_json = json.dumps(todo_update.tags)
    else:
        new_tags_json = row["tags"]

    conn.execute(
        "UPDATE todos SET text = ?, description = ?, completed = ?, deleted = ?, tags = ?, priority = ?, due_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        (new_text, new_description, 1 if new_completed else 0, 1 if new_deleted else 0, new_tags_json, new_priority, new_due_date, todo_id)
    )
    conn.commit()
    conn.close()

    try:
        new_tags = json.loads(new_tags_json)
    except:
        new_tags = []

    return {"id": todo_id, "text": new_text, "description": new_description, "completed": new_completed, "deleted": new_deleted, "tags": new_tags, "priority": new_priority, "space_id": row["space_id"], "due_date": new_due_date}

@app.delete("/api/todos/{todo_id}")
def delete_todo(todo_id: str, user: dict = Depends(get_current_user)):
    conn = db.get_db()
    # verify ownership or shared space
    row = conn.execute('''
        SELECT t.id FROM todos t
        LEFT JOIN space_members sm ON t.space_id = sm.space_id AND sm.user_id = ?
        WHERE t.id = ? AND ((t.space_id IS NULL AND t.user_id = ?) OR (t.space_id IS NOT NULL AND sm.user_id IS NOT NULL))
    ''', (user["id"], todo_id, user["id"])).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Todo not found or not authorized")
        
    conn.execute("DELETE FROM todos WHERE id = ?", (todo_id,))
    conn.commit()
    conn.close()
    return {"status": "deleted"}

@app.get("/api/shared_spaces")
def get_shared_spaces(user: dict = Depends(get_current_user)):
    conn = db.get_db()
    rows = conn.execute('''
        SELECT ss.id, ss.name, ss.created_at,
               u1.email as user1_email, u2.email as user2_email,
               u1.name as user1_name, u2.name as user2_name,
               u1.picture as user1_picture, u2.picture as user2_picture
        FROM shared_spaces ss
        JOIN users u1 ON ss.user1_id = u1.id
        JOIN users u2 ON ss.user2_id = u2.id
        JOIN space_members sm ON ss.id = sm.space_id
        WHERE sm.user_id = ?
    ''', (user["id"],)).fetchall()

    spaces = []
    for r in rows:
        members = conn.execute('''
            SELECT u.id, u.email, u.name, u.picture
            FROM space_members sm
            JOIN users u ON sm.user_id = u.id
            WHERE sm.space_id = ?
            ORDER BY sm.joined_at ASC
        ''', (r["id"],)).fetchall()
        spaces.append({
            "id": r["id"],
            "name": r["name"],
            "created_at": r["created_at"],
            "user1_email": r["user1_email"],
            "user2_email": r["user2_email"],
            "user1_name": r["user1_name"],
            "user2_name": r["user2_name"],
            "user1_picture": r["user1_picture"],
            "user2_picture": r["user2_picture"],
            "members": [{"id": m["id"], "email": m["email"], "name": m["name"], "picture": m["picture"]} for m in members]
        })
    conn.close()
    return spaces

@app.post("/api/shared_spaces")
def create_shared_space(req: SharedSpaceCreate, user: dict = Depends(get_current_user)):
    conn = db.get_db()
    if req.email == user["email"]:
        conn.close()
        raise HTTPException(status_code=400, detail="Cannot share with yourself")
        
    other_user = conn.execute("SELECT id FROM users WHERE email = ?", (req.email,)).fetchone()
    if not other_user:
        conn.close()
        raise HTTPException(status_code=404, detail="User not found")
        
    import uuid
    space_id = str(uuid.uuid4())
    conn.execute(
        "INSERT INTO shared_spaces (id, name, user1_id, user2_id) VALUES (?, ?, ?, ?)",
        (space_id, req.name, user["id"], other_user["id"])
    )
    conn.execute("INSERT OR IGNORE INTO space_members (space_id, user_id) VALUES (?, ?)", (space_id, user["id"]))
    conn.execute("INSERT OR IGNORE INTO space_members (space_id, user_id) VALUES (?, ?)", (space_id, other_user["id"]))
    conn.commit()
    conn.close()

    return {"id": space_id, "status": "created"}

@app.put("/api/shared_spaces/{space_id}")
def update_shared_space(space_id: str, req: SharedSpaceUpdate, user: dict = Depends(get_current_user)):
    conn = db.get_db()
    
    # Verify user is part of the space
    space = conn.execute(
        "SELECT ss.id FROM shared_spaces ss JOIN space_members sm ON ss.id = sm.space_id WHERE ss.id = ? AND sm.user_id = ?",
        (space_id, user["id"])
    ).fetchone()
    
    if not space:
        conn.close()
        raise HTTPException(status_code=403, detail="Not authorized for this space")
        
    conn.execute(
        "UPDATE shared_spaces SET name = ? WHERE id = ?",
        (req.name, space_id)
    )
    conn.commit()
    conn.close()
    
    return {"status": "success", "name": req.name}

@app.post("/api/shared_spaces/{space_id}/members")
def add_space_member(space_id: str, req: SpaceMemberAdd, user: dict = Depends(get_current_user)):
    conn = db.get_db()

    membership = conn.execute(
        "SELECT 1 FROM space_members WHERE space_id = ? AND user_id = ?",
        (space_id, user["id"])
    ).fetchone()
    if not membership:
        conn.close()
        raise HTTPException(status_code=403, detail="Not authorized for this space")

    if req.email == user["email"]:
        conn.close()
        raise HTTPException(status_code=400, detail="Cannot add yourself")

    new_user = conn.execute("SELECT id FROM users WHERE email = ?", (req.email,)).fetchone()
    if not new_user:
        conn.close()
        raise HTTPException(status_code=404, detail="User not found. They must sign in first.")

    existing = conn.execute(
        "SELECT 1 FROM space_members WHERE space_id = ? AND user_id = ?",
        (space_id, new_user["id"])
    ).fetchone()
    if existing:
        conn.close()
        raise HTTPException(status_code=400, detail="User is already a member")

    conn.execute(
        "INSERT INTO space_members (space_id, user_id) VALUES (?, ?)",
        (space_id, new_user["id"])
    )
    conn.commit()
    conn.close()
    return {"status": "added"}

# Admin Routes
@app.get("/api/admin/users")
def get_users(admin_user: dict = Depends(get_current_admin)):
    conn = db.get_db()
    
    # Get users along with their active todo counts
    users = conn.execute('''
        SELECT u.id, u.email, u.name, u.picture, u.role, u.created_at,
               (SELECT COUNT(*) FROM todos WHERE user_id = u.id AND deleted = 0) as todo_count
        FROM users u
        ORDER BY u.created_at DESC
    ''').fetchall()
    
    conn.close()
    return {"users": [dict(u) for u in users]}

@app.delete("/api/admin/users/{user_id}")
def delete_user(user_id: str, admin_user: dict = Depends(get_current_admin)):
    if user_id == admin_user["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
        
    conn = db.get_db()
    # PRAGMA foreign_keys = ON handles cascading deletes for sessions and todos mapped to this user
    cursor = conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
    if cursor.rowcount == 0:
        conn.close()
        raise HTTPException(status_code=404, detail="User not found")
        
    conn.commit()
    conn.close()
    return {"status": "success", "message": "User deleted"}

@app.get("/api/admin/settings")
def get_settings(admin_user: dict = Depends(get_current_admin)):
    conn = db.get_db()
    max_users_row = conn.execute("SELECT value FROM settings WHERE key = 'max_users'").fetchone()
    conn.close()
    return {
        "max_users": int(max_users_row["value"]) if max_users_row else 10
    }

@app.put("/api/admin/settings")
def update_settings(settings: SettingsUpdate, admin_user: dict = Depends(get_current_admin)):
    if settings.max_users < 1:
        raise HTTPException(status_code=400, detail="max_users must be at least 1")
        
    conn = db.get_db()
    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('max_users', ?) ON CONFLICT(key) DO UPDATE SET value = ?",
        (str(settings.max_users), str(settings.max_users))
    )
    conn.commit()
    conn.close()
    return {"status": "success"}

@app.get("/api/admin/spaces")
def get_admin_spaces(admin_user: dict = Depends(get_current_admin)):
    conn = db.get_db()
    rows = conn.execute('''
        SELECT ss.id, ss.name, ss.created_at,
               u1.email as user1_email, u2.email as user2_email,
               u1.name as user1_name, u2.name as user2_name,
               u1.picture as user1_picture, u2.picture as user2_picture,
               (SELECT COUNT(*) FROM todos WHERE space_id = ss.id AND deleted = 0) as todo_count
        FROM shared_spaces ss
        JOIN users u1 ON ss.user1_id = u1.id
        JOIN users u2 ON ss.user2_id = u2.id
        ORDER BY ss.created_at DESC
    ''').fetchall()
    conn.close()
    
    spaces = []
    for r in rows:
        spaces.append({
            "id": r["id"],
            "name": r["name"],
            "created_at": r["created_at"],
            "user1_email": r["user1_email"],
            "user2_email": r["user2_email"],
            "user1_name": r["user1_name"],
            "user2_name": r["user2_name"],
            "user1_picture": r["user1_picture"],
            "user2_picture": r["user2_picture"],
            "todo_count": r["todo_count"]
        })
    return {"spaces": spaces}

@app.delete("/api/admin/spaces/{space_id}")
def delete_admin_space(space_id: str, admin_user: dict = Depends(get_current_admin)):
    conn = db.get_db()
    cursor = conn.execute("DELETE FROM shared_spaces WHERE id = ?", (space_id,))
    if cursor.rowcount == 0:
        conn.close()
        raise HTTPException(status_code=404, detail="Space not found")
        
    conn.commit()
    conn.close()
    return {"status": "success", "message": "Space deleted"}

@app.get("/api/admin/database/export")
def export_database(admin_user: dict = Depends(get_current_admin)):
    db_path = db.DB_PATH
    if not os.path.exists(db_path):
        raise HTTPException(status_code=404, detail="Database file not found")
    return FileResponse(path=db_path, filename="todos_backup.db", media_type="application/octet-stream")

@app.post("/api/admin/database/import")
def import_database(file: UploadFile = File(...), admin_user: dict = Depends(get_current_admin)):
    if not file.filename.endswith(".db"):
        raise HTTPException(status_code=400, detail="Must be a .db file")
    
    db_path = db.DB_PATH
    temp_path = db_path + ".tmp"
    
    try:
        with open(temp_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        conn = db.get_db()
        cursor = conn.cursor()
        cursor.execute(f"ATTACH DATABASE ? AS import_db", (temp_path,))
        
        # Merge settings
        cursor.execute('''
            INSERT INTO settings (key, value)
            SELECT key, value FROM import_db.settings
            WHERE true
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
        ''')
        
        # Merge users
        cursor.execute('''
            INSERT INTO users (id, email, name, picture, role, created_at)
            SELECT id, email, name, picture, role, created_at FROM import_db.users
            WHERE true
            ON CONFLICT(id) DO UPDATE SET
                email = excluded.email,
                name = excluded.name,
                picture = excluded.picture,
                role = excluded.role,
                created_at = excluded.created_at
        ''')
        
        # Merge shared_spaces
        cursor.execute('''
            INSERT INTO shared_spaces (id, name, user1_id, user2_id, created_at)
            SELECT id, name, user1_id, user2_id, created_at FROM import_db.shared_spaces
            WHERE true
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                user1_id = excluded.user1_id,
                user2_id = excluded.user2_id,
                created_at = excluded.created_at
        ''')
        
        # Merge todos based on updated_at
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
        cursor.close()
        conn.close()
        
        import gc
        gc.collect() # Force garbage collection sometimes needed in Windows for sqlite3 files
        
        try:
            os.remove(temp_path)
        except Exception:
            pass
    except Exception as e:
        error_msg = str(e)
        try:
            if os.path.exists(temp_path):
                os.remove(temp_path)
        except Exception:
            pass
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to merge database: {error_msg}")
        
    return {"status": "success", "message": "Database successfully merged"}

import os
# Only mount static files if the directory exists, otherwise the app will crash before startup
if not os.path.exists("static"):
    os.makedirs("static")
app.mount("/", StaticFiles(directory="static", html=True), name="static")

