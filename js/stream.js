"use strict";

// Stream manager for the tablet frontend.
// Handles WebRTC (Janus) and MJPEG streaming modes.
//
// The desktop stream_janus.js is closely coupled to the desktop tools.js ($ helper,
// tools.makeWsUrl, tools.browser, etc.) and the desktop DOM element IDs.
// Rather than importing those with adapter shims, we implement Janus and MJPEG
// streaming with the same protocol logic but using our own DOM references.

export class StreamManager {
	constructor(videoEl, imageEl) {
		this._videoEl = videoEl;
		this._imageEl = imageEl;
		this._mode = null; // "janus" | "mjpeg"
		this._janus = null;
		this._janusHandle = null;
		this._janusRetryTimer = null;
		this._mjpegKey = _randomId();
		this._active = false;
		this._stopped = true;
		this._streamerState = null;
		this._infoInterval = null;
		this._onStatusChange = null;
		this._onInfoUpdate = null;
		this._onAudioStateChange = null;
		this._janusModule = null;

		// Audio/mic state
		this._audioEnabled = true;
		this._micEnabled = true;
		this._audioAvailable = false;
		this._micAvailable = false;
	}

	set onStatusChange(cb) { this._onStatusChange = cb; }
	set onInfoUpdate(cb) { this._onInfoUpdate = cb; }
	set onAudioStateChange(cb) { this._onAudioStateChange = cb; }

	get mode() { return this._mode; }
	get active() { return this._active; }

	get audioEnabled() { return this._audioEnabled; }
	set audioEnabled(v) {
		if (this._audioEnabled === v) return;
		this._audioEnabled = v;
		this._restartIfJanus();
	}

	get micEnabled() { return this._micEnabled; }
	set micEnabled(v) {
		if (this._micEnabled === v) return;
		this._micEnabled = v;
		this._restartIfJanus();
	}

	get audioAvailable() { return this._audioAvailable; }
	get micAvailable() { return this._micAvailable; }

	getResolution() {
		if (this._mode === "janus") {
			return {
				realWidth: this._videoEl.videoWidth || this._videoEl.offsetWidth,
				realHeight: this._videoEl.videoHeight || this._videoEl.offsetHeight,
				viewWidth: this._videoEl.offsetWidth,
				viewHeight: this._videoEl.offsetHeight,
			};
		} else {
			return {
				realWidth: this._imageEl.naturalWidth || this._imageEl.offsetWidth,
				realHeight: this._imageEl.naturalHeight || this._imageEl.offsetHeight,
				viewWidth: this._imageEl.offsetWidth,
				viewHeight: this._imageEl.offsetHeight,
			};
		}
	}

	async start(preferredMode) {
		this._stopped = false;
		let mode = preferredMode || "auto";

		if (mode === "auto" || mode === "janus") {
			if (window.RTCPeerConnection) {
				try {
					await this._ensureJanusModule();
					this._startJanus();
					return;
				} catch (e) {
					console.warn("Janus init failed, falling back to MJPEG:", e);
				}
			}
			if (mode === "janus") {
				console.warn("WebRTC not available, falling back to MJPEG");
			}
		}

		this._startMjpeg();
	}

	stop() {
		this._stopped = true;
		this._stopJanus();
		this._stopMjpeg();
		this._setActive(false);
	}

	_restartIfJanus() {
		if (this._mode === "janus" && !this._stopped) {
			this._stopJanus();
			this._connectJanus();
		}
	}

	updateState(streamerState) {
		this._streamerState = streamerState;
		if (this._mode === "janus" && this._janusHandle && streamerState) {
			// Janus manages its own stream lifecycle
		} else if (this._mode === "mjpeg" && streamerState) {
			// MJPEG is a continuous HTTP stream, just track info
		}
	}

	// ---- Janus WebRTC ----

