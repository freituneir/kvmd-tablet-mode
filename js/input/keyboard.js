"use strict";

// Keyboard handler for the tablet frontend.
// Manages both the on-screen KVM keyboard and physical keyboard capture.
//
// The keymap (event.code -> KVMD key names) is trivially 1:1 for most keys
// based on the kvmd keymap.csv — the `web_name` column uses the same values
// as JavaScript event.code. We include the full map for validation.

// Complete set of valid KVMD key names derived from keymap.csv (web_name column).
// These are exactly the JavaScript event.code values that the API accepts.
const VALID_KEYS = new Set([
	"KeyA","KeyB","KeyC","KeyD","KeyE","KeyF","KeyG","KeyH","KeyI","KeyJ","KeyK","KeyL","KeyM",
	"KeyN","KeyO","KeyP","KeyQ","KeyR","KeyS","KeyT","KeyU","KeyV","KeyW","KeyX","KeyY","KeyZ",
	"Digit1","Digit2","Digit3","Digit4","Digit5","Digit6","Digit7","Digit8","Digit9","Digit0",
	"Enter","Escape","Backspace","Tab","Space","Minus","Equal","BracketLeft","BracketRight",
	"Backslash","Semicolon","Quote","Backquote","Comma","Period","Slash","CapsLock",
	"F1","F2","F3","F4","F5","F6","F7","F8","F9","F10","F11","F12",
	"PrintScreen","Insert","Home","PageUp","Delete","End","PageDown",
	"ArrowRight","ArrowLeft","ArrowDown","ArrowUp",
	"ControlLeft","ShiftLeft","AltLeft","MetaLeft",
	"ControlRight","ShiftRight","AltRight","MetaRight",
	"Pause","ScrollLock","NumLock","ContextMenu",
	"NumpadDivide","NumpadMultiply","NumpadSubtract","NumpadAdd","NumpadEnter",
	"Numpad1","Numpad2","Numpad3","Numpad4","Numpad5","Numpad6","Numpad7","Numpad8","Numpad9","Numpad0",
	"NumpadDecimal","Power","IntlBackslash","IntlYen","IntlRo","KanaMode","Convert","NonConvert",
	"AudioVolumeMute","AudioVolumeUp","AudioVolumeDown",
]);

export class KeyboardHandler {
	constructor(ws) {
		this._ws = ws;
		this._captureEnabled = false;
		this._activeModifiers = new Set();
		this._physicalKeyboardDetected = false;
		this._onCaptureChange = null;

		// Physical keyboard event handlers
		this._onKeyDown = this._handleKeyDown.bind(this);
		this._onKeyUp = this._handleKeyUp.bind(this);

		document.addEventListener("keydown", this._onKeyDown);
		document.addEventListener("keyup", this._onKeyUp);
	}

	set onCaptureChange(cb) { this._onCaptureChange = cb; }
	get captureEnabled() { return this._captureEnabled; }
	get physicalKeyboardDetected() { return this._physicalKeyboardDetected; }

	setCaptureEnabled(enabled) {
		this._captureEnabled = enabled;
		if (!enabled) {
			this.releaseAll();
		}
		if (this._onCaptureChange) this._onCaptureChange(enabled);
	}

	toggleCapture() {
		this.setCaptureEnabled(!this._captureEnabled);
	}

	// Send a single key press+release
	sendKey(key, state) {
		if (VALID_KEYS.has(key)) {
			this._ws.sendKey(key, state);
		}
	}

	// Send a key combo (e.g., Ctrl+Alt+Del)
	sendCombo(keys) {
		// Press all keys in order, then release in reverse
		for (let key of keys) {
			this._ws.sendKey(key, true);
		}
		// Small delay then release
		setTimeout(() => {
			for (let i = keys.length - 1; i >= 0; i--) {
				this._ws.sendKey(keys[i], false);
			}
		}, 50);
	}

	// Toggle a modifier key on/off (for on-screen keyboard)
	toggleModifier(key) {
		if (this._activeModifiers.has(key)) {
			this._activeModifiers.delete(key);
			this._ws.sendKey(key, false);
			return false;
		} else {
			this._activeModifiers.add(key);
			this._ws.sendKey(key, true);
			return true;
		}
	}

	isModifierActive(key) {
		return this._activeModifiers.has(key);
	}

	releaseAll() {
		for (let key of this._activeModifiers) {
			this._ws.sendKey(key, false);
		}
		this._activeModifiers.clear();
	}

	// Send text all at once via /api/hid/print (fast, may drop chars on slow HID)
	async sendText(text) {
		if (!text) return;
		try {
			await fetch("/api/hid/print", {
				method: "POST",
				headers: {"Content-Type": "application/octet-stream"},
				body: text,
			});
		} catch (e) {
			console.error("Failed to send text:", e);
		}
	}

	// Send text character by character with a delay between each.
	// Prevents the remote HID from being overwhelmed and dropping characters.
	async sendTextSlow(text, charDelayMs = 50) {
		if (!text) return;
		this._abortSlowType = false;
		for (let i = 0; i < text.length; i++) {
			if (this._abortSlowType) break;
			try {
				await fetch("/api/hid/print", {
					method: "POST",
					headers: {"Content-Type": "application/octet-stream"},
					body: text[i],
				});
			} catch (e) {
				console.error("Failed to send character:", e);
				break;
			}
			if (i < text.length - 1 && !this._abortSlowType) {
				await new Promise(r => setTimeout(r, charDelayMs));
			}
		}
	}

	// Cancel any in-progress slow typing
	abortSlowType() {
		this._abortSlowType = true;
	}

	// Physical keyboard handlers
	_handleKeyDown(ev) {
		if (!this._captureEnabled) return;
		if (ev.target.tagName === "INPUT" || ev.target.tagName === "TEXTAREA" || ev.target.tagName === "SELECT") {
			return;
		}
		this._physicalKeyboardDetected = true;
		ev.preventDefault();
		if (ev.repeat) return;

		let code = this._fixCode(ev);
		if (VALID_KEYS.has(code)) {
			this._ws.sendKey(code, true);
		}
	}

	_handleKeyUp(ev) {
		if (!this._captureEnabled) return;
		if (ev.target.tagName === "INPUT" || ev.target.tagName === "TEXTAREA" || ev.target.tagName === "SELECT") {
			return;
		}
		ev.preventDefault();

		let code = this._fixCode(ev);
		if (VALID_KEYS.has(code)) {
			this._ws.sendKey(code, false);
		}
	}

	// Keyboard quirk fixes from the desktop keyboard.js
	_fixCode(ev) {
		let code = ev.code;
		// IntlBackslash / Backquote swap fix (issue #819)
		if (code === "IntlBackslash" && ["`", "~"].includes(ev.key)) {
			code = "Backquote";
		} else if (code === "Backquote" && ["§", "±"].includes(ev.key)) {
			code = "IntlBackslash";
		}
		return code;
	}

	destroy() {
		document.removeEventListener("keydown", this._onKeyDown);
		document.removeEventListener("keyup", this._onKeyUp);
		this.releaseAll();
	}
}
