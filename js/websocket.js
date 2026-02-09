"use strict";

// WebSocket connection to KVMD /api/ws.
// Adapted from the binary HID event protocol in kvmd's session.js.
// The desktop session.js is tightly coupled to the window manager and all subsystem
// modules, so we implement our own connection/state layer with a simple event emitter.

export class KvmdWebSocket {
	constructor() {
		this._ws = null;
		this._pingTimer = null;
		this._missedHeartbeats = 0;
		this._reconnectTimer = null;
		this._stopped = false;
		this._listeners = {};
		this._asciiEncoder = new TextEncoder();
	}

	on(event, cb) {
		if (!this._listeners[event]) this._listeners[event] = [];
		this._listeners[event].push(cb);
	}

	_emit(event, data) {
		let cbs = this._listeners[event];
		if (cbs) cbs.forEach(cb => cb(data));
	}

	get connected() {
		return this._ws && this._ws.readyState === WebSocket.OPEN;
	}

	connect() {
		this._stopped = false;
		this._tryConnect();
	}

	disconnect() {
		this._stopped = true;
		this._cleanup();
	}

	_tryConnect() {
		if (this._stopped) return;
		this._cleanup();

		let proto = location.protocol === "https:" ? "wss:" : "ws:";
		let url = `${proto}//${location.host}/api/ws`;

		this._ws = new WebSocket(url);
		this._ws.binaryType = "arraybuffer";

		this._ws.onopen = () => {
			this._missedHeartbeats = 0;
			this._pingTimer = setInterval(() => this._ping(), 1000);
			this._emit("open");
		};

		this._ws.onmessage = (ev) => {
			if (typeof ev.data === "string") {
				let msg = JSON.parse(ev.data);
				this._emit("state", msg);
				this._emit(msg.event_type, msg.event);
			} else {
				let data = new Uint8Array(ev.data);
				if (data[0] === 255) {
					this._missedHeartbeats = 0;
				}
			}
		};

		this._ws.onerror = () => {
			this._scheduleReconnect();
		};

		this._ws.onclose = () => {
			this._emit("close");
			this._scheduleReconnect();
		};
	}

	_cleanup() {
		if (this._pingTimer) {
			clearInterval(this._pingTimer);
			this._pingTimer = null;
		}
		if (this._reconnectTimer) {
			clearTimeout(this._reconnectTimer);
			this._reconnectTimer = null;
		}
		if (this._ws) {
			this._ws.onopen = null;
			this._ws.onmessage = null;
			this._ws.onerror = null;
			this._ws.onclose = null;
			if (this._ws.readyState === WebSocket.OPEN) {
				this._ws.close();
			}
			this._ws = null;
		}
	}

	_ping() {
		try {
			this._missedHeartbeats++;
			if (this._missedHeartbeats >= 15) {
				throw new Error("Too many missed heartbeats");
			}
			this._ws.send(new Uint8Array([0]));
		} catch {
			this._scheduleReconnect();
		}
	}

	_scheduleReconnect() {
		this._cleanup();
		this._emit("close");
		if (!this._stopped) {
			this._reconnectTimer = setTimeout(() => this._tryConnect(), 1000);
		}
	}

	// --- HID Event Senders ---
	// Binary protocol adapted from session.js __sendHidEvent

	sendKey(key, state) {
		if (!this.connected) return;
		let data = this._asciiEncoder.encode("\x01\x00" + key);
		data[1] = state ? 1 : 0;
		this._ws.send(data);
	}

	sendMouseButton(button, state) {
		if (!this.connected) return;
		let data = this._asciiEncoder.encode("\x02\x00" + button);
		data[1] = state ? 1 : 0;
		this._ws.send(data);
	}

	sendMouseMoveAbs(x, y) {
		if (!this.connected) return;
		// Absolute coordinates in -32768..32767 range
		let data = new Uint8Array([
			3,
			(x >> 8) & 0xFF, x & 0xFF,
			(y >> 8) & 0xFF, y & 0xFF,
		]);
		this._ws.send(data);
	}

	sendMouseRelative(dx, dy) {
		if (!this.connected) return;
		let data = new Int8Array([4, 0, dx, dy]);
		this._ws.send(data);
	}

	sendMouseWheel(dx, dy) {
		if (!this.connected) return;
		let data = new Int8Array([5, 0, dx, dy]);
		this._ws.send(data);
	}
}
