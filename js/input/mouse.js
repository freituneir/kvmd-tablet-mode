"use strict";

// Touch-first mouse input handling for the tablet frontend.
// The desktop mouse.js assumes mousedown/mouseup/mousemove events from a pointer device
// and uses pointer lock for relative mode — both unsuitable for tablets.
// This module implements touch-to-point (absolute) and touch-drag (relative) modes.
//
// Gesture detection (works in BOTH absolute and relative modes):
//   - Double tap (two taps within 300ms) = left click
//   - Double tap and hold = left click + drag (for text selection / highlighting)
//   - Tap and hold (500ms without moving) = right click
//
// Relative mode additional gestures:
//   - Single tap = left click (with 300ms delay to distinguish from double-tap)
//   - Two-finger tap = right click
//   - Touch-drag = relative mouse movement
//   - Two-finger scroll in both modes
//
// Zoom awareness: when the ZoomController is actively handling a pinch or pan,
// the mouse handler yields and does not send HID events.

const TAP_MAX_DURATION = 200; // ms — max time for a touch to count as a tap
const TAP_MAX_DISTANCE = 10; // px — max movement for a touch to count as a tap
const DOUBLE_TAP_WINDOW = 300; // ms — max time between two taps for a double tap
const LONG_PRESS_DELAY = 500; // ms — hold duration for right click
const DRAG_HOLD_DELAY = 200; // ms — hold after second tap to enter drag mode

export class MouseHandler {
	constructor(ws, streamContainer) {
		this._ws = ws;
		this._streamContainer = streamContainer;
		this._mode = "absolute"; // "absolute" | "relative"
		this._getStreamGeometry = null;
		this._zoomController = null;
		this._sendTimer = null;
		this._absPos = null;
		this._relTouchStart = null;
		this._enabled = true;
		this._sensitivity = 1;
		this._scrollSensitivity = 2;

		// Tap detection
		this._touchStartTime = 0;
		this._touchStartPos = null;
		this._touchMoved = false;

		// Double tap detection
		this._lastTapTime = 0;
		this._lastTapPos = null;
		this._singleTapTimer = null;

		// Long press detection
		this._longPressTimer = null;
		this._longPressFired = false;

		// Double-tap-and-hold drag detection
		this._isDragging = false;
		this._dragHoldTimer = null;
		this._isSecondTapDown = false; // true when second tap of double-tap is still held

		// Two-finger tap detection
		this._twoFingerTapDetected = false;
		this._twoFingerStartTime = 0;
		this._twoFingerMoved = false;

		// Two-finger scroll tracking
		this._scrollAnchor = null;

		// Bind event handlers
		this._onTouchStart = this._handleTouchStart.bind(this);
		this._onTouchMove = this._handleTouchMove.bind(this);
		this._onTouchEnd = this._handleTouchEnd.bind(this);

		this._streamContainer.addEventListener("touchstart", this._onTouchStart, {passive: false});
		this._streamContainer.addEventListener("touchmove", this._onTouchMove, {passive: false});
		this._streamContainer.addEventListener("touchend", this._onTouchEnd, {passive: false});

		// Periodic absolute position sender (like the desktop's mouse rate timer)
		this._sendTimer = setInterval(() => this._sendPlannedMove(), 10);
	}

	set getStreamGeometry(fn) { this._getStreamGeometry = fn; }
	set zoomController(zc) { this._zoomController = zc; }
	set mode(m) { this._mode = m; }
	get mode() { return this._mode; }
	set enabled(v) { this._enabled = v; }
	set sensitivity(v) { this._sensitivity = parseFloat(v) || 1; }
	set scrollSensitivity(v) { this._scrollSensitivity = parseFloat(v) || 2; }
	get scrollSensitivity() { return this._scrollSensitivity; }

	destroy() {
		this._streamContainer.removeEventListener("touchstart", this._onTouchStart);
		this._streamContainer.removeEventListener("touchmove", this._onTouchMove);
		this._streamContainer.removeEventListener("touchend", this._onTouchEnd);
		if (this._sendTimer) clearInterval(this._sendTimer);
		if (this._singleTapTimer) clearTimeout(this._singleTapTimer);
		if (this._longPressTimer) clearTimeout(this._longPressTimer);
		if (this._dragHoldTimer) clearTimeout(this._dragHoldTimer);
	}

	_isZoomGesture() {
		return this._zoomController && this._zoomController.isPanningOrPinching;
	}

