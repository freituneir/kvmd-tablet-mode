"use strict";

// Main app initialization — wires together all modules.

import {apiLogin, apiAuthCheck, apiPost} from "./api.js";
import {KvmdWebSocket} from "./websocket.js";
import {StreamManager} from "./stream.js";
import {MouseHandler} from "./input/mouse.js";
import {KeyboardHandler} from "./input/keyboard.js";
import {TopBar} from "./ui/topbar.js";
import {DrawerUI} from "./ui/drawer.js";
import {KeyboardUI} from "./ui/keyboard-ui.js";
import {MousePanelUI} from "./ui/mouse-panel.js";
import {ZoomController} from "./ui/zoom.js";
import {ScrollWidget} from "./ui/scroll-widget.js";
import {AtxPanel} from "./panels/atx.js";
import {MsdPanel} from "./panels/msd.js";
import {GpioPanel} from "./panels/gpio.js";
import {InfoPanel} from "./panels/info.js";

class App {
	constructor() {
		this._ws = null;
		this._stream = null;
		this._mouse = null;
		this._keyboard = null;
		this._zoom = null;
		this._topBar = null;
		this._drawer = null;
		this._keyboardUI = null;
		this._mousePanelUI = null;
		this._atxPanel = null;
		this._msdPanel = null;
		this._gpioPanel = null;
		this._infoPanel = null;
		this._scrollWidget = null;
	}

	async init() {
		// Apply saved theme (with auto-detection support)
		this._applyTheme(localStorage.getItem("pikvm.tablet.theme") || "dark");

		// Check if already authenticated
		let authed = false;
		try {
			authed = await apiAuthCheck();
		} catch {
			// Network error — show login
		}

		if (authed) {
			this._showApp();
		} else {
			this._showLogin();
		}
	}

	_applyTheme(theme) {
		if (theme === "auto") {
			let prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
			document.documentElement.setAttribute("data-theme", prefersDark ? "dark" : "light");
		} else {
			document.documentElement.setAttribute("data-theme", theme);
		}
	}

	_updateJigglerUI(state) {
		let toggle = document.getElementById("setting-jiggler-toggle");
		let row = document.getElementById("setting-jiggler-row");
		if (state.enabled) {
			toggle.disabled = false;
			row.style.display = "";
		} else {
			toggle.disabled = true;
			row.style.display = "none";
		}
		toggle.classList.toggle("on", state.active);
		toggle.setAttribute("aria-checked", state.active ? "true" : "false");
	}

	_showLogin() {
		document.getElementById("login-screen").classList.remove("hidden");
		document.getElementById("app").classList.add("hidden");

		let form = document.getElementById("login-form");
		let errorEl = document.getElementById("login-error");
		let loginBtn = document.getElementById("login-button");

		form.onsubmit = async (ev) => {
			ev.preventDefault();
			errorEl.classList.add("hidden");
			loginBtn.disabled = true;

			let user = document.getElementById("login-user").value;
			let passwd = document.getElementById("login-password").value;

			try {
				let status = await apiLogin(user, passwd);
				if (status === 200) {
					this._showApp();
				} else if (status === 403) {
					errorEl.textContent = "Invalid username or password.";
					errorEl.classList.remove("hidden");
				} else {
					errorEl.textContent = "Login failed (status " + status + ").";
					errorEl.classList.remove("hidden");
				}
			} catch (e) {
				errorEl.textContent = "Connection error. Is PiKVM reachable?";
				errorEl.classList.remove("hidden");
			}

			loginBtn.disabled = false;
		};
	}

	_showApp() {
		document.getElementById("login-screen").classList.add("hidden");
		document.getElementById("app").classList.remove("hidden");
		this._initApp();
	}

