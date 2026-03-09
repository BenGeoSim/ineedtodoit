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

@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup logic
    db.init_db()
    
    # Create static dir if it doesn't exist
    if not os.path.exists("static"):
        os.makedirs("static")
    yield

app = FastAPI(lifespan=lifespan)

import json

class TodoCreate(BaseModel):
    id: str
    text: str
    parent_id: Optional[str] = None
    completed: bool = False
    deleted: bool = False
    tags: List[str] = []
    priority: int = 3
    space_id: Optional[str] = None

class TodoUpdate(BaseModel):
    text: Optional[str] = None
    completed: Optional[bool] = None
    deleted: Optional[bool] = None
    tags: Optional[List[str]] = None
    priority: Optional[int] = None

class SharedSpaceCreate(BaseModel):
    name: str = "Shared Space"
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
        idinfo = id_token.verify_oauth2_token(request.credential, requests.Request(), GOOGLE_CLIENT_ID)
        
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
        space = conn.execute("SELECT id FROM shared_spaces WHERE id = ? AND (user1_id = ? OR user2_id = ?)", (space_id, user["id"], user["id"])).fetchone()
        if not space:
            conn.close()
            raise HTTPException(status_code=403, detail="Not authorized for this space")
        rows = conn.execute("SELECT * FROM todos WHERE space_id = ? ORDER BY created_at ASC", (space_id,)).fetchall()
    else:
        rows = conn.execute("SELECT * FROM todos WHERE user_id = ? AND space_id IS NULL ORDER BY created_at ASC", (user["id"],)).fetchall()
        
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
            "completed": bool(r["completed"]),
            "deleted": bool(r["deleted"]),
            "tags": tags,
            "priority": r["priority"],
            "space_id": r["space_id"],
            "updated_at": r["updated_at"]
        })
    return todos

@app.post("/api/todos")
def create_todo(todo: TodoCreate, user: dict = Depends(get_current_user)):
    conn = db.get_db()
    
    if todo.space_id:
        space = conn.execute("SELECT id FROM shared_spaces WHERE id = ? AND (user1_id = ? OR user2_id = ?)", (todo.space_id, user["id"], user["id"])).fetchone()
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
            "INSERT INTO todos (id, user_id, parent_id, text, completed, deleted, tags, priority, space_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (todo.id, user["id"], todo.parent_id, todo.text, todo.completed, todo.deleted, json.dumps(todo.tags), todo.priority, todo.space_id)
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
        LEFT JOIN shared_spaces ss ON t.space_id = ss.id
        WHERE t.id = ? AND ((t.space_id IS NULL AND t.user_id = ?) OR (t.space_id IS NOT NULL AND (ss.user1_id = ? OR ss.user2_id = ?)))
    ''', (todo_id, user["id"], user["id"], user["id"]))
    row = cursor.fetchone()
    if row is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Todo not found or not authorized")
        
    print(f"Row before update: {dict(row)}")
    
    new_text = todo_update.text if todo_update.text is not None else row["text"]
    new_completed = todo_update.completed if todo_update.completed is not None else row["completed"]
    new_deleted = todo_update.deleted if todo_update.deleted is not None else row["deleted"]
    new_priority = todo_update.priority if todo_update.priority is not None else row["priority"]
    
    if todo_update.tags is not None:
        new_tags_json = json.dumps(todo_update.tags)
    else:
        new_tags_json = row["tags"]
    
    conn.execute(
        "UPDATE todos SET text = ?, completed = ?, deleted = ?, tags = ?, priority = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        (new_text, 1 if new_completed else 0, 1 if new_deleted else 0, new_tags_json, new_priority, todo_id)
    )
    conn.commit()
    conn.close()
    
    try:
        new_tags = json.loads(new_tags_json)
    except:
        new_tags = []
        
    return {"id": todo_id, "text": new_text, "completed": new_completed, "deleted": new_deleted, "tags": new_tags, "priority": new_priority, "space_id": row["space_id"]}

@app.delete("/api/todos/{todo_id}")
def delete_todo(todo_id: str, user: dict = Depends(get_current_user)):
    conn = db.get_db()
    # verify ownership or shared space
    row = conn.execute('''
        SELECT t.id FROM todos t
        LEFT JOIN shared_spaces ss ON t.space_id = ss.id
        WHERE t.id = ? AND ((t.space_id IS NULL AND t.user_id = ?) OR (t.space_id IS NOT NULL AND (ss.user1_id = ? OR ss.user2_id = ?)))
    ''', (todo_id, user["id"], user["id"], user["id"])).fetchone()
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
        WHERE ss.user1_id = ? OR ss.user2_id = ?
    ''', (user["id"], user["id"])).fetchall()
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
            "user1_id": r["user1_id"] if "user1_id" in r.keys() else None,
            "user2_id": r["user2_id"] if "user2_id" in r.keys() else None
        })
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
    conn.commit()
    conn.close()
    
    return {"id": space_id, "status": "created"}

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
        
        os.replace(temp_path, db_path)
    except Exception as e:
        if os.path.exists(temp_path):
            os.remove(temp_path)
        raise HTTPException(status_code=500, detail=f"Failed to import database: {str(e)}")
        
    return {"status": "success", "message": "Database successfully replaced"}

import os
# Only mount static files if the directory exists, otherwise the app will crash before startup
if not os.path.exists("static"):
    os.makedirs("static")
app.mount("/", StaticFiles(directory="static", html=True), name="static")

