# Hosting Infinity ToDo on a Raspberry Pi

This guide explains how to host your Infinity ToDo application on a Raspberry Pi using your custom domain (ineedtodo.it) and Cloudflare Tunnels.

## Phase 1: Prepare the App for Production
1. **Create a `requirements.txt` file**: We need a list of the Python packages required to run your app so we can install them on the Pi. 
2. **Push your code to GitHub**: The easiest way to get your code onto the Raspberry Pi is to push your folder to a private GitHub repository, and then `git clone` it onto the Pi.

## Phase 2: Set up the Raspberry Pi
1. **Connect to your Pi**: SSH into your Raspberry Pi terminal (e.g., `ssh pi@192.168.1.x`).
2. **Clone the code**: Run `git clone https://github.com/yourusername/todo-app.git` (or copy the files over using a USB/SFTP).
3. **Install Dependencies**: 
   ```bash
   sudo apt update
   sudo apt install python3-pip python3-venv
   cd todo-app
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```
4. **Create a Systemd Service**: We need the app to automatically start when the Raspberry Pi boots up, and restart if it crashes. We do this by creating a `.service` file. It will essentially run `uvicorn main:app --host 127.0.0.1 --port 8000`.

## Phase 3: Connect the Domain (Cloudflare Tunnels)
1. **Move Name Servers**: Go to your domain registrar (wherever you bought `ineedtodo.it` like Namecheap, GoDaddy, etc.) and change the "Nameservers" to point to Cloudflare. Cloudflare provides a free tier that is perfect for this and helps manage DNS and security.
2. **Create a Tunnel**: Go to the Cloudflare Zero Trust dashboard -> Networks -> Tunnels. Create a new tunnel.
3. **Install Cloudflared on the Pi**: Cloudflare will give you a single command to run on your Raspberry Pi terminal to install the connector. It looks something like: `sudo cloudflared service install ey...`
4. **Route the Traffic**: In the Cloudflare Tunnel dashboard, set up a "Public Hostname":
   * **Domain**: `ineedtodo.it`
   * **Service**: `http://localhost:8000` (This tells Cloudflare to take external traffic hitting your domain and securely route it through the tunnel to your Python server running locally on port 8000 on the Pi).

---
*If you need help generating the `requirements.txt` file or the `todo-app.service` systemd file, just ask!*
