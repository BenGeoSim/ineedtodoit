# Cloudflare Cache Busting Guide

When hosting an application behind Cloudflare (like we are doing with the Raspberry Pi tunnel), Cloudflare aggressive caches static files like `app.js` and `styles.css`. 

This is great for performance, but it means that when you update your code and deploy it, Cloudflare might continue serving the old files to users.

Here are the ways to solve this issue, ranging from simple manual fixes to full automation.

---

## Option 1: Manual Version Bumping (The Easiest Way)
Whenever you make changes to `app.js` or `styles.css` that you are about to push to the Raspberry Pi, simply go into `static/index.html` and bump the version number in the script/style tags. 

Change `?v=1.1` to `?v=1.2`, then `?v=1.3`, etc.

```html
<!-- Example of bumping version from 1.1 to 1.2 -->
<link rel="stylesheet" href="styles.css?v=1.2">
<script src="app.js?v=1.2"></script>
```

This ensures that the browser and Cloudflare treat the updated file as a completely new asset, forcing them to pull the latest logic. You only need to bump the version when you've made changes to the respective file.

---

## Option 2: Purge Cloudflare Cache
If you forgot to bump the version number and want an immediate fix without modifying code:

1. Log in to your [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Select your domain (`ineedtodo.it`).
3. On the left sidebar, click **Caching** -> **Configuration**.
4. Click the large blue **Purge Everything** button.

*Note: This clears Cloudflare's server cache. If the user's local browser has already cached the file, they might still need to do a hard refresh (`Ctrl + Shift + R` or `Cmd + Shift + R`) to pull the new version. Option 1 prevents this.*

---

## Option 3: Development Mode (For Heavy Editing Sessions)
If you are doing a heavy session of updates and deploying to the Pi continuously over a few hours:

1. Log in to your Cloudflare Dashboard.
2. Go to **Caching** -> **Configuration**.
3. Scroll down and toggle **Development Mode** ON.

This temporarily bypasses the cache entirely for 3 hours, meaning any changes you push will be live instantly. After 3 hours, Cloudflare automatically turns it back off.

---

## Option 4: Full Automation with Jinja2 (Advanced)
If you are tired of manually bumping the version strings in `index.html`, we can automate it by changing FastAPI from serving a static HTML file to dynamically generating the HTML using `Jinja2Templates`.

*(This is currently not implemented, but we can if you want!)*

Instead of this basic route:
```python
app.mount("/", StaticFiles(directory="static", html=True), name="static")
```

The server would theoretically inject a random timestamp directly into the HTML every time it's requested:
```python
from fastapi.templating import Jinja2Templates
import time

templates = Jinja2Templates(directory="static")

@app.get("/")
def read_root(request: Request):
    # Inject the current server timestamp to permanently bust caches
    return templates.TemplateResponse("index.html", {
        "request": request,
        "v": int(time.time()) 
    })
```
And the frontend `index.html` would be converted to a template:
```html
<script src="app.js?v={{ v }}"></script>
```
This forces browsers and Cloudflare to load the newest JavaScript every single time the page is refreshed.