	_initApp() {
		// WebSocket
		this._ws = new KvmdWebSocket();

		// UI components
		this._topBar = new TopBar();
		this._drawer = new DrawerUI();

		// Input handlers
		let streamContainer = document.getElementById("stream-container");
		this._keyboard = new KeyboardHandler(this._ws);
		this._mouse = new MouseHandler(this._ws, streamContainer);

		// Zoom controller
		this._zoom = new ZoomController(streamContainer, () => this._stream.getResolution());
		this._mouse.zoomController = this._zoom;

		this._zoom.onZoomChange = (zoomed, scale) => {
			this._topBar.setZoomState(zoomed);
		};

		// Scroll widget
		this._scrollWidget = new ScrollWidget(this._ws);
		document.getElementById("scroll-widget-toggle-btn").addEventListener("click", () => {
			this._scrollWidget.toggle();
		});

		this._keyboardUI = new KeyboardUI(this._keyboard);
		this._mousePanelUI = new MousePanelUI(this._mouse, this._keyboardUI);

		// Text input close button
		document.getElementById("text-input-close-btn").addEventListener("click", () => {
			this._keyboardUI.hideTextInput();
		});

		// Quick paste box in drawer
		let pasteInput = document.getElementById("paste-input");
		let pasteSendBtn = document.getElementById("paste-send-btn");
		pasteSendBtn.addEventListener("click", () => {
			let text = pasteInput.value;
			if (text) {
				this._keyboard.sendTextSlow(text);
				pasteInput.value = "";
			}
		});
		pasteInput.addEventListener("keydown", (ev) => {
			if (ev.key === "Enter") {
				ev.preventDefault();
				pasteSendBtn.click();
			}
		});

		// Admin panels
		this._atxPanel = new AtxPanel();
		this._msdPanel = new MsdPanel();
		this._gpioPanel = new GpioPanel();
		this._infoPanel = new InfoPanel();

		// Stream
		let videoEl = document.getElementById("stream-video");
		let imageEl = document.getElementById("stream-image");
		this._stream = new StreamManager(videoEl, imageEl);

		// Wire up stream geometry for mouse coordinate mapping
		this._mouse.getStreamGeometry = () => {
			let res = this._stream.getResolution();
			let viewW = res.viewWidth;
			let viewH = res.viewHeight;
			let realW = res.realWidth;
			let realH = res.realHeight;
			if (!realW || !realH) return null;
			let ratio = Math.min(viewW / realW, viewH / realH);
			return {
				x: Math.round((viewW - ratio * realW) / 2),
				y: Math.round((viewH - ratio * realH) / 2),
				width: Math.round(ratio * realW),
				height: Math.round(ratio * realH),
			};
		};

		// Stream status callbacks
		this._stream.onStatusChange = (active) => {
			// Could update UI indicators
		};

		this._stream.onInfoUpdate = (mode, active, text) => {
			this._topBar.setStreamInfo(mode, active, text);
		};

		// WebSocket event handlers
		this._ws.on("open", () => {
			this._topBar.setConnectionState("connected");
		});

		this._ws.on("close", () => {
			this._topBar.setConnectionState("disconnected");
		});

		this._ws.on("atx", (ev) => this._atxPanel.setState(ev));
		this._ws.on("msd", (ev) => this._msdPanel.setState(ev));
		this._ws.on("gpio", (ev) => this._gpioPanel.setState(ev));
		this._ws.on("info", (ev) => this._infoPanel.setState(ev));

		this._ws.on("hid", (ev) => {
			if (ev && ev.keyboard) {
				// Could update keyboard LED indicators
			}
			if (ev && ev.mouse) {
				let abs = ev.mouse.absolute;
				// Update mouse mode if server forces it
				if (abs !== undefined) {
					this._mouse.mode = abs ? "absolute" : "relative";
				}
			}
			if (ev && ev.jiggler !== undefined) {
				this._updateJigglerUI(ev.jiggler);
			}
		});

		this._ws.on("streamer", (ev) => {
			this._stream.updateState(ev);
		});

		// Drawer open/close toggles keyboard capture
		this._drawer.onOpen = () => {
			this._keyboard.setCaptureEnabled(false);
			this._mouse.enabled = false;
		};

		this._drawer.onClose = () => {
			this._mouse.enabled = true;
		};

		// Keyboard UI visibility toggles mouse input
		this._keyboardUI.onVisibilityChange = (visible) => {
			// Mouse panel repositions when keyboard is visible
		};

		// Keyboard capture toggle button
		let captureBtn = document.getElementById("keyboard-capture-btn");
		captureBtn.addEventListener("click", () => {
			this._keyboard.toggleCapture();
		});
		this._keyboard.onCaptureChange = (enabled) => {
			this._topBar.setCaptureState(enabled);
		};

		// Zoom toggle button
		document.getElementById("zoom-toggle-btn").addEventListener("click", () => {
			this._zoom.toggle();
		});

		// Fullscreen button
		document.getElementById("fullscreen-btn").addEventListener("click", () => {
			if (!document.fullscreenElement) {
				document.documentElement.requestFullscreen().catch(() => {
					// Try webkit prefix for iOS Safari
					if (document.documentElement.webkitRequestFullscreen) {
						document.documentElement.webkitRequestFullscreen();
					}
				});
			} else {
				if (document.exitFullscreen) {
					document.exitFullscreen();
				} else if (document.webkitExitFullscreen) {
					document.webkitExitFullscreen();
				}
			}
		});

		// Settings: Stream mode
		let settingStreamMode = document.getElementById("setting-stream-mode");
		settingStreamMode.value = localStorage.getItem("pikvm.tablet.streamMode") || "auto";
		settingStreamMode.addEventListener("change", () => {
			localStorage.setItem("pikvm.tablet.streamMode", settingStreamMode.value);
			this._stream.stop();
			this._stream.start(settingStreamMode.value);
		});

		// Settings: Mouse mode
		let settingMouseMode = document.getElementById("setting-mouse-mode");
		settingMouseMode.value = localStorage.getItem("pikvm.tablet.mouseMode") || "absolute";
		settingMouseMode.addEventListener("change", () => {
			localStorage.setItem("pikvm.tablet.mouseMode", settingMouseMode.value);
			this._mouse.mode = settingMouseMode.value;
		});

		// Settings: Theme
		let settingTheme = document.getElementById("setting-theme");
		settingTheme.value = localStorage.getItem("pikvm.tablet.theme") || "dark";
		settingTheme.addEventListener("change", () => {
			localStorage.setItem("pikvm.tablet.theme", settingTheme.value);
			this._applyTheme(settingTheme.value);
		});

		// Listen for system theme changes when auto mode is active
		window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
			let currentTheme = localStorage.getItem("pikvm.tablet.theme") || "dark";
			if (currentTheme === "auto") {
				this._applyTheme("auto");
			}
		});

		// Settings: Mouse jiggler
		document.getElementById("setting-jiggler-toggle").addEventListener("click", () => {
			let toggle = document.getElementById("setting-jiggler-toggle");
			if (toggle.disabled) return;
			let newState = !toggle.classList.contains("on");
			apiPost("hid/set_params", {jiggler: newState}).catch(() => {});
		});

		// Settings: Mouse sensitivity
		let settingSensitivity = document.getElementById("setting-mouse-sensitivity");
		let sensitivityValue = document.getElementById("setting-mouse-sensitivity-value");
		let savedSensitivity = localStorage.getItem("pikvm.tablet.mouseSensitivity") || "1";
		settingSensitivity.value = savedSensitivity;
		sensitivityValue.textContent = savedSensitivity + "x";
		this._mouse.sensitivity = savedSensitivity;
		settingSensitivity.addEventListener("input", () => {
			let val = settingSensitivity.value;
			sensitivityValue.textContent = val + "x";
			localStorage.setItem("pikvm.tablet.mouseSensitivity", val);
			this._mouse.sensitivity = val;
		});

		// Settings: Scroll sensitivity (two-finger scroll only — widget uses presets)
		let settingScrollSensitivity = document.getElementById("setting-scroll-sensitivity");
		let scrollSensitivityValue = document.getElementById("setting-scroll-sensitivity-value");
		let savedScrollSensitivity = localStorage.getItem("pikvm.tablet.scrollSensitivity") || "2";
		settingScrollSensitivity.value = savedScrollSensitivity;
		scrollSensitivityValue.textContent = savedScrollSensitivity;
		this._mouse.scrollSensitivity = savedScrollSensitivity;
		settingScrollSensitivity.addEventListener("input", () => {
			let val = settingScrollSensitivity.value;
			scrollSensitivityValue.textContent = val;
			localStorage.setItem("pikvm.tablet.scrollSensitivity", val);
			this._mouse.scrollSensitivity = val;
		});

		// Settings: Scroll widget preset (jog shuttle sensitivity)
		let settingScrollPreset = document.getElementById("setting-scroll-preset");
		settingScrollPreset.value = this._scrollWidget.preset;
		settingScrollPreset.addEventListener("change", () => {
			this._scrollWidget.preset = settingScrollPreset.value;
		});

		// Apply saved mouse mode
		this._mouse.mode = settingMouseMode.value;

		// Start connections
		this._topBar.setConnectionState("connecting");
		this._ws.connect();

		let preferredStreamMode = settingStreamMode.value;
		this._stream.start(preferredStreamMode);

		// Show keyboard capture button (initially hidden, shown when physical keyboard detected)
		this._topBar.showCaptureButton(true);

		// Prevent context menu on long press
		document.addEventListener("contextmenu", (ev) => {
			if (ev.target.closest("#admin-drawer") || ev.target.closest("#keyboard-panel")) {
				return; // Allow in panels
			}
			ev.preventDefault();
		});
	}
}

// Boot
document.addEventListener("DOMContentLoaded", () => {
	let app = new App();
	app.init();
});