	_handleTouchStart(ev) {
		if (!this._enabled) return;
		if (this._isZoomGesture()) return;

		if (ev.touches.length === 1) {
			ev.preventDefault();
			let pos = this._getTouchPos(ev.touches[0]);

			// Track for tap detection
			this._touchStartTime = Date.now();
			this._touchStartPos = pos;
			this._touchMoved = false;
			this._longPressFired = false;

			// Check if this is the second tap of a double-tap (finger still down)
			let now = Date.now();
			if (this._lastTapTime && (now - this._lastTapTime) < DOUBLE_TAP_WINDOW && this._lastTapPos) {
				let dx = pos.x - this._lastTapPos.x;
				let dy = pos.y - this._lastTapPos.y;
				if (Math.sqrt(dx * dx + dy * dy) < TAP_MAX_DISTANCE * 2) {
					// This is the second tap — cancel single tap timer
					if (this._singleTapTimer) {
						clearTimeout(this._singleTapTimer);
						this._singleTapTimer = null;
					}
					this._isSecondTapDown = true;

					// Start drag hold timer — if finger stays down for DRAG_HOLD_DELAY,
					// enter drag mode (left button press + drag)
					if (this._dragHoldTimer) clearTimeout(this._dragHoldTimer);
					this._dragHoldTimer = setTimeout(() => {
						if (this._isSecondTapDown && !this._touchMoved) {
							// Enter drag mode
							this._isDragging = true;
							this._ws.sendMouseButton("left", true);
							// Cancel long press since we're dragging
							if (this._longPressTimer) {
								clearTimeout(this._longPressTimer);
								this._longPressTimer = null;
							}
						}
					}, DRAG_HOLD_DELAY);

					// Don't start long press timer for second tap of double-tap
					// (the drag hold timer handles this case)
					if (this._mode === "absolute") {
						this._absPos = pos;
						this._sendPlannedMove();
					} else {
						this._relTouchStart = pos;
					}
					return;
				}
			}

			// Not a second tap — start long press timer (works in both modes)
			if (this._longPressTimer) clearTimeout(this._longPressTimer);
			this._longPressTimer = setTimeout(() => {
				if (!this._touchMoved && !this._longPressFired && !this._isDragging) {
					this._longPressFired = true;
					// Send right click
					this._ws.sendMouseButton("right", true);
					setTimeout(() => this._ws.sendMouseButton("right", false), 50);
				}
			}, LONG_PRESS_DELAY);

			if (this._mode === "absolute") {
				this._absPos = pos;
				this._sendPlannedMove();
			} else {
				this._relTouchStart = pos;
			}
		} else if (ev.touches.length === 2) {
			// Two-finger touch: could be scroll or right-click tap
			// Cancel any pending long press and drag timers
			if (this._longPressTimer) {
				clearTimeout(this._longPressTimer);
				this._longPressTimer = null;
			}
			if (this._dragHoldTimer) {
				clearTimeout(this._dragHoldTimer);
				this._dragHoldTimer = null;
			}
			this._isSecondTapDown = false;

			this._twoFingerStartTime = Date.now();
			this._twoFingerMoved = false;
			this._twoFingerTapDetected = true;

			let mid = this._getMidpoint(ev.touches[0], ev.touches[1]);
			this._scrollAnchor = mid;

			// Move mouse cursor to the midpoint of the two fingers first
			// so scrolling happens at the right location
			if (this._mode === "absolute") {
				let midPos = this._screenToContainerPos(mid.x, mid.y);
				this._absPos = midPos;
				this._sendPlannedMove();
			}
		}
	}

