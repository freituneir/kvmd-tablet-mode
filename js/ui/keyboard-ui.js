"use strict";

// On-screen keyboard UI rendering and interaction

export class KeyboardUI {
	constructor(keyboardHandler) {
		this._handler = keyboardHandler;
		this._panel = document.getElementById("keyboard-panel");
		this._toggleBtn = document.getElementById("keyboard-toggle-btn");
		this._closeBtn = document.getElementById("keyboard-close-btn");
		this._textInputBtn = document.getElementById("text-input-btn");
		this._textInputArea = document.getElementById("text-input-area");
		this._textInputWrap = document.getElementById("text-input-wrap");
		this._visible = false;
		this._onVisibilityChange = null;

		// Track previous textarea value for send-as-you-type
		this._prevTextValue = "";

		// Toggle button
		this._toggleBtn.addEventListener("click", () => this.toggle());
		this._closeBtn.addEventListener("click", () => this.hide());

		// Regular keys
		this._panel.querySelectorAll(".key[data-key]").forEach(btn => {
			let key = btn.dataset.key;
			let isToggle = btn.dataset.toggle === "true";

			btn.addEventListener("touchstart", (ev) => {
				ev.preventDefault();
				ev.stopPropagation();
				if (isToggle) {
					let active = this._handler.toggleModifier(key);
					btn.classList.toggle("active", active);
				} else {
					this._handler.sendKey(key, true);
					btn.classList.add("active");
				}
			}, {passive: false});

			btn.addEventListener("touchend", (ev) => {
				ev.preventDefault();
				ev.stopPropagation();
				if (!isToggle) {
					this._handler.sendKey(key, false);
					btn.classList.remove("active");
					// Release any held modifiers after a non-modifier key
					this._releaseHeldModifiers();
				}
			}, {passive: false});
		});

		// Combo keys
		this._panel.querySelectorAll(".key[data-combo]").forEach(btn => {
			btn.addEventListener("touchstart", (ev) => {
				ev.preventDefault();
				ev.stopPropagation();
				btn.classList.add("active");
			}, {passive: false});

			btn.addEventListener("touchend", (ev) => {
				ev.preventDefault();
				ev.stopPropagation();
				btn.classList.remove("active");
				let keys = btn.dataset.combo.split(",");
				this._handler.sendCombo(keys);
			}, {passive: false});
		});

		// Text input button (on-screen keyboard)
		this._textInputBtn.addEventListener("touchend", (ev) => {
			ev.preventDefault();
			this.showTextInput();
		});

		// Send-as-you-type: listen for input events on the textarea
		this._textInputArea.addEventListener("input", () => {
			this._handleTextInput();
		});

		// Handle special keys in the textarea
		this._textInputArea.addEventListener("keydown", (ev) => {
			if (ev.key === "Escape") {
				this.hideTextInput();
			}
			// Enter sends a key event directly (not through print API)
			if (ev.key === "Enter") {
				ev.preventDefault();
				this._handler.sendKey("Enter", true);
				setTimeout(() => this._handler.sendKey("Enter", false), 50);
			}
			// Backspace on empty textarea — send it to the remote machine
			if (ev.key === "Backspace" && this._textInputArea.value.length === 0) {
				ev.preventDefault();
				this._handler.sendKey("Backspace", true);
				setTimeout(() => this._handler.sendKey("Backspace", false), 50);
			}
		});

		// Don't hide on blur — let the user tap elsewhere and come back
		// Instead, provide a close button (the X) or Escape to dismiss
	}

	set onVisibilityChange(cb) { this._onVisibilityChange = cb; }

	get visible() { return this._visible; }

	// Expose sendText for clipboard paste (used by mouse panel)
	sendText(text) { return this._handler.sendText(text); }
	sendTextSlow(text, charDelayMs) { return this._handler.sendTextSlow(text, charDelayMs); }

	toggle() {
		if (this._visible) {
			this.hide();
		} else {
			this.show();
		}
	}

	show() {
		this._visible = true;
		this._panel.classList.remove("hidden");
		// Force reflow
		this._panel.offsetHeight;
		this._panel.classList.add("visible");
		if (this._onVisibilityChange) this._onVisibilityChange(true);
	}

	hide() {
		this._visible = false;
		this._panel.classList.remove("visible");
		setTimeout(() => {
			if (!this._visible) {
				this._panel.classList.add("hidden");
			}
		}, 300);
		this.hideTextInput();
		if (this._onVisibilityChange) this._onVisibilityChange(false);
	}

	showTextInput() {
		this._prevTextValue = "";
		this._textInputArea.value = "";
		this._textInputWrap.classList.remove("hidden");
		this._textInputArea.focus();
	}

	hideTextInput() {
		this._textInputWrap.classList.add("hidden");
		this._textInputArea.value = "";
		this._prevTextValue = "";
		this._textInputArea.blur();
	}

	_handleTextInput() {
		let current = this._textInputArea.value;
		let prev = this._prevTextValue;

		if (current.length > prev.length) {
			// Characters were added — send the new ones
			let added = current.slice(prev.length);
			this._handler.sendText(added);
		} else if (current.length < prev.length) {
			// Characters were deleted — send Backspace for each deleted character
			let deletedCount = prev.length - current.length;
			for (let i = 0; i < deletedCount; i++) {
				this._handler.sendKey("Backspace", true);
				// Stagger releases slightly so the remote registers each one
				setTimeout(() => this._handler.sendKey("Backspace", false), 30 + i * 20);
			}
		}

		this._prevTextValue = current;
	}

	_releaseHeldModifiers() {
		this._panel.querySelectorAll(".key[data-toggle='true'].active").forEach(btn => {
			let key = btn.dataset.key;
			if (this._handler.isModifierActive(key)) {
				this._handler.toggleModifier(key);
				btn.classList.remove("active");
			}
		});
	}
}