	async _ensureJanusModule() {
		if (this._janusModule) return;
		// Janus.js is expected to be available from the desktop UI path
		// On the PiKVM device: /share/js/kvm/janus.js
		// We try to import it, falling back to the tablet-local path
		try {
			let mod = await import("../../share/js/kvm/janus.js");
			await new Promise((resolve, reject) => {
				mod.Janus.init({
					debug: false,
					callback: () => {
						this._janusModule = mod.Janus;
						resolve();
					},
				});
			});
		} catch (e) {
			throw new Error("Failed to load Janus module: " + e.message);
		}
	}

	_startJanus() {
		this._mode = "janus";
		this._videoEl.classList.remove("hidden");
		this._imageEl.classList.add("hidden");
		this._notifyInfo("WebRTC", false, "Connecting...");
		this._connectJanus();
	}

	_connectJanus() {
		if (this._stopped || this._janus) return;

		let wsProto = location.protocol === "https:" ? "wss:" : "ws:";
		let wsUrl = `${wsProto}//${location.host}/janus/ws`;

		this._janus = new this._janusModule({
			server: wsUrl,
			ipv6: true,
			destroyOnUnload: false,
			success: () => this._attachJanus(),
			error: (error) => {
				console.error("Janus error:", error);
				this._notifyInfo("WebRTC", false, String(error));
				this._retryJanus();
			},
		});
	}

	_attachJanus() {
		if (!this._janus) return;
		let Janus = this._janusModule;
		this._janus.attach({
			plugin: "janus.plugin.ustreamer",
			opaqueId: "tablet-" + Janus.randomString(12),

			success: (handle) => {
				this._janusHandle = handle;
				handle.send({message: {request: "features"}});
			},

			error: (error) => {
				console.error("Janus attach error:", error);
				this._stopJanus();
				this._retryJanus();
			},

			connectionState: (state) => {
				if (state === "failed") {
					this._stopJanus();
					this._retryJanus();
				}
			},

			iceState: () => {},

			webrtcState: (up) => {
				if (up) {
					this._setActive(true);
				}
			},

			onmessage: (msg, jsep) => {
				if (msg.result) {
					if (msg.result.status === "started") {
						this._setActive(true);
						this._notifyInfo("WebRTC", true, "");
					} else if (msg.result.status === "stopped") {
						this._setActive(false);
					} else if (msg.result.status === "features") {
						let f = msg.result.features || {};
						this._audioAvailable = !!f.audio;
						this._micAvailable = !!f.mic;
						if (this._onAudioStateChange) {
							this._onAudioStateChange(this._audioAvailable, this._micAvailable);
						}
						let audio = this._audioEnabled && this._audioAvailable;
						let mic = audio && this._micEnabled && this._micAvailable;
						this._janusHandle.send({message: {
							request: "watch",
							params: {audio: audio, mic: mic, cam: false},
						}});
					}
				} else if (msg.error_code || msg.error) {
					this._notifyInfo("WebRTC", false, msg.error || "Error");
				}

				if (jsep) {
					let audio = this._audioEnabled && this._audioAvailable;
					let mic = audio && this._micEnabled && this._micAvailable;
					let tracks = [
						{type: "video", capture: false, recv: true, add: true},
					];
					if (audio) {
						tracks.push({type: "audio", capture: mic, recv: true, add: true});
					}
					this._janusHandle.createAnswer({
						jsep: jsep,
						tracks: tracks,
						customizeSdp: (jsep) => {
							jsep.sdp = jsep.sdp.replace("useinbandfec=1", "useinbandfec=1;stereo=1");
						},
						success: (jsep) => {
							this._janusHandle.send({message: {request: "start"}, jsep: jsep});
						},
						error: (error) => {
							this._notifyInfo("WebRTC", false, String(error));
						},
					});
				}
			},

			onremotetrack: (track, id, added, meta) => {
				let reason = (meta || {}).reason;
				if (added && reason === "created") {
					this._addTrack(track);
					if (track.kind === "video") {
						this._startJanusInfo();
					}
				} else if (!added && reason === "ended") {
					this._removeTrack(track);
				}
			},

			oncleanup: () => {
				this._stopJanusInfo();
			},
		});
	}

