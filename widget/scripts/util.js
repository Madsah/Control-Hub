/* Control Panel — shared helpers. */

/* iCUE hooks must be plain global assignments (no var/let/const) so iCUE can see them. */
icueEvents = {
	onICUEInitialized: function () {
		if (window.App) App.onIcueInitialized();
	},
	onDataUpdated: function () {
		if (window.App) App.onIcueDataUpdated();
	},
};
pluginSensorsdataproviderEvents = { onInitialized: function () { if (window.Icue) Icue.initSensors(); } };
pluginMediadataproviderEvents = { onInitialized: function () { if (window.Icue) Icue.initMedia(); } };
pluginFpsdataproviderEvents = { onInitialized: function () { if (window.Icue) Icue.initFps(); } };
pluginLinkproviderEvents = { onInitialized: function () {} };

var U = (function () {
	function getProp(name, fallback) {
		try {
			if (Object.prototype.hasOwnProperty.call(window, name)) {
				var w = window[name];
				if (w !== undefined && w !== null && w !== "") return w;
			}
		} catch (e) {}
		try {
			var v = Function('return typeof ' + name + ' !== "undefined" ? ' + name + " : undefined")();
			if (v !== undefined && v !== null && v !== "") return v;
		} catch (e) {}
		return fallback;
	}

	function flag(name) {
		try {
			return Function('return typeof ' + name + ' !== "undefined" && !!' + name)();
		} catch (e) {
			return false;
		}
	}

	function el(tag, cls, html) {
		var n = document.createElement(tag);
		if (cls) n.className = cls;
		if (html !== undefined) n.innerHTML = html;
		return n;
	}

	function esc(s) {
		return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
			return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
		});
	}

	function clamp(v, a, b) {
		return Math.max(a, Math.min(b, v));
	}

	function hexToRgb(hex, fallback) {
		var h = String(hex || "").trim().replace("#", "");
		if (h.length === 8) h = h.slice(2); // Qt-style #AARRGGBB
		if (!/^[0-9a-f]{6}$/i.test(h)) return fallback;
		return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
	}

	/* Set text only when it changed (avoids needless layout work on the device). */
	function setText(node, text) {
		text = String(text);
		if (node.__t !== text) {
			node.__t = text;
			node.textContent = text;
		}
	}

	function setHtml(node, html) {
		if (node.__h !== html) {
			node.__h = html;
			node.innerHTML = html;
		}
	}

	var toastTimer = null;
	function toast(msg) {
		var t = document.getElementById("toast");
		t.textContent = msg;
		t.hidden = false;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(function () {
			t.hidden = true;
		}, 2000);
	}

	/* Promise wrapper for iCUE's "requestId + asyncResponse" plugin calls. */
	function asyncCaller(plugin) {
		var nextId = 1;
		var pending = {};
		plugin.asyncResponse.connect(function (rid, value) {
			var cb = pending[rid];
			if (cb) {
				delete pending[rid];
				cb(value);
			}
		});
		return function (method) {
			var args = Array.prototype.slice.call(arguments, 1);
			return new Promise(function (resolve) {
				if (typeof plugin[method] !== "function") return resolve(undefined);
				var rid = nextId++;
				pending[rid] = resolve;
				setTimeout(function () {
					if (pending[rid]) {
						delete pending[rid];
						resolve(undefined);
					}
				}, 5000);
				try {
					plugin[method].apply(plugin, [rid].concat(args));
				} catch (e) {
					delete pending[rid];
					resolve(undefined);
				}
			});
		};
	}

	/* unit "mbit": megabits like speed tests (1 MB/s = 8 Mbit/s). "mbyte": megabytes like downloads. */
	function formatRate(bytesPerSec, unit) {
		var b = Number(bytesPerSec) || 0;
		if (unit === "mbyte") {
			if (b >= 1048576) return { v: (b / 1048576).toFixed(b >= 10485760 ? 0 : 1), u: "MB/s" };
			return { v: String(Math.round(b / 1024)), u: "KB/s" };
		}
		var mbit = (b * 8) / 1000000;
		if (mbit >= 1) return { v: mbit >= 100 ? String(Math.round(mbit)) : mbit.toFixed(1), u: "Mbit/s" };
		return { v: String(Math.round((b * 8) / 1000)), u: "kbit/s" };
	}

	/* Scroll a list by dragging it with a finger (sliders inside hand vertical swipes over to this). */
	function dragScroll(box, moreHint) {
		box.classList.add("scroll-y");
		var start = null, top = 0, moved = false;
		function hint() {
			if (!moreHint) return;
			var more = box.scrollHeight - box.clientHeight - box.scrollTop > 4;
			moreHint.classList.toggle("on", more);
		}
		box.addEventListener("scroll", hint);
		box.addEventListener("pointerdown", function (e) {
			if (document.body.classList.contains("editing") || e.target.closest(".slider")) return;
			start = { y: e.clientY, id: e.pointerId };
			top = box.scrollTop;
			moved = false;
		});
		box.addEventListener("pointermove", function (e) {
			if (!start) return;
			var dy = e.clientY - start.y;
			if (!moved && Math.abs(dy) > 6) {
				moved = true;
				try { box.setPointerCapture(start.id); } catch (x) {}
			}
			if (moved) box.scrollTop = top - dy;
		});
		function end() {
			if (moved) {
				// Don't let the end of a swipe count as a tap on whatever is under the finger.
				var stop = function (ev) { ev.stopPropagation(); ev.preventDefault(); window.removeEventListener("click", stop, true); };
				window.addEventListener("click", stop, true);
				setTimeout(function () { window.removeEventListener("click", stop, true); }, 300);
			}
			start = null;
			moved = false;
		}
		box.addEventListener("pointerup", end);
		box.addEventListener("pointercancel", end);
		setTimeout(hint, 300);
		return hint;
	}

	function formatGB(gb) {
		gb = Number(gb) || 0;
		return gb >= 1000 ? (gb / 1024).toFixed(2) + " TB" : Math.round(gb) + " GB";
	}

	/* Line icons, 24×24, drawn for this widget. */
	var ICONS = {
		headset: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="7" rx="1.5"/><rect x="17" y="14" width="4" height="7" rx="1.5"/>',
		keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M9 14h6"/>',
		hourglass: '<path d="M6 3h12M6 21h12M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9s10 4 10 9"/>',
		rocket: '<path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2"/><path d="M9 15l-3-3c1-4 4-8 9-9 1 5-3 8-9 12z"/><circle cx="14.5" cy="9.5" r="1.5"/>',
		gamepad: '<rect x="2.5" y="7" width="19" height="10" rx="5"/><path d="M7 10v4M5 12h4M15.5 11h.01M18 13h.01"/>',
		record: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5" class="f"/>',
		clip: '<path d="M4 7h11a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z"/><path d="M17 10l5-3v10l-5-3"/>',
		stream: '<circle cx="12" cy="12" r="2"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19 5a10 10 0 0 1 0 14M5 19A10 10 0 0 1 5 5"/>',
		plan: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
		list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
		image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
		search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
		history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3 4v4.5h4.5"/><path d="M12 8v4.5l3 2"/>',
		backspace: '<path d="M21 6H9l-6 6 6 6h12z"/><path d="M17 10l-4 4M13 10l4 4"/>',
		addlist: '<path d="M4 6h11M4 11h11M4 16h7"/><path d="M18 13v7M14.5 16.5h7"/>',
		talk: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/><path d="M3 4.5l2 1.5M21 4.5l-2 1.5"/>',
		heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
		star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
		home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
		chat: '<path d="M4 5h16v11H9l-5 4z"/>',
		camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
		trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M9 17h6"/>',
		plane: '<path d="M10.5 3.5c0-.8.7-1.5 1.5-1.5s1.5.7 1.5 1.5V9l8 5v2l-8-2.5V19l2.5 2v1.5L12 21.5l-4 1V21l2.5-2v-5.5L2.5 16v-2l8-5z"/>',
		speaker: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 9a4 4 0 0 1 0 6"/><path d="M18.5 6.5a8 8 0 0 1 0 11"/>',
		speakerOff: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 9l5 6M22 9l-5 6"/>',
		mic: '<rect x="9" y="2.5" width="6" height="11.5" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
		micOff: '<rect x="9" y="2.5" width="6" height="11.5" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M3 3l18 18"/>',
		mixer: '<path d="M6 4v16M12 4v16M18 4v16"/><circle cx="6" cy="14" r="2" class="f"/><circle cx="12" cy="8" r="2" class="f"/><circle cx="18" cy="16" r="2" class="f"/>',
		power: '<path d="M12 3v8"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/>',
		lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
		moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
		restart: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v5h5"/>',
		folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H10l2 2h7.5A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z"/>',
		clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
		gauge: '<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l4-5"/>',
		sensor: '<path d="M10 4a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z"/><path d="M12 9v7"/>',
		network: '<path d="M8 4v14M8 18l-3.5-3.5M8 18l3.5-3.5"/><path d="M16 20V6M16 6l-3.5 3.5M16 6l3.5 3.5"/>',
		storage: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 13h18"/><circle cx="17" cy="16" r="0.8" class="f"/>',
		battery: '<rect x="2.5" y="7" width="17" height="10" rx="2"/><path d="M21.5 10.5v3"/>',
		sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
		music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
		fps: '<path d="M3 17l5-6 4 3 6-8"/><path d="M14 6h4v4"/>',
		apps: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
		desktop: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/>',
		screenshot: '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><circle cx="12" cy="12" r="3"/>',
		taskmanager: '<path d="M3 12h4l2-5 3 10 2-5h7"/>',
		settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
		explorer: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H10l2 2h7.5A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z"/><path d="M3 10h18"/>',
		calculator: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"/>',
		globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
		bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
		plus: '<path d="M12 5v14M5 12h14"/>',
		x: '<path d="M6 6l12 12M18 6L6 18"/>',
		pencil: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
		copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
		resize: '<path d="M20 14v6h-6M20 20l-7-7"/>',
		back: '<path d="M15 5l-7 7 7 7"/>',
		up: '<path d="M5 15l7-7 7 7"/>',
		cloud: '<path d="M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 9.5 4.3 4.3 0 0 0 7 18z"/>',
		partly: '<path d="M9 18h8a3.5 3.5 0 0 0 .4-7A5 5 0 0 0 8 11a3.5 3.5 0 0 0 1 7z"/><path d="M7.5 4v1.5M3.5 8H5M4.6 4.6l1 1M11 5.6l-1 1"/>',
		rain: '<path d="M7 14h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 5.5 4.3 4.3 0 0 0 7 14z"/><path d="M8 17l-1 3M12 17l-1 3M16 17l-1 3"/>',
		snow: '<path d="M7 14h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 5.5 4.3 4.3 0 0 0 7 14z"/><path d="M8 18h.01M12 20h.01M16 18h.01M10 21h.01M14 22h.01"/>',
		storm: '<path d="M7 14h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 5.5 4.3 4.3 0 0 0 7 14z"/><path d="M12 15l-2 4h4l-2 4"/>',
		fog: '<path d="M4 10h16M3 14h18M5 18h14"/>',
		calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
		news: '<path d="M4 5h13v14H6a2 2 0 0 1-2-2z"/><path d="M17 9h3v8a2 2 0 0 1-2 2"/><path d="M7 9h7M7 12h7M7 15h4"/>',
		box: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
		timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9 2h6"/>',
		flag: '<path d="M5 21V4M5 4h12l-2 4 2 4H5"/>',
		globe2: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
		note: '<path d="M5 3h10l4 4v14H5z"/><path d="M15 3v4h4M8 11h8M8 15h6"/>',
		brush: '<path d="M14 4l6 6-8 8H6v-6z"/><path d="M4 20c1-3 3-4 5-4"/>',
		clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h4"/>',
		shuffle: '<path d="M3 7h3.5c2 0 3.3 1 4.5 3l2 4c1.2 2 2.5 3 4.5 3H21M3 17h3.5c1.4 0 2.4-.5 3.3-1.5M14.2 8.5C15 7.5 16 7 17.5 7H21M18 4l3 3-3 3M18 14l3 3-3 3"/>',
		repeat: '<path d="M4 11V9a3 3 0 0 1 3-3h13M17 3l3 3-3 3M20 13v2a3 3 0 0 1-3 3H4M7 21l-3-3 3-3"/>',
		chart: '<path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/>',
		thermo: '<path d="M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0z"/><path d="M12 9v7"/>',
		ping: '<path d="M2 12h3l3-7 4 14 3-7h7"/>',
		speed: '<path d="M4 18a9 9 0 1 1 16 0"/><path d="M12 15l4-6"/><circle cx="12" cy="15" r="1.5" class="f"/>',
		window: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01"/>',
		disk: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
		down: '<path d="M5 9l7 7 7-7"/>',
		pages: '<rect x="3" y="5" width="13" height="15" rx="2"/><path d="M8 5V4a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-4"/>',
		prev: '<path d="M6 5v14"/><path class="f" d="M19 5.5v13L9 12z"/>',
		next: '<path d="M18 5v14"/><path class="f" d="M5 5.5v13L15 12z"/>',
		play: '<path class="f" d="M8 5.5v13l10.5-6.5z"/>',
		pause: '<path class="f" d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>',
		check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
		out: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
		crosshair: '<circle cx="12" cy="12" r="8"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/><circle cx="12" cy="12" r="1"/>',
		bomb: '<circle cx="10.5" cy="14" r="7"/><path d="M15.5 9l2-2M17 5.5l1.5-1.5M19.5 7l1.5.5M18 3l.5 1.5"/><path d="M7.5 12.5a3 3 0 0 1 3-3"/>',
		shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
		bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
		coins: '<ellipse cx="9" cy="7" rx="6" ry="3"/><path d="M3 7v4c0 1.7 2.7 3 6 3s6-1.3 6-3V7"/><path d="M9 14v3c0 1.7 2.7 3 6 3s6-1.3 6-3v-4c0-1.6-2.4-2.9-5.5-3"/>',
		radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12l6.5-6.5"/><circle cx="15.5" cy="15" r="1"/>',
		wand: '<path d="M4 20L15 9M13 7l4 4"/><path d="M18 3v3M16.5 4.5h3M20 9v2M19 10h2M10 3v2M9 4h2"/>',
		pulse: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
		skull: '<path d="M12 3a8 8 0 0 0-8 8c0 3 1.5 4.5 3 5.5V20h10v-3.5c1.5-1 3-2.5 3-5.5a8 8 0 0 0-8-8z"/><circle cx="9" cy="11.5" r="1.5"/><circle cx="15" cy="11.5" r="1.5"/>',
		launch: '<rect x="3" y="4" width="7" height="9" rx="1.5"/><rect x="14" y="4" width="7" height="9" rx="1.5"/><rect x="3" y="15" width="18" height="5" rx="1.5"/>',
	};

	function svg(name, cls) {
		return '<svg class="ic' + (cls ? " " + cls : "") + '" viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[name] || ICONS.bolt) + "</svg>";
	}

	return {
		getProp: getProp,
		flag: flag,
		el: el,
		esc: esc,
		clamp: clamp,
		hexToRgb: hexToRgb,
		setText: setText,
		setHtml: setHtml,
		toast: toast,
		asyncCaller: asyncCaller,
		formatRate: formatRate,
		dragScroll: dragScroll,
		formatGB: formatGB,
		svg: svg,
	};
})();
