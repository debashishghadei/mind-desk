# Mind Desk Cloud — setup

Mind Desk Cloud is the same Mind Desk, running on a server you control. You log in with a password and a 6-digit code from your phone. Your notes are saved on the server, so the PC browser and the phone show the same notes. On the phone, **Quick idea** (`/capture`) saves an idea in seconds, also without internet.

Organizing works three ways (Settings → AI connection):
- **Organize free with Claude (round trip):** 📤 Send to Claude → organize in the Mind Desk artifact on claude.ai → 📥 Bring back. Uses your Claude plan, no API cost.
- **Your own API key** (Claude or ChatGPT): organize and chat right inside the cloud app. Paid per use; Mind Desk shows the cost and stops at your monthly limit (default $5).
- **Copy & paste** with ChatGPT or Claude, or **Ollama** when you use Mind Desk on the PC where Ollama runs.

The cloud app needs only Node.js 18 or newer. There is nothing to install with npm.

## 1. Try it on your PC first (about 10 minutes)

1. Install Node.js (one time): open **nodejs.org**, download the **LTS** version for Windows, run the installer, and keep clicking **Next**.
2. Unzip `mind-desk-cloud-<version>.zip` into a folder you keep, for example `D:\MindDeskCloud`.
3. Open that folder in File Explorer. Click the address bar, type `cmd`, press **Enter**. A black window opens in that folder.
4. Type `npm start` and press **Enter**. The window shows: *Mind Desk is not set up yet… setup code ABC123…*. Leave this window open while you use Mind Desk.
   - If Windows asks whether Node.js may use the network, click **Allow** (only "Private networks" is needed).
5. In Chrome open **http://localhost:3000**. The setup page opens:
   1. Type the setup code (also in the file `data\SETUP-CODE.txt`), a user name and a password of 12 characters or more.
   2. In an authenticator app on your phone (Google Authenticator, Microsoft Authenticator…) choose **Add account → Enter a setup key**, name it **Mind Desk** and type the key shown. Then type the 6-digit code from the app.
   3. Save the 8 recovery codes (each one logs you in once if you lose your phone).
6. Mind Desk opens. To bring your notes: in the PC version or the artifact use **Download backup**, then here **Settings → Restore from backup…**.

To stop the server, close the black window (or press **Ctrl+C** in it). Your data stays in the `data` folder.

**Phone on the same Wi-Fi (test only):** find the PC's address (in the black window type `ipconfig`, look for *IPv4 Address*, e.g. `192.168.1.20`) and open `http://192.168.1.20:3000/capture` on the phone. Offline saving on the phone needs HTTPS, so it works only on the real server (step 2), not in this test.

## 2. Put it on your server (Hostinger)

You need a hosting plan that can run **Node.js apps** (at Hostinger: Web Unlimited or higher, or a Cloud plan; ask support: *"Can a Node.js app run continuously and write files that persist?"*). Use a subdomain such as `mind.yourdomain.com` with **HTTPS** (free SSL) switched on.

The details of the hosting panel change over time, so I will walk you through it step by step when you have the plan. The settings the app needs are always the same:

| Setting | Value |
|---|---|
| Node.js version | 18 or newer (20 or 22 recommended) |
| App folder | the unzipped `mind-desk-cloud` files (`server.js`, `package.json`, `lib/`, `public/`) |
| Start command | `npm start` (or entry file `server.js`) |
| Port | the panel's port (the app reads `PORT`) |
| `MD_DATA_DIR` | a folder **outside** the app folder, e.g. `/home/USER/mind-desk-data`, so updating the app never touches your notes |
| `MD_TRUST_PROXY` | `1` (default) when the hosting puts HTTPS in front of the app |

First start: open `https://mind.yourdomain.com`, and use the setup code from `MD_DATA_DIR/SETUP-CODE.txt` (open it with the panel's File Manager) or from the app's log.

## Updating

Replace the app files (not the data folder) with the new zip and restart the app. Your notes, login and backups stay in the data folder.

## What is in the data folder

| File / folder | What it is |
|---|---|
| `state.json` | all your notes, items, tasks, chats, Memory, settings |
| `backups/` | a copy each day (last 30), and one before every Bring back and restore (last 20) |
| `captures.json` | quick ideas waiting until Mind Desk is opened |
| `account.json` | your login (password hashed, two-step secret, hashed recovery codes) |
| `sessions.json` | logged-in devices (only hashes) |
| `secrets.json` | your API keys, if you added any (readable only by the app's user) |
| `usage.json` | API cost per month and your monthly limit |

**Lost access?** With a recovery code you can log in without the phone. If you lose the password too, delete `account.json` and `sessions.json` in the data folder (File Manager) and restart the app: setup starts again with a new setup code, and your notes stay.