	_addTrack(track) {
		let el = this._videoEl;
		if (el.srcObject) {
			for (let tr of el.srcObject.getTracks()) {
				if (tr.kind === track.kind && tr.id !== track.id) {
					this._removeTrack(tr);
				}
			}
		}
		if (!el.srcObject) {
			el.srcObject = new MediaStream();
		}
		el.srcObject.addTrack(track);
	}

	_removeTrack(track) {
		let el = this._videoEl;
		if (!el.srcObject) return;
		track.stop();
		el.srcObject.removeTrack(track);
		if (el.srcObject.getTracks().length === 0) {
			el.srcObject = null;
		}
	}

	_startJanusInfo() {
		this._stopJanusInfo();
		this._setActive(true);
		this._infoInterval = setInterval(() => {
			if (this._janusHandle) {
				let bitrate = `${this._janusHandle.getBitrate()}`.replace("kbits/sec", "kbps");
				let label = "WebRTC";
				if (this._audioEnabled && this._audioAvailable) label += " + Audio";
				if (this._micEnabled && this._micAvailable) label += " + Mic";
				this._notifyInfo(label, true, bitrate);
			}
		}, 1000);
	}

	_stopJanusInfo() {
		if (this._infoInterval) {
			clearInterval(this._infoInterval);
			this._infoInterval = null;
		}
	}

	_stopJanus() {
		this._stopJanusInfo();
		if (this._janusRetryTimer) {
			clearTimeout(this._janusRetryTimer);
			this._janusRetryTimer = null;
		}
		if (this._janusHandle) {
			this._janusHandle.detach();
			this._janusHandle = null;
		}
		if (this._janus) {
			this._janus.destroy();
			this._janus = null;
		}
		let stream = this._videoEl.srcObject;
		if (stream) {
			stream.getTracks().forEach(t => t.stop());
			this._videoEl.srcObject = null;
		}
	}

	_retryJanus() {
		if (this._stopped) return;
		if (!this._janusRetryTimer) {
			this._janusRetryTimer = setTimeout(() => {
				this._janusRetryTimer = null;
				this._connectJanus();
			}, 5000);
		}
	}

	// ---- MJPEG ----

	_startMjpeg() {
		this._mode = "mjpeg";
		this._videoEl.classList.add("hidden");
		this._imageEl.classList.remove("hidden");
		this._notifyInfo("MJPEG", false, "Connecting...");
		this._refreshMjpeg();
	}

	_refreshMjpeg() {
		this._mjpegKey = _randomId();
		let path = `/streamer/stream?key=${encodeURIComponent(this._mjpegKey)}`;

		// Browser-specific fixes from desktop stream_mjpeg.js
		let ua = navigator.userAgent;
		if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) {
			path += "&dual_final_frames=1";
		} else if (/Chrome/i.test(ua)) {
			path += "&advance_headers=1";
		}

		this._imageEl.onload = () => {
			if (!this._active) {
				this._setActive(true);
				this._notifyInfo("MJPEG", true, "Streaming");
			}
		};

		this._imageEl.onerror = () => {
			this._setActive(false);
			this._notifyInfo("MJPEG", false, "Stream error");
			if (!this._stopped) {
				setTimeout(() => this._refreshMjpeg(), 2000);
			}
		};

		this._imageEl.src = path;
	}

	_stopMjpeg() {
		this._imageEl.onload = null;
		this._imageEl.onerror = null;
		this._imageEl.src = "";
	}

	// ---- Helpers ----

	_setActive(active) {
		this._active = active;
		if (this._onStatusChange) this._onStatusChange(active);
	}

	_notifyInfo(mode, active, text) {
		if (this._onInfoUpdate) this._onInfoUpdate(mode, active, text);
	}
}

function _randomId() {
	let chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	let id = "";
	for (let i = 0; i < 16; i++) {
		id += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return id;
}
