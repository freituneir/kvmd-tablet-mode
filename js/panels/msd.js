"use strict";

// Mass Storage Device panel

import {apiPost, apiMsdUpload} from "../api.js";

export class MsdPanel {
	constructor() {
		this._statusText = document.getElementById("msd-status-text");
		this._imageName = document.getElementById("msd-image-name");
		this._imageSelect = document.getElementById("msd-image-select");
		this._connectBtn = document.getElementById("msd-connect-btn");
		this._disconnectBtn = document.getElementById("msd-disconnect-btn");
		this._uploadInput = document.getElementById("msd-upload-input");
		this._progressBar = document.getElementById("msd-upload-progress");
		this._progressFill = this._progressBar.querySelector(".progress-fill");
		this._progressText = this._progressBar.querySelector(".progress-text");

		this._connectBtn.addEventListener("click", () => this._connect());
		this._disconnectBtn.addEventListener("click", () => this._disconnect());
		this._uploadInput.addEventListener("change", () => this._upload());
	}

	setState(ev) {
		if (!ev) {
			this._statusText.textContent = "Offline";
			return;
		}
		if (ev.online === false) {
			this._statusText.textContent = "Offline";
			return;
		}
		if (ev.drive !== undefined) {
			this._statusText.textContent = ev.drive.connected ? "Connected" : "Disconnected";
			if (ev.drive.image) {
				this._imageName.textContent = ev.drive.image.name || "None";
			}
			if (ev.drive.cdrom !== undefined) {
				let radios = document.querySelectorAll('input[name="msd-mode"]');
				radios.forEach(r => r.checked = (r.value === (ev.drive.cdrom ? "cdrom" : "flash")));
			}
		}
		if (ev.storage !== undefined && ev.storage.images) {
			this._updateImageList(ev.storage.images);
		}
	}

	_updateImageList(images) {
		let current = this._imageSelect.value;
		this._imageSelect.innerHTML = '<option value="">-- Select image --</option>';
		for (let img of Object.keys(images)) {
			let opt = document.createElement("option");
			opt.value = img;
			let info = images[img];
			let size = info.size ? ` (${_formatSize(info.size)})` : "";
			opt.textContent = img + size;
			this._imageSelect.appendChild(opt);
		}
		if (current) this._imageSelect.value = current;
	}

	async _connect() {
		try {
			let selected = this._imageSelect.value;
			let cdrom = document.querySelector('input[name="msd-mode"]:checked').value === "cdrom";
			if (selected) {
				await apiPost("msd/set_params", {image: selected, cdrom: cdrom ? 1 : 0});
			}
			await apiPost("msd/connect");
		} catch (e) {
			console.error("MSD connect failed:", e);
		}
	}

	async _disconnect() {
		try {
			await apiPost("msd/disconnect");
		} catch (e) {
			console.error("MSD disconnect failed:", e);
		}
	}

	async _upload() {
		let file = this._uploadInput.files[0];
		if (!file) return;

		this._progressBar.classList.remove("hidden");
		this._progressFill.style.width = "0%";
		this._progressText.textContent = "0%";

		try {
			await apiMsdUpload(file, (progress) => {
				let pct = Math.round(progress * 100);
				this._progressFill.style.width = pct + "%";
				this._progressText.textContent = pct + "%";
			});
			this._progressText.textContent = "Done";
		} catch (e) {
			console.error("MSD upload failed:", e);
			this._progressText.textContent = "Failed";
		}

		this._uploadInput.value = "";
		setTimeout(() => this._progressBar.classList.add("hidden"), 3000);
	}
}

function _formatSize(bytes) {
	if (bytes <= 0) return "0 B";
	let i = Math.floor(Math.log(bytes) / Math.log(1024));
	return (bytes / Math.pow(1024, i)).toFixed(1) + " " + ["B", "KiB", "MiB", "GiB", "TiB"][i];
}