	_handleTouchMove(ev) {
		if (!this._enabled) return;
		if (this._isZoomGesture()) return;

		if (ev.touches.length === 1) {
			ev.preventDefault();
			let pos = this._getTouchPos(ev.touches[0]);

			// Check if touch moved beyond tap threshold
			if (this._touchStartPos) {
				let dx = pos.x - this._touchStartPos.x;
				let dy = pos.y - this._touchStartPos.y;
				if (Math.sqrt(dx * dx + dy * dy) > TAP_MAX_DISTANCE) {
					this._touchMoved = true;

					// If we're in the second-tap hold period and finger moves,
					// immediately enter drag mode (don't wait for timer)
					if (this._isSecondTapDown && !this._isDragging) {
						this._isDragging = true;
						this._ws.sendMouseButton("left", true);
						if (this._dragHoldTimer) {
							clearTimeout(this._dragHoldTimer);
							this._dragHoldTimer = null;
						}
					}

					// Cancel long press if finger moved (only if not dragging)
					if (this._longPressTimer) {
						clearTimeout(this._longPressTimer);
						this._longPressTimer = null;
					}
				}
			}

			if (this._isDragging) {
				// Dragging: send mouse moves while left button is held
				if (this._mode === "absolute") {
					this._absPos = pos;
				} else {
					if (this._relTouchStart) {
						let dx = (pos.x - this._relTouchStart.x) * this._sensitivity;
						let dy = (pos.y - this._relTouchStart.y) * this._sensitivity;
						dx = Math.min(Math.max(-127, Math.floor(dx)), 127);
						dy = Math.min(Math.max(-127, Math.floor(dy)), 127);
						if (dx || dy) {
							this._ws.sendMouseRelative(dx, dy);
						}
						this._relTouchStart = pos;
					}
				}
			} else if (this._mode === "absolute") {
				this._absPos = pos;
			} else {
				// Relative mode: send delta (scaled by sensitivity)
				if (this._relTouchStart) {
					let dx = (pos.x - this._relTouchStart.x) * this._sensitivity;
					let dy = (pos.y - this._relTouchStart.y) * this._sensitivity;
					dx = Math.min(Math.max(-127, Math.floor(dx)), 127);
					dy = Math.min(Math.max(-127, Math.floor(dy)), 127);
					if (dx || dy) {
						this._ws.sendMouseRelative(dx, dy);
					}
					this._relTouchStart = pos;
				}
			}
		} else if (ev.touches.length === 2) {
			if (this._isZoomGesture()) return;

			let mid = this._getMidpoint(ev.touches[0], ev.touches[1]);

			if (this._scrollAnchor) {
				let dx = mid.x - this._scrollAnchor.x;
				let dy = mid.y - this._scrollAnchor.y;

				// Dead zone to avoid accidental scrolls
				if (Math.abs(dy) > 5 || Math.abs(dx) > 5) {
					// Mark as moved (not a tap) only once we exceed dead zone
					this._twoFingerMoved = true;
					this._twoFingerTapDetected = false;

					// Natural scroll: swipe down = scroll up (content moves up)
					// dy > 0 means finger moved down → send positive wheel (scroll up)
					let scrollY = 0;
					let scrollX = 0;
					let sens = this._scrollSensitivity;
					if (Math.abs(dy) > 5) {
						scrollY = dy > 0 ? sens : -sens;
					}
					if (Math.abs(dx) > 5) {
						scrollX = dx > 0 ? sens : -sens;
					}
					this._ws.sendMouseWheel(scrollX, scrollY);

					// Update anchor for continuous scrolling
					this._scrollAnchor = mid;
				}
			}
			this._absPos = null;
		}
	}

	_handleTouchEnd(ev) {
		if (!this._enabled) return;
		if (this._isZoomGesture()) return;

		// Cancel long press timer
		if (this._longPressTimer) {
			clearTimeout(this._longPressTimer);
			this._longPressTimer = null;
		}

		// All fingers lifted
		if (ev.touches.length === 0) {
			ev.preventDefault();
			this._sendPlannedMove();

			// If dragging, release the left button
			if (this._isDragging) {
				this._ws.sendMouseButton("left", false);
				this._isDragging = false;
				this._isSecondTapDown = false;
				if (this._dragHoldTimer) {
					clearTimeout(this._dragHoldTimer);
					this._dragHoldTimer = null;
				}
				this._lastTapTime = 0;
				this._lastTapPos = null;
				this._resetState();
				return;
			}

			// If second tap was down but we didn't enter drag mode,
			// it's a regular double-tap click
			if (this._isSecondTapDown) {
				this._isSecondTapDown = false;
				if (this._dragHoldTimer) {
					clearTimeout(this._dragHoldTimer);
					this._dragHoldTimer = null;
				}
				// Fire left click (press + release)
				this._ws.sendMouseButton("left", true);
				setTimeout(() => this._ws.sendMouseButton("left", false), 50);
				this._lastTapTime = 0;
				this._lastTapPos = null;
				this._resetState();
				return;
			}

			// If long press already fired, don't process tap
			if (this._longPressFired) {
				this._resetState();
				return;
			}

			let wasTap = !this._touchMoved && (Date.now() - this._touchStartTime) < TAP_MAX_DURATION;

			if (this._mode === "relative") {
				// Check for two-finger tap → right click
				if (this._twoFingerTapDetected && !this._twoFingerMoved) {
					let elapsed = Date.now() - this._twoFingerStartTime;
					if (elapsed < TAP_MAX_DURATION) {
						this._ws.sendMouseButton("right", true);
						setTimeout(() => this._ws.sendMouseButton("right", false), 50);
					}
				}
				// Check for single/double tap
				else if (wasTap && ev.changedTouches.length >= 1 && this._touchStartPos) {
					this._processTap();
				}
			} else {
				// Absolute mode: check for tap
				if (wasTap && ev.changedTouches.length >= 1 && this._touchStartPos) {
					this._processTap();
				}
			}

			// Reset state
			this._relTouchStart = null;
			this._touchStartPos = null;
			this._twoFingerTapDetected = false;
			this._scrollAnchor = null;
		} else if (ev.touches.length === 1) {
			// Went from 2 fingers to 1 — reset relative tracking
			this._twoFingerTapDetected = false;
			this._scrollAnchor = null;
		}
	}

