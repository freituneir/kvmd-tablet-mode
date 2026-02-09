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

## Installation

**Prerequisites:**
- PiKVM device with internet access
- SSH access

**All commands run on the PiKVM via SSH.** Nothing needs to be installed on your local machine.

### 1. SSH into PiKVM and download

```bash
ssh root@YOUR_PIKVM_IP
rw
curl -sL https://github.com/freituneir/kvmd-tablet-mode/archive/refs/heads/main.tar.gz | tar xz -C /tmp
```

### 2. Install to web root

```bash
cp -r /tmp/kvmd-tablet-mode-main /usr/share/kvmd/web/tablet
chown -R kvmd-nginx:kvmd-nginx /usr/share/kvmd/web/tablet
chmod -R 755 /usr/share/kvmd/web/tablet
```

### 3. Configure nginx

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

### 4. Apply and lock

```bash
mkdir -p /var/log/nginx
nginx -t
systemctl restart kvmd-nginx
rm -rf /tmp/kvmd-tablet-mode-main
ro
```

### 5. Open the UI

Navigate to `https://YOUR_PIKVM_IP/tablet/` on your tablet browser.

- Accept the self-signed SSL certificate warning
- Log in with your PiKVM credentials (default: `admin` / `admin`)

## Optional: Add to Landing Page

Adds a "Tablet" button to the PiKVM home screen alongside KVM and Terminal. Run this on the PiKVM (after `rw`):

```bash
mkdir -p /usr/share/kvmd/extras/tablet /usr/share/kvmd/web/extras/tablet
cp /usr/share/kvmd/web/tablet/assets/icons/tablet.svg /usr/share/kvmd/web/extras/tablet/tablet.svg
cat > /usr/share/kvmd/extras/tablet/manifest.yaml << 'EOF'
name: Tablet
description: Tablet-optimized KVM interface
icon: extras/tablet/tablet.svg
path: tablet
place: 5
enabled: true
EOF
systemctl restart kvmd
```

## Updating

SSH into the PiKVM and run:

```bash
rw
rm -rf /usr/share/kvmd/web/tablet
curl -sL https://github.com/freituneir/kvmd-tablet-mode/archive/refs/heads/main.tar.gz | tar xz -C /tmp
cp -r /tmp/kvmd-tablet-mode-main /usr/share/kvmd/web/tablet
chown -R kvmd-nginx:kvmd-nginx /usr/share/kvmd/web/tablet
chmod -R 755 /usr/share/kvmd/web/tablet
rm -rf /tmp/kvmd-tablet-mode-main
ro
```

No need to restart nginx or reconfigure it.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| **403 Forbidden** | `rw && chmod -R 755 /usr/share/kvmd/web/tablet && ro` |
| **500 Internal Server Error** | Remove `auth_request /auth/check;` from nginx config, restart nginx |
| **404 Not Found** | Verify nginx config exists and restart: `systemctl restart kvmd-nginx` |
| **Blank screen after login** | Open menu → Settings → Switch to "MJPEG" stream mode |
| **nginx -t fails with log error** | `mkdir -p /var/log/nginx` |

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

For PiKVM-specific issues, refer to the [official PiKVM documentation](https://docs.pikvm.org/).
