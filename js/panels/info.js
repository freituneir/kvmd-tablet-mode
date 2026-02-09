"use strict";

// System info display panel

export class InfoPanel {
	constructor() {
		this._platform = document.getElementById("info-platform");
		this._hostname = document.getElementById("info-hostname");
		this._kvmdVersion = document.getElementById("info-kvmd-version");
		this._streamer = document.getElementById("info-streamer");
	}

	setState(ev) {
		if (!ev) return;

		if (ev.meta) {
			let m = ev.meta;
			if (m.server && m.server.host) {
				this._hostname.textContent = m.server.host;
			}
		}
		if (ev.extras) {
			let e = ev.extras;
			if (e.kvmd && e.kvmd.version) {
				this._kvmdVersion.textContent = e.kvmd.version;
			}
			if (e.streamer && e.streamer.version) {
				this._streamer.textContent = e.streamer.app + " " + e.streamer.version;
			}
		}
		if (ev.hw) {
			if (ev.hw.platform) {
				let p = ev.hw.platform;
				this._platform.textContent = p.type + (p.base ? " (" + p.base + ")" : "");
			}
		}
	}
}
