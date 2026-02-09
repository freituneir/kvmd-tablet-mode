"use strict";

// Top bar UI state management

export class TopBar {
	constructor() {
		this._connectionLed = document.getElementById("connection-led");
		this._modeBadge = document.getElementById("stream-mode-badge");
		this._infoText = document.getElementById("stream-info-text");
		this._captureBtn = document.getElementById("keyboard-capture-btn");
		this._captureIndicator = this._captureBtn.querySelector(".capture-indicator");
		this._zoomBtn = document.getElementById("zoom-toggle-btn");
	}

	setConnectionState(state) {
		// state: "connected" | "connecting" | "disconnected"
		this._connectionLed.className = "led";
		switch (state) {
			case "connected":
				this._connectionLed.classList.add("led-green");
				this._connectionLed.title = "Connected";
				break;
			case "connecting":
				this._connectionLed.classList.add("led-yellow");
				this._connectionLed.title = "Connecting...";
				break;
			default:
				this._connectionLed.classList.add("led-gray");
				this._connectionLed.title = "Disconnected";
		}
	}

	setStreamInfo(mode, active, text) {
		this._modeBadge.textContent = mode || "--";
		if (text) {
			this._infoText.textContent = text;
		} else {
			this._infoText.textContent = "";
		}
	}

	setCaptureState(enabled) {
		if (enabled) {
			this._captureIndicator.classList.add("active");
			this._captureBtn.title = "Keyboard capture on (click to disable)";
		} else {
			this._captureIndicator.classList.remove("active");
			this._captureBtn.title = "Keyboard capture off (click to enable)";
		}
	}

	showCaptureButton(visible) {
		this._captureBtn.classList.toggle("hidden", !visible);
	}

	setZoomState(zoomed) {
		this._zoomBtn.classList.toggle("active", zoomed);
		this._zoomBtn.title = zoomed ? "Zoomed to 1:1 (click to fit)" : "Toggle 1:1 zoom";
	}
}
