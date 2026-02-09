# PiKVM Tablet UI

A tablet-optimized web interface for PiKVM V4 devices, designed for touch-first interaction on iPads, Android tablets, and Surface devices.

## What is This?

This is an alternative web frontend for PiKVM that provides:

- **Touch-optimized controls** — designed for tablets, not desktop mice
- **Full-screen video stream** — fills your entire viewport with the remote machine's display
- **On-screen KVM keyboard** — purpose-built for remote machine control with special key combos (Ctrl+Alt+Del, etc.)
- **Absolute & relative mouse modes** — touch-to-point or trackpad-style input
- **ATX power controls** — power on/off/reset from the tablet
- **Mass storage management** — mount ISOs and images remotely
- **Physical keyboard support** — use an attached keyboard with capture mode toggle

This UI runs **alongside** the existing PiKVM web interface, not as a replacement. Access it at `https://YOUR_PIKVM_IP/tablet/`

## Quick Start

**Prerequisites:**
- PiKVM V4 device on your network
- SSH access (default: `root` / `root`)
- Git installed on your local machine

**Installation Summary:**

1. **Clone the repository:**
   ```bash
   git clone https://github.com/freituneir/kvmd-tablet-mode.git
   cd kvmd-tablet-mode
   ```

2. **Copy files to PiKVM:**
   ```bash
   scp -r * root@YOUR_PIKVM_IP:/tmp/tablet
   ```

3. **SSH into PiKVM and install:**
   ```bash
   ssh root@YOUR_PIKVM_IP
   rw  # Make filesystem writable
   cp -r /tmp/tablet /usr/share/kvmd/web/tablet
   chown -R kvmd-nginx:kvmd-nginx /usr/share/kvmd/web/tablet
   chmod -R 755 /usr/share/kvmd/web/tablet
   ```

4. **Configure nginx:**
   ```bash
   nano /etc/kvmd/nginx/kvmd.ctx-server.conf
   ```

   Add this at the end of the file:
   ```nginx
   location /tablet {
       alias /usr/share/kvmd/web/tablet;
       include /etc/kvmd/nginx/loc-nocache.conf;
   }
   ```

   **Important:** Do NOT add `auth_request /auth/check;` — the app handles authentication directly.

5. **Apply changes:**
   ```bash
   mkdir -p /var/log/nginx  # If it doesn't exist
   nginx -t                  # Test config
   systemctl restart kvmd-nginx
   rm -rf /tmp/tablet
   ro                        # Lock filesystem
   ```

6. **Access the UI:**
   Open `https://YOUR_PIKVM_IP/tablet/` on your tablet browser
   - Accept the self-signed SSL certificate warning
   - Log in with your PiKVM credentials (default: `admin` / `admin`)

## Optional: Add to Landing Page

To show a "Tablet" button on the PiKVM home screen:

```bash
# From your local machine (inside the cloned kvmd-tablet-mode directory):
scp assets/icons/tablet.svg root@YOUR_PIKVM_IP:/tmp/tablet.svg

# Then run on PiKVM:
ssh root@YOUR_PIKVM_IP 'rw && \
mkdir -p /usr/share/kvmd/extras/tablet && \
mkdir -p /usr/share/kvmd/web/extras/tablet && \
cp /tmp/tablet.svg /usr/share/kvmd/web/extras/tablet/tablet.svg && \
cat > /usr/share/kvmd/extras/tablet/manifest.yaml << EOF
name: Tablet
description: Tablet-optimized KVM interface
icon: extras/tablet/tablet.svg
path: tablet
place: 5
enabled: true
EOF
systemctl restart kvmd && \
rm /tmp/tablet.svg && \
ro'
```

## Updating

To update the tablet UI with the latest changes from GitHub:

1. **Pull latest changes:**
   ```bash
   cd kvmd-tablet-mode
   git pull
   ```

2. **Copy updated files to PiKVM:**
   ```bash
   scp -r * root@YOUR_PIKVM_IP:/tmp/tablet
   ```

3. **SSH in and apply updates:**
   ```bash
   ssh root@YOUR_PIKVM_IP 'rw && cp -r /tmp/tablet /usr/share/kvmd/web/tablet && chmod -R 755 /usr/share/kvmd/web/tablet && rm -rf /tmp/tablet && ro'
   ```

No need to restart nginx unless config changed.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| **403 Forbidden** | Run: `ssh root@YOUR_PIKVM_IP 'rw && chmod -R 755 /usr/share/kvmd/web/tablet && ro'` |
| **500 Internal Server Error** | Remove `auth_request /auth/check;` from nginx config |
| **404 Not Found** | Verify nginx config exists and restart: `systemctl restart kvmd-nginx` |
| **Blank screen after login** | Open menu → Settings → Switch to "MJPEG" stream mode |
| **nginx -t fails with log error** | Create log dir: `mkdir -p /var/log/nginx` |

## Uninstalling

```bash
ssh root@YOUR_PIKVM_IP
rw
rm -rf /usr/share/kvmd/web/tablet
nano /etc/kvmd/nginx/kvmd.ctx-server.conf  # Remove the location /tablet block
nginx -t && systemctl restart kvmd-nginx
ro
```

## Architecture

- **Pure vanilla JavaScript** — no build system, no npm dependencies
- **Touch-first input handling** — Pointer Events API, gesture recognition
- **WebRTC (H.264) primary, MJPEG fallback** — uses PiKVM's existing Janus gateway
- **Three-layer UI model:**
  - **Layer 1:** Full-screen video stream
  - **Layer 2:** Minimal persistent overlays (top bar, floating mouse panel)
  - **Layer 3:** On-demand panels (keyboard, admin drawer)

## Browser Compatibility

Tested on:
- Safari (iPad/iOS)
- Chrome (Android tablets)
- Edge (Windows tablets/Surface)

Requires HTTPS (self-signed cert is expected).

## License

This project is designed for personal use with PiKVM devices. See the [upstream PiKVM project](https://github.com/pikvm/pikvm) for licensing of the backend components.

## Support

For detailed step-by-step installation instructions, see the full installation guide in the original repository.

For PiKVM-specific issues, refer to the [official PiKVM documentation](https://docs.pikvm.org/).
