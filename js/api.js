"use strict";

// KVMD REST API client for the tablet frontend.
// Adapted from the desktop UI's tools.httpRequest pattern (kvmd web/share/js/tools.js)
// but written as a standalone module without desktop UI dependencies.

const API_TIMEOUT = 15000;

export async function apiLogin(user, passwd) {
	let body = `user=${encodeURIComponent(user)}&passwd=${encodeURIComponent(passwd)}`;
	let resp = await fetch("/api/auth/login", {
		method: "POST",
		headers: {"Content-Type": "application/x-www-form-urlencoded"},
		body: body,
	});
	return resp.status;
}

export async function apiLogout() {
	await fetch("/api/auth/logout", {method: "POST"});
}

export async function apiAuthCheck() {
	let resp = await fetch("/api/auth/check", {signal: AbortSignal.timeout(API_TIMEOUT)});
	return resp.status === 200;
}

export async function apiGet(path) {
	let resp = await fetch(`/api/${path}`, {signal: AbortSignal.timeout(API_TIMEOUT)});
	if (!resp.ok) throw new Error(`API ${path}: ${resp.status}`);
	return resp.json();
}

export async function apiPost(path, params) {
	let url = `/api/${path}`;
	if (params) {
		url += "?" + new URLSearchParams(params);
	}
	let resp = await fetch(url, {method: "POST", signal: AbortSignal.timeout(API_TIMEOUT)});
	if (!resp.ok) throw new Error(`API POST ${path}: ${resp.status}`);
	return resp;
}

export async function apiPostBody(path, body, contentType) {
	let resp = await fetch(`/api/${path}`, {
		method: "POST",
		headers: {"Content-Type": contentType},
		body: body,
	});
	if (!resp.ok) throw new Error(`API POST ${path}: ${resp.status}`);
	return resp;
}

// Upload a file to MSD with progress callback
export function apiMsdUpload(file, onProgress) {
	return new Promise((resolve, reject) => {
		let xhr = new XMLHttpRequest();
		xhr.open("POST", "/api/msd/write?image=" + encodeURIComponent(file.name));
		xhr.upload.addEventListener("progress", (ev) => {
			if (ev.lengthComputable && onProgress) {
				onProgress(ev.loaded / ev.total);
			}
		});
		xhr.onload = () => {
			if (xhr.status === 200) resolve();
			else reject(new Error(`Upload failed: ${xhr.status}`));
		};
		xhr.onerror = () => reject(new Error("Upload network error"));
		xhr.send(file);
	});
}
