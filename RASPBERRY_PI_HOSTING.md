# Hosting Infinity ToDo on a Raspberry Pi

This guide explains how to host your Infinity ToDo application on a Raspberry Pi using your custom domain (ineedtodo.it) and Cloudflare Tunnels.

## Phase 1: Prepare the App for Production
1. **Create a `requirements.txt` file**: We need a list of the Python packages required to run your app so we can install them on the Pi. 
2. **Push your code to GitHub**: The easiest way to get your code onto the Raspberry Pi is to push your folder to a private GitHub repository, and then `git clone` it onto the Pi.

## Phase 2: Set up the Raspberry Pi
1. **Connect to your Pi**: SSH into your Raspberry Pi terminal (e.g., `ssh pi@192.168.1.x`).
2. **Clone the code**: Run `git clone https://github.com/yourusername/ineedtodoit.git` (or copy the files over using a USB/SFTP).
3. **Install Dependencies**: 
   ```bash
   sudo apt update
   sudo apt install python3-pip python3-venv
   cd ineedtodoit
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```
4. **Create a Systemd Service**: We need the app to automatically start when the Raspberry Pi boots up, and restart if it crashes. 

   Create and open a new `.service` file:
   ```bash
   sudo nano /etc/systemd/system/ineedtodoit.service
   ```
   
   Paste the following configuration (make sure `/home/pi/ineedtodoit` matches your actual project path):
   ```ini
   [Unit]
   Description=Infinity ToDo FastAPI Application
   After=network.target

   [Service]
   User=pi
   Group=www-data
   WorkingDirectory=/home/pi/ineedtodoit
   Environment="PATH=/home/pi/ineedtodoit/venv/bin"
   ExecStart=/home/pi/ineedtodoit/venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000
   Restart=always
   RestartSec=3

   [Install]
   WantedBy=multi-user.target
   ```
   Save and exit `nano` (`Ctrl+O`, `Enter`, `Ctrl+X`).

   Enable and start the service:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl start ineedtodoit
   sudo systemctl enable ineedtodoit
   sudo systemctl status ineedtodoit
   ```

## Phase 3: Connect the Domain (Cloudflare Tunnels)

Connecting your domain (`ineedtodo.it`) using Cloudflare Tunnels is the safest way to expose your application without opening ports on your home router.

### 1. Set up a Cloudflare Account & Move Nameservers
1. Create a free account at [cloudflare.com](https://www.cloudflare.com/).
2. Click **"Add a Site"** and enter your domain name: `ineedtodo.it`.
3. Select the **Free** plan.
4. Cloudflare will give you **two new Nameservers** (e.g., `amy.ns.cloudflare.com` and `bob.ns.cloudflare.com`).
5. Log in to your domain registrar (e.g., Namecheap, GoDaddy).
6. Replace the existing "Nameservers" with the two provided by Cloudflare. (This can take a while to propagate).

### 2. Set up Cloudflare Zero Trust (Tunnels)
1. In the Cloudflare dashboard, go to **Zero Trust** on the left sidebar.
2. Navigate to **Networks** -> **Tunnels**.
3. Click **Create a tunnel**.
4. Give it a name like `infinity-todo-pi` and click **Save tunnel**.

### 3. Install the `cloudflared` Connector on the Pi
1. In the tunnel setup, under **"Install and run a connector"**, select **Debian** and your architecture (likely `64-bit` for newer Raspberry Pis).
2. Copy the provided command block, which looks like:
   ```bash
   curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb && 
   sudo dpkg -i cloudflared.deb && 
   sudo cloudflared service install eyJh...[a very long token string]...
   ```
3. SSH into your Raspberry Pi and **run the copied command**.
4. Once the Cloudflare dashboard shows "Connected" at the bottom, click **Next**.

### 4. Route Public Traffic to Your App
1. On the "Route traffic" page, fill in the **Public Hostname**:
   * **Domain**: Select `ineedtodo.it` from the dropdown.
   * **Subdomain/Path**: Leave blank (unless you specifically want a subdomain like `app.ineedtodo.it`).
2. Fill in the **Service**:
   * **Type**: `HTTP`
   * **URL**: `localhost:8000` (This matches the port your Systemd service runs on).
3. Click **Save hostname**.

Wait a minute, then navigate to `https://ineedtodo.it` in your browser. Your Pi is now securely hosted!

## Phase 4: Updating the App

If you've made changes locally and pushed them to GitHub, follow these steps to update your live Raspberry Pi app:

1. **SSH into your Pi**: `ssh pi@192.168.1.x`
2. **Navigate to the project directory**: `cd ineedtodoit`
3. **Pull the latest changes**: `git pull`
4. **Update Dependencies** (Only necessary if requirements changed):
   ```bash
   source venv/bin/activate
   pip install -r requirements.txt
   ```
5. **Restart the application**: Once the new code is downloaded, apply it by restarting the systemd service:
   ```bash
   sudo systemctl restart ineedtodoit
   ```

6. **Test the Application**: You can verify the application is running smoothly on your Raspberry Pi by checking the service status and logs:
   ```bash
   # Check if the service is running
   sudo systemctl status ineedtodoit

   # Check the latest application logs (look for "Application startup complete")
   sudo journalctl -u ineedtodoit -n 20
   ```
