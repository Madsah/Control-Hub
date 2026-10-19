/* Control Panel — tile types.
 * Each type: build(ctx) draws the tile once and returns update(), which is called whenever
 * data changes and only touches what changed. ctx = { node, body, tile, w, h, cell }.
 */

var T = (function () {
	var svg = U.svg, el = U.el, esc = U.esc, setText = U.setText, setHtml = U.setHtml;

	/* ------------------------------------------------------------------ shortcuts data */
	var QUICK = {
		desktop: { name: "Desktop", icon: "desktop" },
		screenshot: { name: "Screenshot", icon: "screenshot", uri: "ms-screenclip:" },
		taskmanager: { name: "Task Manager", icon: "taskmanager" },
		settings: { name: "Settings", icon: "settings", uri: "ms-settings:" },
		explorer: { name: "File Explorer", icon: "explorer" },
		calculator: { name: "Calculator", icon: "calculator", uri: "calculator:" },
		// Pop-outs: a panel opens over the page (Popout, popout.js). "sound" used to open Windows' sound settings.
		sound: { name: "Sound (pop-out)", icon: "mixer", popout: "sound" },
		powerpanel: { name: "Power (pop-out)", icon: "power", popout: "power" },
		soundsettings: { name: "Sound settings", icon: "speaker", uri: "ms-settings:sound", sends: "sound" },
		flightline: { name: "FlightLine", icon: "plane", act: "openFlightLine" },
		flsession: { name: "Start flight session", icon: "plane", act: "flightSessionStart" },
		flsessionend: { name: "End flight session", icon: "out", act: "flightSessionEnd" },
		lock: { name: "Lock PC", icon: "lock" },
		nightlight: { name: "Night light settings", icon: "moon", uri: "ms-settings:nightlight" },
		display: { name: "Display settings", icon: "desktop", uri: "ms-settings:display" },
	};

	var SITES = [
		{ name: "YouTube", url: "https://www.youtube.com", domain: "youtube.com" },
		{ name: "Twitch", url: "https://www.twitch.tv", domain: "twitch.tv" },
		{ name: "Reddit", url: "https://www.reddit.com", domain: "reddit.com" },
		{ name: "Gmail", url: "https://mail.google.com", domain: "mail.google.com" },
		{ name: "Netflix", url: "https://www.netflix.com", domain: "netflix.com" },
		{ name: "Google", url: "https://www.google.com", domain: "google.com" },
		{ name: "SimBrief", url: "https://dispatch.simbrief.com", domain: "simbrief.com" },
		{ name: "Navigraph Charts", url: "https://charts.navigraph.com", domain: "navigraph.com" },
		{ name: "Flightradar24", url: "https://www.flightradar24.com", domain: "flightradar24.com" },
		{ name: "SkyVector", url: "https://skyvector.com", domain: "skyvector.com" },
	];

	function faviconUrl(domain) {
		return Cfg.onlineLogos && domain ? "https://www.google.com/s2/favicons?sz=128&domain=" + encodeURIComponent(domain) : "";
	}

	/* The picture for a shortcut: real app icon (helper), website logo, or a line icon. */
	function shortcutLogo(cfg, cls) {
		var box = el("span", "logo " + (cls || ""));
		var glyph = cfg.kind === "quick" ? (QUICK[cfg.what] || {}).icon : cfg.kind === "url" ? "globe" : "apps";
		box.innerHTML = svg(glyph || "bolt");
		var src = cfg.kind === "app" || cfg.kind === "file" ? Helper.iconUrl(cfg.icon) : cfg.kind === "url" ? faviconUrl(cfg.domain) : "";
		if (src) {
			var img = new Image();
			img.alt = "";
			img.onload = function () {
				if (img.naturalWidth && img.naturalWidth < 20) return; // "no logo" placeholder
				box.innerHTML = "";
				box.classList.add("has-img");
				box.appendChild(img);
			};
			img.src = src;
		}
		return box;
	}

	/* Shortcuts from a page file or a ready-made page name the app ("find") instead of this PC's app id.
	   The first time the helper is running, the name is looked up in the installed apps and remembered. */
	var appsJob = null;
	function findApp(cfg) {
		if (!Helper.online) return Promise.resolve(null);
		if (!appsJob) {
			appsJob = (Helper.apps ? Promise.resolve(Helper.apps) : Helper.loadApps(false)).then(null, function () { return []; });
			appsJob.then(function () { setTimeout(function () { appsJob = null; }, 60000); });
		}
		var names = [].concat(cfg.find || []).map(function (n) { return String(n).toLowerCase(); });
		return appsJob.then(function (apps) {
			apps = (apps || []).filter(function (a) { return a.kind !== "url"; });
			function low(a) { return String(a.name || "").toLowerCase(); }
			for (var i = 0; i < names.length; i++) {
				var n = names[i], hit = apps.filter(function (a) { return low(a) === n; })[0] ||
					apps.filter(function (a) { return low(a).indexOf(n) === 0; })[0] ||
					apps.filter(function (a) { return (" " + low(a)).indexOf(" " + n) >= 0; })[0];
				if (hit) return hit;
			}
			return null;
		});
	}
	function resolveApp(cfg) {
		return findApp(cfg).then(function (a) {
			if (!a || !cfg.find) return a ? cfg : null;
			cfg.id = a.id;
			cfg.icon = a.icon;
			if (a.kind === "file") cfg.kind = "file";
			if (!cfg.name) cfg.name = a.name;
			delete cfg.find;
			if (typeof Editor !== "undefined" && Editor.save) Editor.save();
			return cfg;
		});
	}

	function runShortcut(cfg) {
		if (!cfg || !cfg.kind) return U.toast("Tap Edit, then ✏ to pick what this button opens");
		if (cfg.kind === "app" && !cfg.id && cfg.find) {
			if (!Helper.online) return U.toast("Start Control Hub to open apps");
			return resolveApp(cfg).then(function (c) {
				if (c) Helper.act({ action: "launch", id: c.id });
				else if (cfg.steam) Helper.act({ action: "steamRun", id: String(cfg.steam) });
				else U.toast("Couldn't find " + (cfg.name || "that app") + " on this PC. Tap Edit, then ✏ to pick it");
			});
		}
		if (cfg.kind === "quick") {
			var q = QUICK[cfg.what] || {};
			if (q.popout) {
				if (typeof Popout !== "undefined") Popout.open(q.popout);
				return;
			}
			if (q.act) return Helper.online ? Helper.act({ action: q.act }) : U.toast("Start Control Hub for this button");
			if (Helper.online) return Helper.act({ action: "quick", what: q.sends || cfg.what });
			if (q.uri && Icue.openLink(q.uri)) return;
			return U.toast("Start Control Hub for this button");
		}
		if (cfg.kind === "url") {
			// Websites you added in the helper are opened by id.
			if (!cfg.url && cfg.id) {
				if (!Helper.online) return U.toast("Start Control Hub for this website");
				return Helper.act({ action: "launch", id: cfg.id });
			}
			if (Helper.online) return Helper.act({ action: "openUrl", url: cfg.url });
			if (!Icue.openLink(cfg.url)) U.toast("Couldn't open the link");
			return;
		}
		if (!Helper.online) return U.toast("Start Control Hub to open apps");
		Helper.act({ action: "launch", id: cfg.id });
	}

	/* The name under a button's icon: "show" always, "hide" never (icon only), else only when it fits.
	   A name that would be cut off ("File Expl…") is left out and the icon gets the room. */
	function fitName(node, wrap, nm, mode) {
		node.classList.toggle("sc-noname", mode === "hide");
		if (mode === "hide" || mode === "show") return;
		requestAnimationFrame(function () {
			if (!nm.parentNode || !nm.clientWidth) return;
			function cut() { return nm.scrollWidth > nm.clientWidth + 1 || wrap.scrollHeight > wrap.parentNode.clientHeight + 1; }
			if (!cut()) return;
			node.classList.add("sc-tight"); // try smaller letters first ("Task Manager")
			if (cut()) { node.classList.remove("sc-tight"); node.classList.add("sc-noname"); }
		});
	}

	/* ------------------------------------------------------------------ small building blocks */
	function head(icon, title) {
		return '<div class="th">' + svg(icon) + "<span>" + esc(title) + "</span></div>";
	}

	function helperGate(ctx) {
		if (Helper.online || Helper.pending) {
			if (ctx.__gated) {
				ctx.__gated = false;
				ctx.body.innerHTML = "";
				return "rebuild";
			}
			return false;
		}
		if (!ctx.__gated) {
			ctx.__gated = true;
			ctx.body.innerHTML = '<div class="notice"><b>Control Hub not running</b><span>Start Control Hub on your PC</span></div>';
		}
		return true;
	}

	/* Touch-friendly slider. onChange(value, final) is throttled while dragging.
	   A mostly up/down swipe scrolls the list the slider sits in instead of moving it. */
	function slider(parent, onChange, opts) {
		var vertical = !!(opts && opts.vertical);
		var wrap = el("div", "slider" + (vertical ? " vert" : ""));
		wrap.innerHTML = '<div class="track"><i class="fill"></i><i class="knob"></i></div>';
		parent.appendChild(wrap);
		var fill = wrap.querySelector(".fill"), knob = wrap.querySelector(".knob");
		var value = 0, active = false, mode = null, start = null, scroller = null, startTop = 0, lastSent = 0, timer = null;
		function show(v) {
			if (vertical) {
				fill.style.height = v + "%";
				knob.style.bottom = v + "%";
			} else {
				fill.style.width = v + "%";
				knob.style.left = v + "%";
			}
		}
		function fromEvent(e) {
			var r = wrap.getBoundingClientRect();
			if (vertical) return r.height ? Math.round(U.clamp((r.bottom - e.clientY) / r.height, 0, 1) * 100) : value;
			return Math.round(U.clamp((e.clientX - r.left) / r.width, 0, 1) * 100);
		}
		function send(final) {
			var now = Date.now();
			clearTimeout(timer);
			if (final || now - lastSent > 90) {
				lastSent = now;
				onChange(value, final);
			} else {
				timer = setTimeout(function () { send(false); }, 90);
			}
		}
		wrap.addEventListener("pointerdown", function (e) {
			if (document.body.classList.contains("editing")) return;
			active = true;
			mode = null;
			start = { x: e.clientX, y: e.clientY };
			scroller = wrap.closest(".scroll-y");
			startTop = scroller ? scroller.scrollTop : 0;
			try { wrap.setPointerCapture(e.pointerId); } catch (x) {}
			e.stopPropagation();
		});
		wrap.addEventListener("pointermove", function (e) {
			if (!active) return;
			var dx = e.clientX - start.x, dy = e.clientY - start.y;
			if (!mode) {
				if (vertical) { if (Math.abs(dx) + Math.abs(dy) > 4) mode = "slide"; else return; }
				else if (Math.abs(dx) > 6 && Math.abs(dx) >= Math.abs(dy)) mode = "slide";
				else if (Math.abs(dy) > 6) mode = scroller ? "scroll" : "slide";
				else return;
			}
			if (mode === "scroll") scroller.scrollTop = startTop - dy;
			else {
				value = fromEvent(e);
				show(value);
				send(false);
			}
		});
		function end(e) {
			if (!active) return;
			active = false;
			if (mode === "scroll") return;
			if (!mode && e && e.type === "pointerup") {
				value = fromEvent(e); // a tap jumps to that spot
				show(value);
			}
			send(true);
		}
		wrap.addEventListener("pointerup", end);
		wrap.addEventListener("pointercancel", function () {
			active = false;
		});
		// Taps on the slider must not count as taps on the tile (which would mute).
		wrap.addEventListener("click", function (e) { e.stopPropagation(); });
		return {
			set: function (v) {
				if (active) return;
				v = U.clamp(Math.round(v), 0, 100);
				if (v !== value) {
					value = v;
					show(v);
				}
			},
			el: wrap,
		};
	}

	/* ------------------------------------------------------------------ audio devices */
	function endpoints(isMic) {
		return (isMic ? Helper.state.inputs : Helper.state.outputs) || [];
	}

	/* The device a tile follows: the one picked in its settings, else the Windows default. */
	function endpointFor(isMic, id) {
		var list = endpoints(isMic), i;
		if (id) for (i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
		for (i = 0; i < list.length; i++) if (list[i].isDefault) return list[i];
		return list[0] || null;
	}

	function deviceChoices(isMic) {
		var list = endpoints(isMic);
		var def = endpointFor(isMic, "");
		var out = [{ value: "", label: "Windows default", sub: def ? "Now: " + def.name : "Follows whatever Windows uses" }];
		list.forEach(function (d) {
			out.push({ value: d.id, label: d.name || "Audio device", sub: d.isDefault ? "Windows default right now" : "" });
		});
		return out;
	}

	function looksLikeHeadset(name) {
		return /head|ear|buds|arctis|hyperx|virtuoso|void|hs\d|wireless/i.test(name || "");
	}

	/* Arc gauge (240°). */
	function arcPath(pct) {
		var a0 = 150, sweep = 240 * U.clamp(pct, 0, 100) / 100;
		function pt(a) {
			var r = (a * Math.PI) / 180;
			return (50 + 40 * Math.cos(r)).toFixed(2) + " " + (50 + 40 * Math.sin(r)).toFixed(2);
		}
		if (sweep <= 0.01) return "";
		return "M " + pt(a0) + " A 40 40 0 " + (sweep > 180 ? 1 : 0) + " 1 " + pt(a0 + sweep);
	}

	/* ------------------------------------------------------------------ data sources for gauges/sensor lists */
	var AUTO = {
		"auto:cpu": { label: "CPU load", find: function () { return Helper.online ? "helper:cpu" : sid(Icue.findSensor("load", "cpu|processor|package")); } },
		"auto:gpu": { label: "GPU load", find: function () { return sid(Icue.findSensor("load", "gpu|graphics")); } },
		"auto:cputemp": { label: "CPU temperature", find: function () { return sid(Icue.findSensor("temperature", "cpu|package|processor|tctl|tdie")); } },
		"auto:gputemp": { label: "GPU temperature", find: function () { return sid(Icue.findSensor("temperature", "gpu|graphics")); } },
		"auto:ram": { label: "RAM", find: function () { return Helper.online ? "helper:ram" : sid(Icue.findSensor("load", "memory")); } },
	};
	function sid(s) { return s ? s.id : null; }

	function resolve(src) {
		return AUTO[src] ? AUTO[src].find() : src;
	}

	/* {label, value(number|null), units} for a source key. */
	function readSource(src) {
		var real = resolve(src);
		var label = AUTO[src] ? AUTO[src].label : "";
		if (real === "helper:cpu") return { label: label || "CPU load", value: Helper.state.cpu, units: "%" };
		if (real === "helper:ram") return { label: label || "RAM", value: (Helper.state.memory || {}).percent, units: "%" };
		var s = real && Icue.sensors[real];
		if (!s) return { label: label || "Sensor", value: null, units: "" };
		var v = parseFloat(s.value);
		return { label: label || s.name, value: isFinite(v) ? v : null, units: s.units || "" };
	}

	function sourceUsesHelper(src) {
		var r = resolve(src);
		return r === "helper:cpu" || r === "helper:ram" || src === "auto:cpu" || src === "auto:ram";
	}

	function scaleOf(value, units) {
		var u = (units || "").toUpperCase();
		if (value == null) return 0;
		if (u.indexOf("%") >= 0) return value;
		if (u.indexOf("°F") >= 0) return (value - 32) / 1.8;
		if (u.indexOf("C") >= 0) return value;
		if (u.indexOf("RPM") >= 0) return (value / 3000) * 100;
		if (u === "W") return value / 4;
		return value;
	}

	/* A sensor value, counting to the new number if Look → Counting numbers is on. */
	function countValue(node, v, units, suffix) {
		if (v == null || typeof Round8 === "undefined" || !document.body.classList.contains("count-up")) return setText(node, v == null ? "--" : fmtValue(v, units) + (suffix || ""));
		var txt = fmtValue(v, units), dot = txt.indexOf(".");
		Round8.countTo(node, v, dot < 0 ? 0 : txt.length - dot - 1, suffix);
	}

	function fmtValue(v, units) {
		if (v == null) return "--";
		return Math.abs(v) < 10 && /^(V|A)$/i.test(units) ? v.toFixed(2) : Math.abs(v) < 10 && v % 1 ? v.toFixed(1) : String(Math.round(v));
	}

	/* ------------------------------------------------------------------ tile types */
	var types = {};

	types.shortcut = {
		name: "Shortcut", desc: "App, website or quick action", icon: "bolt", group: "shortcuts",
		w: 1, h: 1, minW: 1, minH: 1, maxW: 3, maxH: 3, editable: true,
		build: function (ctx) {
			var cfg = ctx.tile.cfg || {};
			ctx.node.classList.add("press", "shortcut");
			var body = ctx.body;
			if (!cfg.kind) {
				body.innerHTML = '<div class="sc"><span class="logo empty">' + svg("plus") + '</span><span class="nm">Pick app</span></div>';
			} else {
				var wrap = el("div", "sc");
				var logo = shortcutLogo(cfg);
				wrap.appendChild(logo);
				if (cfg.kind === "app" && !cfg.id && cfg.find && Helper.online) {
					resolveApp(cfg).then(function (c) {
						if (c && logo.parentNode) logo.parentNode.replaceChild(shortcutLogo(c), logo);
						else if (!c && !cfg.steam) ctx.node.classList.add("sc-missing");
					});
				}
				var nm = el("span", "nm");
				nm.textContent = cfg.name || "Shortcut";
				wrap.appendChild(nm);
				body.appendChild(wrap);
				fitName(ctx.node, wrap, nm, cfg.label);
			}
			ctx.node.addEventListener("click", function () {
				if (App.editing) return;
				ctx.node.classList.remove("ran");
				void ctx.node.offsetWidth;
				ctx.node.classList.add("ran");
				runShortcut(ctx.tile.cfg);
			});
			return null;
		},
	};

	types.folder = {
		name: "Folder", desc: "Group tiles together", icon: "folder", group: "shortcuts",
		w: 1, h: 1, minW: 1, minH: 1, maxW: 2, maxH: 2, editable: true,
		build: function (ctx) {
			var cfg = ctx.tile.cfg || {};
			var kids = cfg.children || [];
			ctx.node.classList.add("press", "folder");
			ctx.body.innerHTML = '<div class="sc"><span class="logo glyph">' + svg("folder") + '</span><span class="nm"></span><span class="sub"></span></div>';
			ctx.body.querySelector(".nm").textContent = cfg.name || "Folder";
			ctx.body.querySelector(".sub").textContent = kids.length + (kids.length === 1 ? " item" : " items");
			ctx.node.addEventListener("click", function () {
				if (App.editing) return;
				Editor.openFolder(ctx.tile);
			});
			return null;
		},
	};

	types.media = {
		name: "Media", desc: "Now playing with cover and volume", icon: "music", group: "media", parts: ["mixer"],
		w: 3, h: 2, minW: 2, minH: 1, maxW: 6, maxH: 4,
		build: function (ctx) {
			ctx.node.classList.add("media");
			ctx.body.innerHTML =
				'<div class="m-top"><div class="m-art">' + svg("music") + '</div><div class="m-text"><b class="m-song"></b><span class="m-artist"></span></div></div>' +
				'<div class="m-ctrl"><button class="m-btn" data-m="triggerPreviousTrack" aria-label="Previous">' + svg("prev") + "</button>" +
				'<button class="m-btn m-play" data-m="triggerPlayPause" aria-label="Play or pause"></button>' +
				'<button class="m-btn" data-m="triggerNextTrack" aria-label="Next">' + svg("next") + "</button></div>" +
				'<div class="m-vol"><button class="m-vbtn m-vdown" aria-label="Quieter">−</button><span class="m-vsl"></span><button class="m-vbtn m-vup" aria-label="Louder">+</button><b class="m-vval"></b></div>';
			// Volume of the app that plays (Spotify first), from the helper's app mixer.
			var vol = ctx.body.querySelector(".m-vol"), vval = ctx.body.querySelector(".m-vval"), volKey = null;
			function playerApp() {
				var m = (Helper.online && Helper.state.mixer) || [];
				var sp = m.filter(function (a) { return /spotify/i.test(a.name + " " + a.key); })[0];
				return sp || m.filter(function (a) { return a.key !== "system" && !/discord|teams|zoom/i.test(a.name); })[0] || null;
			}
			function setVol(v, final) {
				var a = playerApp();
				if (!a) return;
				a.volume = U.clamp(v, 0, 100);
				a.muted = false;
				Helper.hold("mixer");
				U.setText(vval, a.volume + "%");
				Helper.act({ action: "appVolume", key: a.key, value: a.volume }, !final);
			}
			var vsl = slider(ctx.body.querySelector(".m-vsl"), function (v, final) { setVol(v, final); });
			ctx.body.querySelector(".m-vdown").addEventListener("click", function (e) { e.stopPropagation(); if (!App.editing) { var a = playerApp(); if (a) { setVol(a.volume - 10, true); App.dirty(); } } });
			ctx.body.querySelector(".m-vup").addEventListener("click", function (e) { e.stopPropagation(); if (!App.editing) { var a = playerApp(); if (a) { setVol(a.volume + 10, true); App.dirty(); } } });
			var art = ctx.body.querySelector(".m-art"), song = ctx.body.querySelector(".m-song"), artist = ctx.body.querySelector(".m-artist"), play = ctx.body.querySelector(".m-play");
			ctx.body.querySelectorAll("[data-m]").forEach(function (b) {
				b.addEventListener("click", function (e) {
					e.stopPropagation();
					if (!App.editing) Icue.mediaCommand(b.dataset.m);
				});
			});
			var shownThumb = null;
			return function () {
				var m = Icue.media, has = !!m.song;
				setText(song, has ? m.song : "Nothing playing");
				setText(artist, has ? m.artist : "Play music in Spotify or any app");
				ctx.node.classList.toggle("idle", !has);
				var thumb = has ? m.thumb || "" : "";
				if (thumb !== shownThumb) {
					shownThumb = thumb;
					art.style.backgroundImage = thumb ? 'url("' + thumb.replace(/"/g, "") + '")' : "";
					art.classList.toggle("cover", !!thumb);
				}
				setHtml(play, svg(has && m.playing ? "pause" : "play"));
				var app = ctx.h >= 2 ? playerApp() : null;
				vol.style.display = app ? "" : "none";
				if (app) {
					vsl.set(app.volume);
					setText(vval, (app.muted ? "Muted" : app.volume + "%"));
					vol.title = app.name;
				}
			};
		},
	};

	function endpointTile(isMic) {
		var part = isMic ? "inputs" : "outputs";
		return {
			name: isMic ? "Microphone" : "Speakers", desc: isMic ? "Mic level and mute" : "Volume and mute (pick your headphones)",
			icon: isMic ? "mic" : "speaker", group: "media", helper: true, parts: ["audio"],
			w: 2, h: 1, minW: 2, minH: 1, maxW: 6, maxH: 2,
			options: function (tile) {
				return [{
					key: "device", label: isMic ? "Which microphone" : "Which output", type: "choice", layout: "list", "default": "",
					choices: deviceChoices(isMic), empty: "Start Control Hub to see your devices.",
				}];
			},
			build: function (ctx) {
				var sl, val, ico, dev, built = false;
				ctx.node.classList.add("press");
				function current() {
					return endpointFor(isMic, (ctx.tile.cfg || {}).device);
				}
				function toggleMute() {
					var s = current();
					if (!s) return;
					s.muted = !s.muted;
					Helper.hold(part);
					App.dirty();
					Helper.act({ action: isMic ? "micMute" : "speakersMute", device: s.id, value: s.muted });
				}
				function build() {
					ctx.body.innerHTML = '<div class="th"><span class="th-btn"></span><span class="ep-title">' + (isMic ? "Microphone" : "Speakers") + '</span><b class="th-val"></b></div><span class="ep-dev"></span>';
					ico = ctx.body.querySelector(".th-btn");
					val = ctx.body.querySelector(".th-val");
					dev = ctx.body.querySelector(".ep-dev");
					sl = slider(ctx.body, function (v, final) {
						var s = current();
						if (!s) return;
						Helper.hold(part);
						s.volume = v;
						if (v > 0) s.muted = false;
						setText(val, v);
						Helper.act({ action: isMic ? "micVolume" : "speakersVolume", device: s.id, value: v }, !final);
					});
					built = true;
				}
				// One tap anywhere on the tile (not the slider) mutes / unmutes.
				ctx.node.addEventListener("click", function () {
					if (App.editing || !Helper.online) return;
					toggleMute();
				});
				return function () {
					var g = helperGate(ctx);
					if (g === true) return (built = false);
					if (!built) build();
					var s = current() || {};
					sl.set(s.volume || 0);
					setText(val, s.muted ? "Muted" : s.available === false ? "–" : s.volume != null ? s.volume : "");
					setText(dev, s.name || "");
					setHtml(ico, svg(s.muted ? (isMic ? "micOff" : "speakerOff") : isMic ? "mic" : looksLikeHeadset(s.name) ? "headset" : "speaker"));
					ctx.node.classList.toggle("muted", !!s.muted);
				};
			},
		};
	}
	types.speakers = endpointTile(false);
	types.mic = endpointTile(true);

	/* Big "MIC LIVE / MUTED" sign. Tap to switch. */
	types.micstatus = {
		name: "Mic indicator", desc: "Big LIVE / MUTED sign, tap to switch", icon: "micOff", group: "media", helper: true, parts: ["audio"],
		w: 1, h: 1, minW: 1, minH: 1, maxW: 4, maxH: 2,
		options: function () {
			return [{ key: "device", label: "Which microphone", type: "choice", layout: "list", "default": "", choices: deviceChoices(true), empty: "Start Control Hub to see your devices." }];
		},
		build: function (ctx) {
			ctx.node.classList.add("press", "micstatus");
			ctx.body.innerHTML = '<div class="ms"><span class="ms-ic"></span><b class="ms-st"></b><span class="ms-dev"></span></div>';
			var ic = ctx.body.querySelector(".ms-ic"), st = ctx.body.querySelector(".ms-st"), dv = ctx.body.querySelector(".ms-dev");
			ctx.node.addEventListener("click", function () {
				if (App.editing) return;
				if (!Helper.online) return U.toast("Start Control Hub first");
				var s = endpointFor(true, (ctx.tile.cfg || {}).device);
				if (!s) return U.toast("No microphone found");
				s.muted = !s.muted;
				Helper.hold("inputs");
				App.dirty();
				Helper.act({ action: "micMute", device: s.id, value: s.muted });
			});
			return function () {
				var s = Helper.online ? endpointFor(true, (ctx.tile.cfg || {}).device) : null;
				var muted = !!(s && s.muted);
				ctx.node.classList.toggle("live", !!s && !muted);
				ctx.node.classList.toggle("off", muted);
				setHtml(ic, svg(muted ? "micOff" : "mic"));
				setText(st, !Helper.online ? "Control Hub off" : !s ? "No mic" : muted ? "MUTED" : "LIVE");
				setText(dv, s ? s.name : "");
			};
		},
	};

	/* Shows the Windows default output; a tap switches to the next device in your list. */
	types.output = {
		name: "Audio output", desc: "Switch headphones / speakers with a tap", icon: "headset", group: "media", helper: true, parts: ["audio"],
		w: 2, h: 1, minW: 1, minH: 1, maxW: 4, maxH: 2,
		options: function () {
			return [{
				key: "devices", label: "Switch between", type: "multi", layout: "list", "default": [],
				hint: "Pick two or more. If you pick none, it goes through all of them.",
				choices: endpoints(false).map(function (d) { return { value: d.id, label: d.name || "Audio device" }; }),
				empty: "Start Control Hub to see your devices.",
			}];
		},
		build: function (ctx) {
			ctx.node.classList.add("press", "outsw");
			ctx.body.innerHTML = head("headset", "Output") + '<div class="os"><span class="os-ic"></span><b class="os-name"></b></div><span class="os-hint">Tap to switch</span>';
			var ic = ctx.body.querySelector(".os-ic"), nm = ctx.body.querySelector(".os-name");
			ctx.node.addEventListener("click", function () {
				if (App.editing) return;
				if (!Helper.online) return U.toast("Start Control Hub first");
				var all = endpoints(false);
				var pick = ((ctx.tile.cfg || {}).devices || []).filter(function (id) {
					return all.some(function (d) { return d.id === id; });
				});
				var ids = pick.length >= 2 ? pick : all.map(function (d) { return d.id; });
				if (ids.length < 2) return U.toast("Only one output device found");
				var cur = endpointFor(false, "");
				var next = ids[(ids.indexOf(cur ? cur.id : "") + 1) % ids.length];
				all.forEach(function (d) { d.isDefault = d.id === next; });
				Helper.hold("outputs", 2500);
				App.dirty();
				var nd = endpointFor(false, next);
				U.toast("Switched to " + (nd ? nd.name : "next device"));
				Helper.act({ action: "setDefaultDevice", mic: false, device: next });
			});
			return function () {
				if (helperGate(ctx) === true) return;
				var cur = endpointFor(false, "");
				setHtml(ic, svg(cur && looksLikeHeadset(cur.name) ? "headset" : "speaker"));
				setText(nm, cur ? cur.name : "No output found");
			};
		},
	};

	types.mixer = {
		name: "App mixer", desc: "Volume for each app", icon: "mixer", group: "media", helper: true, parts: ["mixer"],
		w: 3, h: 3, minW: 2, minH: 2, maxW: 6, maxH: 6,
		build: function (ctx) {
			var list, rows = {}, built = false;
			function build() {
				ctx.body.innerHTML = head("mixer", "App mixer") + '<div class="mix-list"></div><div class="mix-more"></div>';
				list = ctx.body.querySelector(".mix-list");
				U.dragScroll(list, ctx.body.querySelector(".mix-more"));
				rows = {};
				built = true;
			}
			function makeRow(app) {
				var r = el("div", "mix-row");
				r.innerHTML = '<button class="mix-ic" aria-label="Mute"></button><div class="mix-main"><span class="mix-name"></span></div><b class="mix-val"></b>';
				var ic = r.querySelector(".mix-ic");
				ic.innerHTML = svg(app.key === "system" ? "speaker" : "apps");
				if (app.icon) {
					var img = new Image();
					img.alt = "";
					img.onload = function () {
						ic.innerHTML = "";
						ic.appendChild(img);
					};
					img.src = Helper.iconUrl(app.icon);
				}
				var row = { el: r, name: r.querySelector(".mix-name"), val: r.querySelector(".mix-val"), key: app.key };
				row.slider = slider(r.querySelector(".mix-main"), function (v, final) {
					Helper.hold("mixer");
					var a = findApp(row.key);
					if (a) { a.volume = v; a.muted = false; }
					setText(row.val, v);
					Helper.act({ action: "appVolume", key: row.key, value: v }, !final);
				});
				ic.addEventListener("click", function (e) {
					e.stopPropagation();
					if (App.editing) return;
					var a = findApp(row.key);
					if (!a) return;
					a.muted = !a.muted;
					Helper.hold("mixer");
					App.dirty();
					Helper.act({ action: "appMute", key: row.key, value: a.muted });
				});
				return row;
			}
			function findApp(key) {
				var m = Helper.state.mixer || [];
				for (var i = 0; i < m.length; i++) if (m[i].key === key) return m[i];
				return null;
			}
			return function () {
				var g = helperGate(ctx);
				if (g === true) return (built = false);
				if (!built) build();
				var apps = Helper.state.mixer || [];
				var seen = {};
				if (!apps.length) setHtml(list, '<div class="notice small"><span>No apps are playing sound right now</span></div>');
				else if (list.querySelector(".notice")) list.innerHTML = "";
				apps.forEach(function (a, i) {
					seen[a.key] = true;
					var row = rows[a.key];
					if (!row) {
						row = rows[a.key] = makeRow(a);
					}
					if (list.children[i] !== row.el) list.insertBefore(row.el, list.children[i] || null);
					setText(row.name, a.name);
					setText(row.val, a.muted ? "Muted" : a.volume);
					row.slider.set(a.volume);
					row.el.classList.toggle("muted", !!a.muted);
				});
				Object.keys(rows).forEach(function (k) {
					if (!seen[k]) {
						if (rows[k].el.parentNode) rows[k].el.parentNode.removeChild(rows[k].el);
						delete rows[k];
					}
				});
			};
		},
	};

	types.power = {
		name: "Power", desc: "Lock, sleep, restart, shut down", icon: "power", group: "system", helper: true,
		w: 2, h: 2, minW: 1, minH: 1, maxW: 4, maxH: 3,
		options: function () {
			return [{ key: "style", label: "Look", type: "choice", "default": "auto", choices: [
				{ value: "auto", label: "Automatic", sub: "Only the icon when the buttons don't fit" },
				{ value: "buttons", label: "Buttons", sub: "Lock, sleep, restart and shut down on the tile" },
				{ value: "icon", label: "Icon", sub: "Tap it and a power panel pops out" },
			] }];
		},
		build: function (ctx) {
			var style = (ctx.tile.cfg || {}).style || "auto";
			if (style === "icon" || (style === "auto" && (ctx.w < 2 || (ctx.h === 1 && ctx.w <= 3)))) {
				ctx.node.classList.add("press", "pw-iconic");
				ctx.body.innerHTML = '<div class="sc"><span class="logo">' + svg("power") + '</span><span class="nm">Power</span></div>';
				fitName(ctx.node, ctx.body.firstChild, ctx.body.querySelector(".nm"));
				ctx.node.addEventListener("click", function () {
					if (App.editing) return;
					if (typeof Popout !== "undefined") Popout.open("power");
				});
				return null;
			}
			ctx.body.innerHTML = head("power", "Power") + '<div class="pw-grid"></div>';
			var grid = ctx.body.querySelector(".pw-grid");
			var items = [
				["lock", "Lock", "lock", null],
				["sleep", "Sleep", "moon", { title: "Put the PC to sleep?", text: "Everything stays open. Move the mouse or press a key to wake it.", ok: "Sleep" }],
				["restart", "Restart", "restart", { title: "Restart the PC?", text: "Save your work first. Open programs will be closed.", ok: "Restart", danger: true }],
				["shutdown", "Shut down", "power", { title: "Shut down the PC?", text: "Save your work first. Open programs will be closed.", ok: "Shut down", danger: true }],
			];
			items.forEach(function (it) {
				var b = el("button", "pw-btn", svg(it[2]) + "<span>" + it[1] + "</span>");
				b.addEventListener("click", function (e) {
					e.stopPropagation();
					if (App.editing) return;
					if (!Helper.online) return U.toast("Start Control Hub for power buttons");
					if (!it[3]) return Helper.act({ action: "power", what: it[0] });
					var c = it[3];
					c.icon = it[2];
					Editor.confirm(c, function () { Helper.act({ action: "power", what: it[0] }); });
				});
				grid.appendChild(b);
			});
			return null;
		},
	};

	types.keepawake = {
		name: "Keep awake", desc: "Stop the PC from sleeping", icon: "sun", group: "system", helper: true,
		w: 1, h: 1, minW: 1, minH: 1, maxW: 2, maxH: 2,
		build: function (ctx) {
			ctx.node.classList.add("press", "toggle-tile");
			ctx.body.innerHTML = '<div class="tg">' + svg("sun") + '<span class="nm">Keep awake</span><span class="switch"><i></i></span><b class="st"></b></div>';
			var st = ctx.body.querySelector(".st");
			ctx.node.addEventListener("click", function () {
				if (App.editing) return;
				if (!Helper.online) return U.toast("Start Control Hub for this");
				Helper.state.keepAwake = !Helper.state.keepAwake;
				Helper.hold("keepAwake");
				App.dirty();
				Helper.act({ action: "keepAwake", value: Helper.state.keepAwake });
			});
			return function () {
				var on = !!(Helper.online && Helper.state.keepAwake);
				ctx.node.classList.toggle("on", on);
				setText(st, on ? "On" : "Off");
			};
		},
	};

	types.gauge = {
		name: "Gauges", desc: "CPU, GPU or any sensor as a dial", icon: "gauge", group: "system", editable: true,
		w: 2, h: 1, minW: 1, minH: 1, maxW: 4, maxH: 3,
		defaults: function () { return { sources: ["auto:cpu", "auto:gpu"] }; },
		sourcesOf: function (tile) { return ((tile.cfg || {}).sources || ["auto:cpu"]).slice(0, 2); },
		build: function (ctx) {
			var sources = types.gauge.sourcesOf(ctx.tile);
			if (ctx.w === 1) sources = sources.slice(0, 1);
			ctx.body.innerHTML = '<div class="gauges"></div>';
			var wrap = ctx.body.querySelector(".gauges");
			var parts = sources.map(function (src) {
				var g = el("div", "gauge");
				g.innerHTML = '<span class="g-lbl"></span><svg viewBox="0 0 100 86" class="g-svg"><path class="g-bg" d="' + arcPath(100) + '"/><path class="g-fg" d=""/></svg><b class="g-val"></b>';
				wrap.appendChild(g);
				return { src: src, lbl: g.querySelector(".g-lbl"), fg: g.querySelector(".g-fg"), val: g.querySelector(".g-val") };
			});
			return function () {
				parts.forEach(function (p) {
					var r = readSource(p.src);
					setText(p.lbl, r.label);
					if (!p.num) { p.val.innerHTML = '<span class="gv-n"></span><small></small>'; p.num = p.val.firstChild; p.unit = p.val.lastChild; }
					countValue(p.num, r.value, r.units);
					setText(p.unit, r.value == null ? "" : r.units);
					var d = arcPath(scaleOf(r.value, r.units));
					if (p.fg.__d !== d) {
						p.fg.__d = d;
						p.fg.setAttribute("d", d);
					}
				});
			};
		},
	};

	types.sensors = {
		name: "Sensors", desc: "Temperatures, loads, fans", icon: "sensor", group: "system", editable: true,
		w: 2, h: 2, minW: 2, minH: 1, maxW: 6, maxH: 6,
		defaults: function () { return { sources: ["auto:cputemp", "auto:gputemp", "auto:gpu"] }; },
		sourcesOf: function (tile) { return ((tile.cfg || {}).sources || ["auto:cputemp"]).slice(0, 8); },
		build: function (ctx) {
			var sources = types.sensors.sourcesOf(ctx.tile).slice(0, ctx.h === 1 ? 2 : ctx.h * 3);
			ctx.body.innerHTML = head("sensor", "Sensors") + '<div class="rows"></div>';
			var rowsEl = ctx.body.querySelector(".rows");
			var rows = sources.map(function (src) {
				var r = el("div", "row");
				r.innerHTML = '<div class="row-top"><span class="row-name"></span><b class="row-val"></b></div><div class="bar"><i></i></div>';
				rowsEl.appendChild(r);
				return { src: src, el: r, name: r.querySelector(".row-name"), val: r.querySelector(".row-val"), fill: r.querySelector(".bar i") };
			});
			return function () {
				rows.forEach(function (row) {
					var r = readSource(row.src);
					setText(row.name, r.label);
					countValue(row.val, r.value, r.units, " " + r.units);
					var pct = U.clamp(scaleOf(r.value, r.units), 0, 100);
					row.fill.style.width = pct + "%";
					row.el.classList.toggle("hot", /C$/.test(r.units) && r.value >= 85);
				});
			};
		},
	};

	types.network = {
		name: "Network", desc: "Download and upload speed (tap to measure)", icon: "network", group: "system", helper: true,
		w: 2, h: 1, minW: 2, minH: 1, maxW: 4, maxH: 2,
		options: function () {
			return [{
				key: "unit", label: "Show speed in", type: "choice", "default": "mbit",
				choices: [{ value: "mbit", label: "Mbit/s (like speed tests)" }, { value: "mbyte", label: "MB/s (like downloads)" }],
			}];
		},
		build: function (ctx) {
			var built = false, down, up, note;
			ctx.node.classList.add("press");
			ctx.node.addEventListener("click", function () {
				if (App.editing) return;
				if (!Helper.online) return U.toast("Start Control Hub first");
				Helper.measureNetwork();
			});
			return function () {
				if (helperGate(ctx) === true) return (built = false);
				if (!built) {
					ctx.body.innerHTML = '<div class="net"><div><span>Download</span><b class="d"></b></div><div><span>Upload</span><b class="u"></b></div></div><span class="net-note"></span>';
					down = ctx.body.querySelector(".d");
					up = ctx.body.querySelector(".u");
					note = ctx.body.querySelector(".net-note");
					built = true;
				}
				var unit = (ctx.tile.cfg || {}).unit || "mbit";
				// While measuring: live numbers. Afterwards: the highest speed seen.
				var n = Helper.netMeasuring ? Helper.state.network : Helper.state.networkPeak;
				if (!n) {
					setHtml(down, "--");
					setHtml(up, "--");
				} else {
					var d = U.formatRate(n.down, unit), u = U.formatRate(n.up, unit);
					setHtml(down, esc(d.v) + "<small>" + d.u + "</small>");
					setHtml(up, esc(u.v) + "<small>" + u.u + "</small>");
				}
				ctx.node.classList.toggle("measuring", Helper.netMeasuring);
				setText(note, Helper.netMeasuring ? "Measuring…" : n ? "Highest speed in the last check · tap to measure" : "Tap to measure");
			};
		},
	};

	types.storage = {
		name: "Storage", desc: "Free space on your drives", icon: "storage", group: "system", helper: true, parts: ["storage"],
		w: 3, h: 2, minW: 2, minH: 1, maxW: 6, maxH: 4,
		build: function (ctx) {
			var built = false, rowsEl;
			return function () {
				if (helperGate(ctx) === true) return (built = false);
				if (!built) {
					ctx.body.innerHTML = head("storage", "Storage") + '<div class="rows"></div>';
					rowsEl = ctx.body.querySelector(".rows");
					built = true;
				}
				var html = (Helper.state.storage || []).map(function (d) {
					var used = d.totalGB > 0 ? Math.round(((d.totalGB - d.freeGB) / d.totalGB) * 100) : 0;
					return '<div class="row' + (used >= 90 ? " hot" : "") + '"><div class="row-top"><span class="row-name">' + esc(d.name + (d.label ? "  " + d.label : "")) +
						'</span><b class="row-val">' + esc(U.formatGB(d.freeGB)) + ' free</b></div><div class="bar"><i style="width:' + used + '%"></i></div></div>';
				}).join("");
				setHtml(rowsEl, html || '<div class="notice small"><span>No drives found</span></div>');
			};
		},
	};

	types.battery = {
		name: "Batteries", desc: "Your wireless CORSAIR devices", icon: "battery", group: "system",
		w: 2, h: 1, minW: 1, minH: 1, maxW: 6, maxH: 3,
		build: function (ctx) {
			ctx.body.innerHTML = '<div class="bats"></div>';
			var wrap = ctx.body.querySelector(".bats");
			return function () {
				var list = Icue.sensorsOfType("battery-charge");
				var html = list.map(function (s) {
					var v = U.clamp(parseFloat(s.value) || 0, 0, 100);
					return '<div class="bat' + (v <= 20 ? " low" : "") + '"><span class="bat-ic"><i style="width:' + v + '%"></i></span><b>' + Math.round(v) + '%</b><span class="bat-name">' + esc(s.device || s.name) + "</span></div>";
				}).join("");
				setHtml(wrap, html || '<div class="notice small"><span>No wireless CORSAIR devices found</span></div>');
			};
		},
	};

	types.clock = {
		name: "Clock", desc: "Time and date", icon: "clock", group: "system",
		w: 2, h: 1, minW: 1, minH: 1, maxW: 6, maxH: 3,
		options: function () {
			return [
				{ key: "style", label: "Style", type: "choice", "default": "digital", choices: [{ value: "digital", label: "Digital" }, { value: "flip", label: "Flip clock" }, { value: "big", label: "Big and thin" }, { value: "analog", label: "Analogue" }, { value: "board", label: "Airport board" }] },
				{ key: "align", label: "Position", type: "choice", "default": "center", choices: [{ value: "center", label: "Centered" }, { value: "left", label: "Left" }] },
				{ key: "format", label: "Hours", type: "choice", "default": "auto", choices: [{ value: "auto", label: "Like iCUE setting" }, { value: "24", label: "24-hour" }, { value: "12", label: "12-hour (AM/PM)" }] },
				{ key: "seconds", label: "Seconds", type: "toggle", "default": false, on: "Show seconds", off: "No seconds" },
				{ key: "date", label: "Date", type: "choice", "default": "long", choices: [{ value: "long", label: "Tuesday 13 October" }, { value: "short", label: "Tue 13 Oct" }, { value: "none", label: "No date" }] },
			];
		},
		usesSeconds: function (tile) { return !!(tile.cfg && tile.cfg.seconds); },
		build: function (ctx) {
			var cfg = ctx.tile.cfg || {};
			var style = cfg.style || "digital";
			ctx.node.dataset.clock = style;
			if (style === "analog") {
				var ticks = "";
				for (var i = 0; i < 12; i++) ticks += '<line x1="50" y1="' + (i % 3 ? 9 : 7) + '" x2="50" y2="' + (i % 3 ? 13 : 16) + '" transform="rotate(' + i * 30 + ' 50 50)"/>';
				ctx.body.innerHTML = '<div class="clock-an"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" class="an-face"/>' + ticks + '<line class="an-h" x1="50" y1="50" x2="50" y2="27"/><line class="an-m" x1="50" y1="50" x2="50" y2="15"/><line class="an-s" x1="50" y1="56" x2="50" y2="12"/><circle cx="50" cy="50" r="3" class="an-dot"/></svg><span class="c-date"></span></div>';
				var hh = ctx.body.querySelector(".an-h"), mh = ctx.body.querySelector(".an-m"), sh = ctx.body.querySelector(".an-s"), ad = ctx.body.querySelector(".c-date");
				if (!cfg.seconds) sh.style.display = "none";
				if (cfg.date === "none" || ctx.h < 2) ad.style.display = "none";
				return function () {
					var n = new Date();
					hh.setAttribute("transform", "rotate(" + ((n.getHours() % 12) * 30 + n.getMinutes() / 2) + " 50 50)");
					mh.setAttribute("transform", "rotate(" + n.getMinutes() * 6 + " 50 50)");
					if (cfg.seconds) sh.setAttribute("transform", "rotate(" + n.getSeconds() * 6 + " 50 50)");
					setText(ad, n.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }));
				};
			}
			if (style === "flip" || style === "board") {
				ctx.body.innerHTML = '<div class="clock-fx clock-' + style + '"><div class="fx-row"></div><span class="c-date"></span></div>';
				var row = ctx.body.querySelector(".fx-row"), fd = ctx.body.querySelector(".c-date"), last = "";
				if (cfg.date === "none") fd.style.display = "none";
				return function () {
					var n = new Date(), h = n.getHours(), use24 = cfg.format === "24" ? true : cfg.format === "12" ? false : Cfg.clock24h;
					var txt = (use24 ? ("0" + h).slice(-2) : ("0" + ((h % 12) || 12)).slice(-2)) + ":" + ("0" + n.getMinutes()).slice(-2) + (cfg.seconds ? ":" + ("0" + n.getSeconds()).slice(-2) : "");
					if (txt !== last) {
						var old = last;
						last = txt;
						if (style === "flip") setHtml(row, txt.split(":").map(function (part, i) { var ch = old.split(":")[i] !== part; return '<span class="fx-card' + (ch && old ? " flip" : "") + '"><b>' + part + "</b></span>"; }).join('<i class="fx-colon">:</i>'));
						else setHtml(row, txt.split("").map(function (c, i) { return c === ":" ? '<i class="fx-colon">:</i>' : '<span class="fx-ch' + (old && old[i] !== c ? " flip" : "") + '">' + c + "</span>"; }).join(""));
					}
					setText(fd, n.toLocaleDateString("en-GB", ctx.w > 1 && cfg.date !== "short" ? { weekday: "long", day: "numeric", month: "long" } : { weekday: "short", day: "numeric", month: "short" }));
				};
			}
			ctx.body.innerHTML = '<div class="clock' + (style === "big" ? " clock-big" : "") + ' align-' + (cfg.align || "center") + '"><b class="c-time"></b><span class="c-date"></span></div>';
			var t = ctx.body.querySelector(".c-time"), d = ctx.body.querySelector(".c-date");
			if (cfg.date === "none") d.style.display = "none";
			return function () {
				var now = new Date(), h = now.getHours(), m = ("0" + now.getMinutes()).slice(-2);
				var sec = cfg.seconds ? '<span class="c-sec">:' + ("0" + now.getSeconds()).slice(-2) + "</span>" : "";
				var use24 = cfg.format === "24" ? true : cfg.format === "12" ? false : Cfg.clock24h;
				setHtml(t, use24 ? ("0" + h).slice(-2) + ":" + m + sec : ((h % 12) || 12) + ":" + m + sec + "<small>" + (h < 12 ? "AM" : "PM") + "</small>");
				var long = cfg.date !== "short" && ctx.w > 1;
				setText(d, now.toLocaleDateString("en-GB", long ? { weekday: "long", day: "numeric", month: "long" } : { weekday: "short", day: "numeric", month: "short" }));
			};
		},
	};

	types.fps = {
		name: "FPS", desc: "Frame rate of the running game", icon: "fps", group: "system",
		w: 1, h: 1, minW: 1, minH: 1, maxW: 3, maxH: 2,
		build: function (ctx) {
			ctx.body.innerHTML = head("fps", "FPS") + '<div class="big"><b class="v"></b><span class="s"></span></div>';
			var v = ctx.body.querySelector(".v"), s = ctx.body.querySelector(".s");
			return function () {
				var f = Icue.fps, on = f.available && f.fps > 0;
				setText(v, on ? Math.round(f.fps) : "--");
				setText(s, on ? f.process || "" : "No game running");
			};
		},
	};

	var GROUPS = [
		["shortcuts", "Shortcuts"],
		["media", "Audio and media"],
		["system", "System"],
	];

	return {
		types: types,
		GROUPS: GROUPS,
		QUICK: QUICK,
		SITES: SITES,
		AUTO: AUTO,
		resolve: resolve,
		readSource: readSource,
		sourceUsesHelper: sourceUsesHelper,
		shortcutLogo: shortcutLogo,
		runShortcut: runShortcut,
		slider: slider,
		endpoints: endpoints,
		endpointFor: endpointFor,
		deviceChoices: deviceChoices,
		faviconUrl: faviconUrl,
		fmtValue: fmtValue,
		scaleOf: scaleOf,
		head: head,
		helperGate: helperGate,
	};
})();