	_processTap() {
		let now = Date.now();
		let pos = this._touchStartPos;

		// Note: double-tap detection is now handled in _handleTouchStart
		// (when the second tap lands). _processTap only records first taps
		// and handles single-tap clicks in relative mode.

		// This is the first tap — record it for potential double-tap detection
		this._lastTapTime = now;
		this._lastTapPos = {x: pos.x, y: pos.y};

		// In relative mode, schedule a single-tap left click after the double-tap window
		if (this._mode === "relative") {
			if (this._singleTapTimer) clearTimeout(this._singleTapTimer);
			this._singleTapTimer = setTimeout(() => {
				this._singleTapTimer = null;
				this._ws.sendMouseButton("left", true);
				setTimeout(() => this._ws.sendMouseButton("left", false), 50);
				this._lastTapTime = 0;
				this._lastTapPos = null;
			}, DOUBLE_TAP_WINDOW);
		}
	}

	_resetState() {
		this._relTouchStart = null;
		this._touchStartPos = null;
		this._twoFingerTapDetected = false;
		this._scrollAnchor = null;
	}

	_sendPlannedMove() {
		if (this._mode === "absolute" && this._absPos && this._getStreamGeometry) {
			let geo = this._getStreamGeometry();
			if (!geo) return;

			// Remap touch position within the stream viewport to -32768..32767
			let x = _remap(this._absPos.x - geo.x, 0, geo.width - 1, -32768, 32767);
			let y = _remap(this._absPos.y - geo.y, 0, geo.height - 1, -32768, 32767);
			this._ws.sendMouseMoveAbs(x, y);
			this._absPos = null;
		}
	}

	// Convert a screen-space touch into the container's untransformed coordinate space.
	// When zoomed, the CSS transform (scale + translate) changes where the container
	// appears on screen. We reverse that so the coordinate mapping to remote screen
	// stays correct regardless of zoom level.
	_getTouchPos(touch) {
		return this._screenToContainerPos(touch.clientX, touch.clientY);
	}

	_screenToContainerPos(screenX, screenY) {
		let rect = this._streamContainer.getBoundingClientRect();

		if (this._zoomController && this._zoomController.zoomed) {
			let scale = this._zoomController.scale;
			// getBoundingClientRect() returns the *transformed* bounds.
			// The container's original (untransformed) size:
			let origW = rect.width / scale;
			let origH = rect.height / scale;
			// The transformed rect's top-left in screen space:
			let screenLeft = rect.left;
			let screenTop = rect.top;
			// Position within the transformed rect (0..rect.width)
			let sx = screenX - screenLeft;
			let sy = screenY - screenTop;
			// Reverse the scale to get untransformed position
			let ux = sx / scale;
			let uy = sy / scale;
			return {
				x: Math.round(ux),
				y: Math.round(uy),
			};
		}

		return {
			x: Math.round(screenX - rect.left),
			y: Math.round(screenY - rect.top),
		};
	}

	_getMidpoint(t0, t1) {
		return {
			x: (t0.clientX + t1.clientX) / 2,
			y: (t0.clientY + t1.clientY) / 2,
		};
	}

	// Button presses (called from the floating mouse panel)
	sendButton(button, state) {
		this._sendPlannedMove();
		this._ws.sendMouseButton(button, state);
	}
}

// Adapted from desktop tools.remap
function _remap(value, inMin, inMax, outMin, outMax) {
	let result = Math.round((value - inMin) * (outMax - outMin) / ((inMax - inMin) || 1) + outMin);
	return Math.min(Math.max(result, outMin), outMax);
}
