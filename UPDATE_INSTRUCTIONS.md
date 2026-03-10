# How to Update the Raspberry Pi Infinity ToDo App

Whenever you make changes to the code on your main computer and push them to GitHub, follow these exact steps to deploy the update to your live Raspberry Pi server.

## Step 1: Connect to the Raspberry Pi
Open your terminal (PowerShell, Command Prompt, or any terminal) on your computer and connect via SSH:
```bash
ssh pi@192.168.1.x
```
*(Note: Replace `192.168.1.x` with the actual IP address of your Raspberry Pi.)*

## Step 2: Navigate to the Project Folder
Once logged in, go to the folder where the application is stored:
```bash
cd ineedtodoit
```

## Step 3: Download the Latest Code
Pull your newest changes from GitHub:
```bash
git pull origin main
```
*(If your branch is named `master` instead of `main`, use `git pull origin master`.)*

## Step 4: Update the Code Dependencies (Only if necessary)
If you added new packages to the `requirements.txt` file, you need to install them on the Pi:
```bash
source venv/bin/activate
pip install -r requirements.txt
```

## Step 5: Restart the Application
Apply the new code changes by restarting the background service:
```bash
sudo systemctl restart ineedtodoit
```

## Step 6: Verify the Update
Check the status of the service to ensure it restarted correctly and isn't throwing errors:
```bash
sudo systemctl status ineedtodoit
```

Alternatively, to see the live application logs and confirm it says "Application startup complete", run:
```bash
sudo journalctl -u ineedtodoit -n 20
```

You're all done! Your website should now be updated with the latest code.
