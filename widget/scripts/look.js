/* Control Panel — look and feel: glass tiles, night mode, screensaver, accent color from the album cover, tap sound. */

var Look = (function () {
	var el = U.el, esc = U.esc;
	var sleeping = false;

	/* ------------------------------------------------------------------ apply settings */
	function apply() {
		var b = document.body;
		b.classList.toggle("glass", Cfg.tileStyle === "glass");
		// The new look, unless you picked Classic look (Edit → Pages → Look).
		var lk = typeof Editor !== "undefined" ? Editor.storeGet("cpLook") : "";
		b.classList.toggle("fresh", lk !== "classic");
		// Studio: the newest look (black-friendly tiles, big covers, thick sliders). The default.
		b.classList.toggle("studio", !lk || lk === "studio");
		var g = U.clamp(Cfg.glassStrength, 0, 100) / 100;
		var r = document.documentElement.style;
		r.setProperty("--glass-a", (0.82 - g * 0.6).toFixed(2));
		r.setProperty("--glass-blur", Math.round(4 + g * 18) + "px");
		applyAccent();
		setupNight();
		resetIdle();
		if (typeof Round8 !== "undefined") Round8.applyLook();
	}

	/* ------------------------------------------------------------------ accent color from the album cover */
	var coverRgb = null, coverFor = "", baseRgb = null;

	/* The accent when no album cover gives one: the iCUE color, or (Look) the color of the background picture. */
	function setBaseAccent(rgb) { baseRgb = rgb; applyAccent(); }

	function applyAccent() {
		var own = document.body.classList.contains("studio") && typeof Editor !== "undefined" && Editor.storeGet("cpAccent");
		var a = Cfg.coverAccent && coverRgb ? coverRgb : own ? U.hexToRgb(own, [43, 179, 163]) : baseRgb || U.hexToRgb(Cfg.accent, [43, 179, 163]);
		var r = document.documentElement.style;
		r.setProperty("--accent", "rgb(" + a.join(",") + ")");
		r.setProperty("--accent-rgb", a.join(","));
	}

	function onCover(url) {
		if (url === coverFor) return;
		coverFor = url;
		if (!url) {
			coverRgb = null;
			return applyAccent();
		}
		var img = new Image();
		img.onload = function () {
			if (coverFor !== url) return;
			coverRgb = vividColor(img);
			applyAccent();
		};
		img.onerror = function () { coverRgb = null; applyAccent(); };
		img.src = url;
	}

	/* The most colorful main color of a picture, made bright enough to read on. */
	function vividColor(img) {
		try {
			var c = document.createElement("canvas");
			c.width = c.height = 32;
			var x = c.getContext("2d");
			x.drawImage(img, 0, 0, 32, 32);
			var d = x.getImageData(0, 0, 32, 32).data;
			var buckets = [];
			for (var i = 0; i < 12; i++) buckets.push({ w: 0, r: 0, g: 0, b: 0 });
			var total = 0;
			for (var p = 0; p < d.length; p += 4) {
				var R = d[p] / 255, G = d[p + 1] / 255, B = d[p + 2] / 255;
				var max = Math.max(R, G, B), min = Math.min(R, G, B), v = max, s = max ? (max - min) / max : 0;
				if (v < 0.2 || s < 0.25) continue;
				var h = hue(R, G, B, max, min);
				var w = s * s * v;
				var k = buckets[Math.floor(h / 30) % 12];
				k.w += w; k.r += d[p] * w; k.g += d[p + 1] * w; k.b += d[p + 2] * w;
				total += w;
			}
			if (total < 8) return null; // black and white cover: keep the normal accent
			var best = buckets.reduce(function (a, b) { return b.w > a.w ? b : a; });
			var hsl = toHsl(best.r / best.w, best.g / best.w, best.b / best.w);
			hsl[1] = Math.max(hsl[1], 0.5);
			hsl[2] = U.clamp(hsl[2], 0.42, 0.58);
			return fromHsl(hsl[0], hsl[1], hsl[2]);
		} catch (e) {
			return null; // a cover from another site can't be read
		}
	}

	function hue(r, g, b, max, min) {
		if (max === min) return 0;
		var d = max - min, h;
		if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
		else if (max === g) h = (b - r) / d + 2;
		else h = (r - g) / d + 4;
		return h * 60;
	}

	function toHsl(r, g, b) {
		r /= 255; g /= 255; b /= 255;
		var max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, s = 0;
		if (max !== min) s = l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
		return [hue(r, g, b, max, min) / 360, s, l];
	}

	function fromHsl(h, s, l) {
		function f(p, q, t) {
			if (t < 0) t += 1;
			if (t > 1) t -= 1;
			if (t < 1 / 6) return p + (q - p) * 6 * t;
			if (t < 1 / 2) return q;
			if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
			return p;
		}
		var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
		return [f(p, q, h + 1 / 3), f(p, q, h), f(p, q, h - 1 / 3)].map(function (v) { return Math.round(v * 255); });
	}

	/* ------------------------------------------------------------------ night mode */
	var nightTimer = null;

	function minutesOf(text, fallback) {
		var m = /^\s*(\d{1,2})[:.]?(\d{2})?\s*$/.exec(String(text || ""));
		if (!m || +m[1] > 23 || +(m[2] || 0) > 59) return fallback;
		return +m[1] * 60 + +(m[2] || 0);
	}

	function isNight() {
		var now = new Date(), n = now.getHours() * 60 + now.getMinutes();
		var a = minutesOf(Cfg.nightStart, 22 * 60), b = minutesOf(Cfg.nightEnd, 7 * 60);
		return a <= b ? n >= a && n < b : n >= a || n < b;
	}

	var panel = { dim: 0, warm: false };

	function checkNight() {
		var dim = document.getElementById("dim");
		var on = Cfg.nightMode && isNight();
		var night = on ? U.clamp(Cfg.nightDim, 0, 90) : 0;
		dim.style.opacity = String(Math.max(night, U.clamp(panel.dim, 0, 85)) / 100);
		document.body.classList.toggle("night", on);
		var warm = document.getElementById("warm");
		if (warm) warm.style.opacity = panel.warm ? "1" : "0";
	}

	/* Brightness tile: dim the Control Panel and/or a warm night light, on the panel only. */
	function setPanel(p) {
		if (p.dim === panel.dim && p.warm === panel.warm) return;
		panel = { dim: p.dim || 0, warm: !!p.warm };
		checkNight();
	}

	function setupNight() {
		clearInterval(nightTimer);
		nightTimer = null;
		checkNight();
		if (Cfg.nightMode) nightTimer = setInterval(checkNight, 30000);
	}

	/* ------------------------------------------------------------------ screensaver */
	var idleTimer = null, saverTimer = null;

	function resetIdle() {
		clearTimeout(idleTimer);
		idleTimer = null;
		var min = +Cfg.screensaver || 0;
		if (min > 0 && !sleeping) idleTimer = setTimeout(sleep, min * 60000);
	}

	function sleep() {
		if (App.editing || !document.getElementById("modal").hidden) return resetIdle();
		sleeping = true;
		var s = document.getElementById("saver");
		s.hidden = false;
		drawSaver();
		saverTimer = setInterval(drawSaver, 10000);
		App.refreshNeeds();
	}

	function wake() {
		if (!sleeping) return resetIdle();
		sleeping = false;
		clearInterval(saverTimer);
		document.getElementById("saver").hidden = true;
		App.refreshNeeds();
		App.render();
		Helper.poll();
		resetIdle();
	}

	function drawSaver() {
		var s = document.getElementById("saver");
		if (typeof Round8 !== "undefined" && Round8.drawSaver(s)) return;
		var now = new Date();
		var h = now.getHours(), m = now.getMinutes();
		var t24 = Cfg.clock24h;
		var time = (t24 ? (h < 10 ? "0" : "") + h : (h % 12 || 12)) + ":" + (m < 10 ? "0" : "") + m;
		var date = now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
		var md = Icue.media || {};
		var song = md.song ? '<div class="sv-song">' + (md.thumb ? '<img alt="" src="' + esc(md.thumb) + '" />' : "") + "<span><b>" + esc(md.song) + "</b><em>" + esc(md.artist || "") + "</em></span></div>" : "";
		s.innerHTML = '<div class="sv-box"><div class="sv-time">' + time + (t24 ? "" : '<small>' + (h < 12 ? "AM" : "PM") + "</small>") + '</div><div class="sv-date">' + esc(date) + "</div>" + song + "</div>";
		// Move a little every minute so nothing stays in the same place.
		var k = Math.floor(Date.now() / 60000);
		var box = s.firstChild;
		box.style.transform = "translate(" + ((k * 37) % 41 - 20) + "px," + ((k * 23) % 31 - 15) + "px)";
	}

	/* ------------------------------------------------------------------ tap sound */
	var audio = null;

	function click() {
		try {
			var Ctx = window.AudioContext || window.webkitAudioContext;
			if (!Ctx) return;
			audio = audio || new Ctx();
			if (audio.state === "suspended") audio.resume();
			var t = audio.currentTime;
			var o = audio.createOscillator(), g = audio.createGain();
			o.type = "triangle";
			o.frequency.setValueAtTime(1400, t);
			o.frequency.exponentialRampToValueAtTime(600, t + 0.04);
			g.gain.setValueAtTime(0.0001, t);
			g.gain.exponentialRampToValueAtTime(0.18, t + 0.004);
			g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
			o.connect(g);
			g.connect(audio.destination);
			o.start(t);
			o.stop(t + 0.07);
		} catch (e) {}
	}

	/* ------------------------------------------------------------------ wiring */
	function wire() {
		var saver = document.getElementById("saver");
		saver.addEventListener("click", function (e) {
			e.stopPropagation();
			wake();
		});
		document.addEventListener("pointerdown", function (e) {
			if (sleeping) return;
			resetIdle();
			if (Cfg.tapSound && !App.editing && e.target.closest("button, .press, .slider, .tile")) click();
		}, true);
	}

	return {
		apply: apply,
		wire: wire,
		wake: wake,
		setPanel: setPanel,
		onCover: onCover,
		setBaseAccent: setBaseAccent,
		sleepNow: function () { clearTimeout(idleTimer); sleep(); },
		get sleeping() { return sleeping; },
		_vivid: vividColor,
	};
})();
