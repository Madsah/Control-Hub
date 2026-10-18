/* Control Panel — Round 4A tiles: ping, speed test, now playing, temperature alert, graph,
 * top programs, uptime, disk activity, Discord and brightness. */

var Extra = (function () {
	var svg = U.svg, el = U.el, esc = U.esc, setText = U.setText, setHtml = U.setHtml;
	var types = T.types, head = T.head, helperGate = T.helperGate;

	T.GROUPS.push(["pc", "PC and gaming"]);

	/* ------------------------------------------------------------------ small helpers */
	/* A line graph of numbers as an SVG path (0..100 wide, 0..30 high). */
	function sparkPath(values, lo, hi) {
		if (values.length < 2) return "";
		var min = lo != null ? lo : Math.min.apply(null, values), max = hi != null ? hi : Math.max.apply(null, values);
		if (max - min < 1) { max += 0.5; min -= 0.5; }
		var step = 100 / (values.length - 1);
		return values.map(function (v, i) {
			var y = 29 - ((U.clamp(v, min, max) - min) / (max - min)) * 27;
			return (i ? "L" : "M") + (i * step).toFixed(1) + " " + y.toFixed(1);
		}).join(" ");
	}

	function sparkEl(cls) {
		var box = el("div", "spark " + (cls || ""));
		box.innerHTML = '<svg viewBox="0 0 100 30" preserveAspectRatio="none"><path class="sp-area" d=""/><path class="sp-line" d=""/></svg>';
		var line = box.querySelector(".sp-line"), area = box.querySelector(".sp-area");
		box.draw = function (values, lo, hi) {
			var d = sparkPath(values, lo, hi);
			if (box.__d === d) return;
			box.__d = d;
			line.setAttribute("d", d);
			area.setAttribute("d", d ? d + " L100 30 L0 30 Z" : "");
		};
		return box;
	}

	/* Values over time, one point every 3 seconds, the last 6 minutes. Kept in memory only. */
	var hist = {};
	function record(key, v, every) {
		if (v == null || !isFinite(v)) return hist[key] || [];
		var h = hist[key] || (hist[key] = []);
		var now = Date.now();
		if (!h.lastAt || now - h.lastAt >= (every || 3000)) {
			h.push(v);
			h.lastAt = now;
			if (h.length > 120) h.shift();
		}
		return h;
	}

	function duration(sec) {
		sec = Math.max(0, Math.floor(sec));
		var d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
		if (d) return d + " d " + h + " h";
		if (h) return h + " h " + ("0" + m).slice(-2) + " min";
		return m + " min";
	}

	function iconImg(box, iconId, fallback) {
		if (box.__icon === iconId) return;
		box.__icon = iconId;
		box.innerHTML = svg(fallback);
		if (!iconId) return;
		var img = new Image();
		img.alt = "";
		img.onload = function () { if (box.__icon === iconId) { box.innerHTML = ""; box.appendChild(img); } };
		img.src = Helper.iconUrl(iconId);
	}

	function mbps(bitsPerSec, unit) {
		var r = U.formatRate((bitsPerSec || 0) / 8, unit || "mbit");
		return esc(r.v) + "<small>" + r.u + "</small>";
	}

	/* ------------------------------------------------------------------ ping */
	types.ping = {
		name: "Ping", desc: "Internet ping with a small graph", icon: "ping", group: "pc", helper: true, parts: ["ping"],
		w: 2, h: 1, minW: 1, minH: 1, maxW: 4, maxH: 2,
		options: function () {
			return [{
				key: "target", label: "Ping to", type: "choice", "default": "cloudflare", layout: "list",
				choices: [
					{ value: "cloudflare", label: "Cloudflare", sub: "1.1.1.1 · a good general test" },
					{ value: "google", label: "Google", sub: "8.8.8.8" },
					{ value: "router", label: "My router", sub: "Checks the cable and your home network" },
				],
			}];
		},
		pingTarget: function (t) { return (t.cfg && t.cfg.target) || "cloudflare"; },
		build: function (ctx) {
			var built = false, v, s, sp, lastObj = null;
			var key = "ping:" + ((ctx.tile.cfg && ctx.tile.cfg.target) || "cloudflare");
			return function () {
				if (helperGate(ctx) === true) return (built = false);
				if (!built) {
					ctx.body.innerHTML = head("ping", "Ping") + '<div class="big"><b class="v"></b><span class="s"></span></div>';
					v = ctx.body.querySelector(".v");
					s = ctx.body.querySelector(".s");
					sp = sparkEl("ping-spark");
					ctx.body.appendChild(sp);
					built = true;
				}
				var p = Helper.state.ping;
				var h = hist[key] || [];
				if (p && p !== lastObj) {
					lastObj = p;
					if (p.ms >= 0) h = record(key, p.ms, 1500);
				}
				var ms = p ? p.ms : null;
				setHtml(v, ms == null ? "--" : ms < 0 ? "<span class='bad'>Lost</span>" : ms + "<small>ms</small>");
				ctx.node.classList.toggle("lvl-good", ms != null && ms >= 0 && ms < 40);
				ctx.node.classList.toggle("lvl-ok", ms >= 40 && ms < 90);
				ctx.node.classList.toggle("lvl-bad", ms != null && (ms < 0 || ms >= 90));
				var avg = h.length ? Math.round(h.reduce(function (a, b) { return a + b; }, 0) / h.length) : null;
				setText(s, p ? (p.target === "router" ? "Router" : p.target === "google" ? "Google" : "Cloudflare") + (avg != null ? " · avg " + avg + " ms" : "") : "Measuring…");
				sp.draw(h.slice(-40), 0, null);
			};
		},
	};

	/* ------------------------------------------------------------------ speed test */
	types.speedtest = {
		name: "Speed test", desc: "Real internet speed test, when you tap it", icon: "speed", group: "pc", helper: true,
		w: 2, h: 2, minW: 2, minH: 1, maxW: 4, maxH: 3,
		parts: function () {
			var st = Helper.state.speedtest;
			return Extra._stWatch || (st && st.running) ? ["speedtest"] : [];
		},
		options: function () {
			return [{
				key: "unit", label: "Show speed in", type: "choice", "default": "mbit",
				choices: [{ value: "mbit", label: "Mbit/s (like speed tests)" }, { value: "mbyte", label: "MB/s (like downloads)" }],
			}];
		},
		build: function (ctx) {
			var built = false, els = {};
			ctx.node.classList.add("press");
			ctx.node.addEventListener("click", function () {
				if (App.editing) return;
				if (!Helper.online) return U.toast("Start Control Hub first");
				var st = Helper.state.speedtest;
				if (st && st.running) return;
				Extra._stWatch = true;
				Helper.state.speedtest = { running: true, phase: "ping", progress: 0, down: 0, up: 0, ping: -1 };
				App.refreshNeeds();
				App.dirty();
				Helper.act({ action: "speedTest" }).then(function () { Helper.poll(); });
			});
			return function () {
				if (helperGate(ctx) === true) return (built = false);
				var cfg = ctx.tile.cfg || (ctx.tile.cfg = {});
				if (!built) {
					ctx.body.innerHTML = head("speed", "Speed test") +
						'<div class="st-vals"><div><span>Download</span><b class="st-d"></b></div><div><span>Upload</span><b class="st-u"></b></div></div>' +
						'<div class="st-bar"><i></i></div><span class="st-note"></span><div class="st-hist"></div>';
					["st-d", "st-u", "st-note"].forEach(function (c) { els[c] = ctx.body.querySelector("." + c); });
					els.bar = ctx.body.querySelector(".st-bar i");
					built = true;
				}
				var st = Helper.state.speedtest, unit = cfg.unit || "mbit";
				var running = !!(st && st.running);
				// A finished test is kept on the tile.
				if (st && !st.running && Extra._stWatch && (st.phase === "done" || st.phase === "error")) {
					Extra._stWatch = false;
					if (st.phase === "done") {
						cfg.last = { down: st.down, up: st.up, ping: st.ping, at: st.at || Date.now() };
						cfg.history = [cfg.last].concat(cfg.history || []).slice(0, 5);
						Editor.save();
					} else U.toast(st.error || "The speed test didn't work");
					setTimeout(App.refreshNeeds, 0);
				}
				var show = running ? st : cfg.last;
				ctx.node.classList.toggle("measuring", running);
				setHtml(els["st-d"], show && show.down ? mbps(show.down, unit) : "--");
				setHtml(els["st-u"], show && show.up ? mbps(show.up, unit) : "--");
				els.bar.style.width = running ? Math.round((st.progress || 0) * 100) + "%" : "0%";
				var phase = running ? { ping: "Checking ping…", down: "Testing download…", up: "Testing upload…" }[st.phase] || "Starting…" : "";
				var older = (cfg.history || []).slice(1, ctx.h >= 3 ? 4 : 2);
				setHtml(ctx.body.querySelector(".st-hist"), running || !older.length ? "" : older.map(function (h) {
					var d = U.formatRate((h.down || 0) / 8, unit), u2 = U.formatRate((h.up || 0) / 8, unit);
					return "<span>" + esc(ago(h.at)) + "</span><b>" + esc(d.v) + " ↓ " + esc(u2.v) + " ↑</b>";
				}).join(""));
				var pingTx = show && show.ping >= 0 ? "Ping " + show.ping + " ms · " : "";
				setText(els["st-note"], running ? pingTx + phase : cfg.last ? pingTx + "tested " + ago(cfg.last.at) + " · tap to test again" : "Tap to test (takes about 20 seconds)");
			};
		},
	};

	function ago(t) {
		var s = (Date.now() - t) / 1000;
		if (s < 90) return "just now";
		if (s < 3600) return Math.round(s / 60) + " min ago";
		if (s < 86400) return Math.round(s / 3600) + " h ago";
		return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
	}

	/* ------------------------------------------------------------------ now playing */
	types.nowplaying = {
		name: "Now playing", desc: "The game or app in front, play time and FPS", icon: "gamepad", group: "pc", helper: true, parts: ["foreground"],
		w: 2, h: 1, minW: 2, minH: 1, maxW: 4, maxH: 2, tickMs: 30000,
		build: function (ctx) {
			var built = false, ic, nm, sub, fps;
			return function () {
				if (helperGate(ctx) === true) return (built = false);
				if (!built) {
					ctx.body.innerHTML = '<div class="np"><span class="np-ic"></span><div class="np-tx"><b class="np-name"></b><span class="np-sub"></span></div><b class="np-fps"></b></div>';
					ic = ctx.body.querySelector(".np-ic");
					nm = ctx.body.querySelector(".np-name");
					sub = ctx.body.querySelector(".np-sub");
					fps = ctx.body.querySelector(".np-fps");
					built = true;
				}
				var f = Helper.state.foreground, g = Icue.fps;
				var gaming = g.available && g.fps > 0;
				iconImg(ic, f && f.icon, gaming ? "gamepad" : "window");
				setText(nm, f ? f.name : gaming ? g.process : "Nothing in front");
				var wide = ctx.w >= 3;
				var time = f && f.started ? duration((Date.now() - f.started) / 1000) : "";
				setText(sub, (gaming && !wide ? Math.round(g.fps) + " FPS · " : "") + (time ? (gaming ? "playing for " : "open for ") + time : gaming ? "playing" : ""));
				setHtml(fps, gaming && wide ? Math.round(g.fps) + "<small>FPS</small>" : "");
				ctx.node.classList.toggle("gaming", gaming);
			};
		},
	};

	/* ------------------------------------------------------------------ temperature alert */
	var LIMITS = [70, 75, 80, 85, 90, 95, 97, 100].map(function (n) { return { value: n, label: n + " °C" }; });

	types.tempalert = {
		name: "Temperature alert", desc: "Turns red when CPU or GPU gets too hot", icon: "thermo", group: "pc",
		w: 2, h: 1, minW: 1, minH: 1, maxW: 4, maxH: 2,
		options: function () {
			return [
				{ key: "cpuLimit", label: "CPU warning at", type: "choice", "default": 90, choices: LIMITS },
				{ key: "gpuLimit", label: "GPU warning at", type: "choice", "default": 85, choices: LIMITS },
				{ key: "edge", label: "Whole panel", type: "toggle", "default": true, on: "Red glow around the whole panel too (also on other pages)", off: "Only this tile turns red" },
			];
		},
		build: function (ctx) {
			ctx.body.innerHTML = head("thermo", "Temperature") + '<div class="ta"><div class="ta-c"><span>CPU</span><b></b></div><div class="ta-g"><span>GPU</span><b></b></div></div>';
			var cb = ctx.body.querySelector(".ta-c b"), gb = ctx.body.querySelector(".ta-g b");
			var cd = ctx.body.querySelector(".ta-c"), gd = ctx.body.querySelector(".ta-g");
			return function () {
				var r = alertRead(ctx.tile);
				setText(cb, r.cpu == null ? "--" : Math.round(r.cpu) + "°");
				setText(gb, r.gpu == null ? "--" : Math.round(r.gpu) + "°");
				cd.classList.toggle("hot", r.cpuHot);
				gd.classList.toggle("hot", r.gpuHot);
				ctx.node.classList.toggle("alarm", r.cpuHot || r.gpuHot);
			};
		},
	};

	function alertRead(t) {
		var c = (t.cfg || {}), cpu = T.readSource("auto:cputemp").value, gpu = T.readSource("auto:gputemp").value;
		return {
			cpu: cpu, gpu: gpu,
			cpuHot: cpu != null && cpu >= (c.cpuLimit || 90),
			gpuHot: gpu != null && gpu >= (c.gpuLimit || 85),
			edge: c.edge !== false,
		};
	}

	function alertTiles() {
		var out = [];
		Editor.layout().pages.forEach(function (p) {
			p.tiles.forEach(function (t) { if (t.type === "tempalert") out.push(t); });
		});
		return out;
	}

	/* Called after every update: the red glow works whichever page you're on. */
	var wasHot = false;
	function check() {
		var hot = false, what = "";
		alertTiles().forEach(function (t) {
			var r = alertRead(t);
			if (r.edge && (r.cpuHot || r.gpuHot)) {
				hot = true;
				what = r.cpuHot ? "CPU " + Math.round(r.cpu) + " °C" : "GPU " + Math.round(r.gpu) + " °C";
			}
		});
		document.body.classList.toggle("temp-alarm", hot);
		if (hot && !wasHot) U.toast("Hot! " + what);
		wasHot = hot;
	}

	function alwaysSensors() {
		if (!alertTiles().length) return [];
		return ["auto:cputemp", "auto:gputemp"].map(T.resolve).filter(function (s) { return s && s.indexOf("helper:") !== 0; });
	}

	/* ------------------------------------------------------------------ CPU & GPU in percent (was "Graph") */
	types.graph = {
		name: "CPU & GPU", desc: "Load in percent, big and clear", icon: "gauge", group: "pc", editable: true,
		w: 2, h: 1, minW: 1, minH: 1, maxW: 6, maxH: 3, maxSources: 2,
		defaults: function () { return { sources: ["auto:cpu", "auto:gpu"] }; },
		sourcesOf: function (tile) { return ((tile.cfg || {}).sources || ["auto:cpu", "auto:gpu"]).slice(0, 2); },
		build: function (ctx) {
			var sources = types.graph.sourcesOf(ctx.tile);
			if (ctx.w === 1 && ctx.h === 1) sources = sources.slice(0, 1);
			var temps = { "auto:cpu": "auto:cputemp", "auto:gpu": "auto:gputemp" };
			ctx.body.innerHTML = '<div class="pc-cols"></div>';
			var box = ctx.body.querySelector(".pc-cols");
			var cols = sources.map(function (src) {
				var c = el("div", "pc-col", '<span class="pc-lab"></span><b class="pc-val"></b><div class="bar"><i></i></div><em class="pc-temp"></em>');
				box.appendChild(c);
				return { src: src, el: c, lab: c.querySelector(".pc-lab"), val: c.querySelector(".pc-val"), bar: c.querySelector(".bar i"), temp: c.querySelector(".pc-temp") };
			});
			return function () {
				cols.forEach(function (c) {
					var r = T.readSource(c.src);
					setText(c.lab, r.label.replace(/ load$/i, ""));
					var pct = /%/.test(r.units);
					setHtml(c.val, r.value == null ? "--" : esc(T.fmtValue(r.value, r.units)) + "<small>" + esc(pct ? "%" : r.units) + "</small>");
					c.bar.style.width = U.clamp(pct ? r.value || 0 : T.scaleOf(r.value, r.units), 0, 100) + "%";
					c.el.classList.toggle("high", pct && r.value >= 90);
					var t = temps[c.src] ? T.readSource(temps[c.src]).value : null;
					setText(c.temp, t == null ? "" : Math.round(t) + " °C");
				});
			};
		},
	};

	/* ------------------------------------------------------------------ top programs */
	types.topapps = {
		name: "Top programs", desc: "Using the most CPU or memory · tap to close one", icon: "list", group: "pc", helper: true, parts: ["top"],
		w: 2, h: 2, minW: 2, minH: 2, maxW: 4, maxH: 4,
		build: function (ctx) {
			var built = false, list, tabs, cfg = ctx.tile.cfg || (ctx.tile.cfg = {});
			function build() {
				ctx.body.innerHTML = '<div class="th">' + svg("list") + '<span>Programs</span><span class="top-tabs"><button data-s="cpu">CPU</button><button data-s="memory">RAM</button></span></div><div class="top-list"></div><div class="mix-more"></div>';
				list = ctx.body.querySelector(".top-list");
				tabs = ctx.body.querySelector(".top-tabs");
				U.dragScroll(list, ctx.body.querySelector(".mix-more"));
				tabs.addEventListener("click", function (e) {
					var b = e.target.closest("[data-s]");
					if (!b || App.editing) return;
					e.stopPropagation();
					cfg.sort = b.dataset.s;
					Editor.save();
					App.dirty();
				});
				var holdT = null, held = false;
				list.addEventListener("pointerdown", function (e) {
					var r = e.target.closest(".top-row");
					held = false;
					clearTimeout(holdT);
					if (!r || App.editing) return;
					holdT = setTimeout(function () {
						held = true;
						var a = r.__app;
						if (a && a.canClose) forceAsk(a, true);
						else if (a) U.toast(a.name + " is part of Windows or iCUE, so it can't be closed from here");
					}, 800);
				});
				["pointerup", "pointercancel", "pointermove"].forEach(function (n) {
					list.addEventListener(n, function (e) { if (n !== "pointermove" || Math.abs(e.movementY || 0) > 3) clearTimeout(holdT); });
				});
				list.addEventListener("click", function (e) {
					var r = e.target.closest(".top-row");
					if (!r || App.editing) return;
					e.stopPropagation();
					if (held) { held = false; return; }
					closeApp(r.__app);
				});
				built = true;
			}
			return function () {
				if (helperGate(ctx) === true) return (built = false);
				if (!built) build();
				var sort = cfg.sort || "cpu";
				tabs.querySelectorAll("button").forEach(function (b) { b.classList.toggle("on", b.dataset.s === sort); });
				var top = Helper.state.top;
				if (!top) return setHtml(list, '<div class="notice small"><span>Looking…</span></div>');
				var rows = top[sort] || [];
				if (list.querySelector(".notice")) list.innerHTML = "";
				rows.forEach(function (a, i) {
					var r = list.children[i];
					if (!r) {
						r = el("button", "top-row", '<span class="top-ic"></span><span class="top-name"></span><b class="top-val"></b>');
						list.appendChild(r);
					}
					r.__app = a;
					iconImg(r.querySelector(".top-ic"), a.icon, "window");
					setText(r.querySelector(".top-name"), a.name);
					setText(r.querySelector(".top-val"), sort === "cpu" ? (top.ready ? a.cpu.toFixed(a.cpu < 10 ? 1 : 0) + "%" : "…") : a.memMB >= 1024 ? (a.memMB / 1024).toFixed(1) + " GB" : a.memMB + " MB");
					r.classList.toggle("locked", !a.canClose);
				});
				while (list.children.length > rows.length) list.removeChild(list.lastChild);
			};
		},
	};

	function closeApp(a) {
		if (!a) return;
		if (!a.canClose) return U.toast(a.name + " is part of Windows or iCUE, so it can't be closed from here");
		Editor.confirm({ title: "Close " + a.name + "?", text: "Like clicking its X. If it has unsaved work, it may ask you first on the PC.", ok: "Close", icon: "x", danger: true }, function () {
			Helper.act({ action: "closeApp", exe: a.exe }, true).then(function (ok) {
				if (!ok) return forceAsk(a);
				U.toast("Closing " + a.name + "…");
				// Still running a few seconds later? Offer to force it.
				setTimeout(function () {
					Helper.fetch("/api/state?parts=top", { cache: "no-store" }, 4000).then(function (s) {
						var still = s && s.top && (s.top.memory || []).concat(s.top.cpu || []).some(function (x) { return x.exe === a.exe; });
						if (still) forceAsk(a);
					}).catch(function () {});
				}, 5000);
			});
		});
	}

	function forceAsk(a, direct) {
		Editor.confirm({ title: direct ? "Force close " + a.name + "?" : a.name + " didn't close", text: "Force close it? Anything unsaved in it is lost.", ok: "Force close", icon: "x", danger: true }, function () {
			Helper.act({ action: "closeApp", exe: a.exe, force: true }).then(function (ok) {
				if (ok) U.toast(a.name + " closed");
			});
		});
	}

	/* ------------------------------------------------------------------ uptime */
	types.uptime = {
		name: "Uptime", desc: "How long the PC has been on", icon: "clock", group: "pc", helper: true, parts: ["uptime"],
		w: 2, h: 1, minW: 1, minH: 1, maxW: 3, maxH: 2, tickMs: 60000,
		build: function (ctx) {
			var built = false, v, s;
			return function () {
				if (helperGate(ctx) === true) return (built = false);
				if (!built) {
					ctx.body.innerHTML = head("power", "PC on for") + '<div class="big"><b class="v"></b><span class="s"></span></div>';
					v = ctx.body.querySelector(".v");
					s = ctx.body.querySelector(".s");
					built = true;
				}
				if (!Helper.bootAt) return setText(v, "--");
				setText(v, duration((Date.now() - Helper.bootAt) / 1000));
				var b = new Date(Helper.bootAt);
				setText(s, "Since " + b.toLocaleDateString("en-GB", { weekday: "short" }) + " " + ("0" + b.getHours()).slice(-2) + ":" + ("0" + b.getMinutes()).slice(-2));
			};
		},
	};

	/* ------------------------------------------------------------------ disk activity */
	types.disk = {
		name: "Disk activity", desc: "Read and write speed of your drives", icon: "disk", group: "pc", helper: true, parts: ["disk"],
		w: 2, h: 2, minW: 2, minH: 1, maxW: 4, maxH: 4,
		build: function (ctx) {
			var built = false, rowsEl;
			return function () {
				if (helperGate(ctx) === true) return (built = false);
				if (!built) {
					ctx.body.innerHTML = head("disk", "Disk activity") + '<div class="rows"></div>';
					rowsEl = ctx.body.querySelector(".rows");
					built = true;
				}
				var disks = Helper.state.disk;
				if (!disks) return setHtml(rowsEl, '<div class="notice small"><span>Measuring…</span></div>');
				var html = disks.slice(0, ctx.h * 2).map(function (d) {
					return '<div class="row"><div class="row-top"><span class="row-name">' + esc(d.name) + '</span><b class="row-val">' + rate(d.read) + " ↓ · " + rate(d.write) + ' ↑</b></div><div class="bar"><i style="width:' + U.clamp(d.busy, 0, 100) + '%"></i></div></div>';
				}).join("");
				setHtml(rowsEl, html || '<div class="notice small"><span>Windows isn\'t sharing drive activity</span></div>');
			};
		},
	};

	function rate(bytes) {
		var mb = (bytes || 0) / 1048576;
		return mb >= 100 ? Math.round(mb) + " MB/s" : mb >= 1 ? mb.toFixed(1) + " MB/s" : Math.round((bytes || 0) / 1024) + " KB/s";
	}

	/* ------------------------------------------------------------------ Discord (connected to the Discord app through the helper) */
	var dc = { state: null, running: false, v: 0 };

	function discordVisible() {
		return Editor.visibleTiles().some(function (t) { return t.type === "discord"; });
	}

	/* Waits for changes (the helper answers as soon as something happens), so the green ring is live. */
	function discordWatch() {
		if (dc.running) return;
		dc.running = true;
		(function next() {
			if (!discordVisible() || !Helper.online || (typeof Look !== "undefined" && Look.sleeping)) { dc.running = false; return; }
			Helper.fetch("/api/discord?since=" + (dc.state ? dc.state.v : 0), { cache: "no-store" }, 20000).then(function (s) {
				dc.state = s;
				App.dirty();
				setTimeout(next, s && s.connected ? 30 : 3000);
			}, function () {
				setTimeout(next, 3000);
			});
		})();
	}

	function avatarUrl(m) {
		return m.avatar ? "https://cdn.discordapp.com/avatars/" + encodeURIComponent(m.id) + "/" + encodeURIComponent(m.avatar) + ".png?size=96" : "";
	}

	types.discord = {
		name: "Discord", desc: "Who's in the call, who's talking, mute and deafen", icon: "chat", group: "pc", helper: true,
		w: 3, h: 2, minW: 2, minH: 1, maxW: 6, maxH: 4,
		build: function (ctx) {
			var built = false, els = {}, avatars = {};
			function act(what) {
				var s = dc.state;
				if (!s || !s.connected) return U.toast("Discord isn't connected yet");
				if (what === "mute") s.mute = !s.mute;
				if (what === "deaf") { s.deaf = !s.deaf; if (s.deaf) s.mute = true; }
				App.dirty();
				Helper.act({ action: "discord", what: what }, true).then(function (ok) { if (!ok) U.toast("Discord didn't do that"); });
			}
			function build() {
				ctx.body.innerHTML =
					'<div class="dc-top"><span class="dc-chan"></span><span class="dc-count"></span></div>' +
					'<div class="dc-people"></div><div class="dc-idle"></div>' +
					'<div class="dc"><button class="dc-btn dc-open" aria-label="Open Discord"><span class="dc-logo"></span></button><button class="dc-btn dc-mute"></button><button class="dc-btn dc-deaf"></button><button class="dc-btn dc-leave">' + svg("x") + "<span>Leave</span></button></div>" +
					'<div class="dc-setup notice small"></div>';
				["dc-chan", "dc-count", "dc-people", "dc-idle", "dc-mute", "dc-deaf", "dc-leave", "dc-setup", "dc-logo"].forEach(function (c) { els[c] = ctx.body.querySelector("." + c); });
				els["dc-logo"].innerHTML = svg("chat");
				findDiscord().then(function (a) { if (a && a.icon) iconImg(els["dc-logo"], a.icon, "chat"); });
				ctx.body.querySelector(".dc-open").addEventListener("click", function (e) {
					e.stopPropagation();
					if (App.editing) return;
					findDiscord().then(function (a) {
						if (a) Helper.act({ action: "launch", id: a.id });
						else Helper.act({ action: "openUrl", url: "https://discord.com/app" });
					});
				});
				els["dc-mute"].addEventListener("click", function (e) { e.stopPropagation(); if (!App.editing) act("mute"); });
				els["dc-deaf"].addEventListener("click", function (e) { e.stopPropagation(); if (!App.editing) act("deaf"); });
				els["dc-leave"].addEventListener("click", function (e) {
					e.stopPropagation();
					if (App.editing) return;
					Editor.confirm({ title: "Leave the call?", text: "You leave " + ((dc.state && dc.state.channel) || "the voice channel") + ".", ok: "Leave", icon: "x", danger: true }, function () { act("leave"); });
				});
				els["dc-setup"].addEventListener("click", function (e) {
					var b = e.target.closest(".dc-how");
					if (b && !App.editing) { e.stopPropagation(); discordGuide(); }
				});
				// Tap someone: their volume and mute, only for you (Round 8B).
				els["dc-people"].addEventListener("click", function (e) {
					var p = e.target.closest(".dc-p");
					if (!p || App.editing || !window.Round8b) return;
					e.stopPropagation();
					Round8b.person(p.dataset.id, function () { return dc.state; });
				});
				avatars = {};
				built = true;
			}
			return function () {
				if (helperGate(ctx) === true) return (built = false);
				if (!built) build();
				discordWatch();
				var s = dc.state;
				var ready = !!(s && s.connected);
				ctx.node.classList.toggle("dc-ready", ready);
				if (!ready) {
					var msg = !s ? "Connecting…"
						: !s.configured ? "<b>Connect Discord once</b><span>So the panel can see who's talking and mute for real.</span><button class=\"pill accent dc-how\">How?</button>"
						: s.waiting ? "<b>Look at Discord</b><span>Click Authorize to let Control Panel connect.</span>"
						: "<b>Waiting for Discord</b><span>" + esc(s.error || "Is Discord open?") + "</span>";
					setHtml(els["dc-setup"], msg);
					return;
				}
				var inCall = !!s.channel;
				ctx.node.classList.toggle("dc-incall", inCall);
				if (!inCall && window.Round8b) Round8b.discordIdle(ctx, els["dc-idle"], s);
				setText(els["dc-chan"], inCall ? s.channel : "Not in a voice channel");
				var people = s.members || [];
				setText(els["dc-count"], inCall ? people.length + (people.length === 1 ? " person" : " people") : "");
				setHtml(els["dc-mute"], svg(s.mute ? "micOff" : "mic") + "<span>" + (s.mute ? "Muted" : "Mute") + "</span>");
				setHtml(els["dc-deaf"], svg(s.deaf ? "speakerOff" : "headset") + "<span>" + (s.deaf ? "Deafened" : "Deafen") + "</span>");
				els["dc-mute"].classList.toggle("on", !!s.mute);
				els["dc-deaf"].classList.toggle("on", !!s.deaf);
				// People: one round picture each, a green ring while talking.
				var seen = {};
				people.forEach(function (m, i) {
					seen[m.id] = true;
					var a = avatars[m.id];
					if (!a) {
						a = avatars[m.id] = el("div", "dc-p", '<span class="dc-av"><b></b></span><em></em><i class="dc-st"></i><s class="dc-vol"></s>');
					a.dataset.id = m.id;
						var url = avatarUrl(m);
						a.querySelector("b").textContent = (m.name || "?").charAt(0).toUpperCase();
						if (url) {
							var img = new Image();
							img.alt = "";
							img.onload = function () { var av = a.querySelector(".dc-av"); av.innerHTML = ""; av.appendChild(img); };
							img.src = url;
						}
					}
					if (els["dc-people"].children[i] !== a) els["dc-people"].insertBefore(a, els["dc-people"].children[i] || null);
					setText(a.querySelector("em"), m.name);
					a.classList.toggle("speaking", !!m.speaking);
					a.classList.toggle("me", !!m.me);
					setHtml(a.querySelector(".dc-st"), m.deaf ? svg("speakerOff") : m.mute ? svg("micOff") : "");
					// Your own volume for them, when it isn't the normal 100 %.
					a.classList.toggle("lmuted", !!m.lmute);
					setText(a.querySelector(".dc-vol"), m.lmute ? "muted" : m.vol != null && m.vol !== 100 ? m.vol + "%" : "");
				});
				Object.keys(avatars).forEach(function (id) {
					if (!seen[id]) {
						var n = avatars[id];
						if (n.parentNode) n.parentNode.removeChild(n);
						delete avatars[id];
					}
				});
			};
		},
	};

	function discordGuide() {
		var wrap = el("div", "opts dc-guide");
		Editor.modal("Connect Discord (one time, about 5 minutes)", wrap);
		var steps = [
			["On your PC, open the Discord developer site and sign in", "discord.com/developers/applications"],
			["Click New Application, name it Control Panel, tick the box and click Create", ""],
			["In the menu on the left, click OAuth2", ""],
			["Under Redirects click Add Redirect, type http://localhost and click Save Changes", ""],
			["On the same page: copy the Client ID. Then click Reset Secret, Yes, and copy the Client Secret", "Keep the secret to yourself"],
			["Open Control Hub → Connections → Discord and paste the Client ID, then the Client Secret", ""],
			["Discord asks if Control Panel may connect: click Authorize. Done!", "It stays connected after this, also after restarts"],
		];
		var ol = el("ol", "guide");
		steps.forEach(function (s) {
			var li = el("li", "", "<b></b>" + (s[1] ? "<em></em>" : ""));
			li.querySelector("b").textContent = s[0];
			if (s[1]) li.querySelector("em").textContent = s[1];
			ol.appendChild(li);
		});
		wrap.appendChild(ol);
		var open = el("button", "pill accent save-btn", "Open the developer site on my PC");
		open.addEventListener("click", function () { openUrlOnPc("https://discord.com/developers/applications"); });
		wrap.appendChild(open);
	}

	function openUrlOnPc(url) {
		if (Helper.online) Helper.act({ action: "openUrl", url: url });
		else Icue.openLink(url);
	}

	var discordApp = null;
	function findDiscord() {
		if (discordApp) return Promise.resolve(discordApp);
		if (!Helper.online) return Promise.resolve(null);
		var p = Helper.apps ? Promise.resolve(Helper.apps) : Helper.loadApps(false);
		return p.then(function (apps) {
			for (var i = 0; i < apps.length; i++) if (apps[i].kind !== "url" && /^discord$/i.test(apps[i].name)) return (discordApp = apps[i]);
			return null;
		}, function () { return null; });
	}

	/* ------------------------------------------------------------------ brightness + night light (XENEON EDGE only) */
	types.brightness = {
		name: "Brightness", desc: "XENEON EDGE brightness and a warm night light", icon: "sun", group: "pc", parts: ["brightness"],
		w: 2, h: 1, minW: 2, minH: 1, maxW: 6, maxH: 2,
		build: function (ctx) {
			var cfg = ctx.tile.cfg || (ctx.tile.cfg = {});
			ctx.body.innerHTML = '<div class="th">' + svg("sun") + '<span class="br-title">Screen</span><button class="pill br-night">' + svg("moon") + ' Night light</button></div><div class="row-top br-top"><span class="row-name br-what"></span><b class="row-val br-val"></b></div>';
			var what = ctx.body.querySelector(".br-what"), val = ctx.body.querySelector(".br-val"), night = ctx.body.querySelector(".br-night");
			var mode = null, edge = null;
			var slider = T.slider(ctx.body, function (v, final) {
				if (mode === "ddc" && edge) {
					Helper.hold("monitors", 4000);
					edge.brightness = v;
					setText(val, v + "%");
					if (final) Helper.act({ action: "brightness", monitor: edge.id, value: v }, true);
				} else {
					// The EDGE doesn't take brightness from Windows: dim the Control Panel itself.
					cfg.panel = v;
					setText(val, v + "%");
					applyPanel();
					if (final) Editor.save();
				}
			});
			night.addEventListener("click", function (e) {
				e.stopPropagation();
				if (App.editing) return;
				cfg.warm = !cfg.warm;
				Editor.save();
				applyPanel();
				App.dirty();
			});
			return function () {
				var mons = Helper.online ? Helper.state.monitors : null;
				edge = mons ? mons.filter(function (m) { return m.edge && m.supported; })[0] || null : null;
				mode = edge ? "ddc" : "panel";
				setText(what, mode === "ddc" ? "Screen brightness" : "Panel brightness");
				var v = mode === "ddc" ? edge.brightness : cfg.panel == null ? 100 : cfg.panel;
				setText(val, v + "%");
				slider.set(v);
				night.classList.toggle("accent", !!cfg.warm);
				ctx.node.classList.toggle("warm-on", !!cfg.warm);
			};
		},
	};

	/* The night light and panel dimming work on every page, from the first Brightness tile. */
	function applyPanel() {
		var t = null;
		Editor.layout().pages.some(function (p) { return p.tiles.some(function (x) { if (x.type === "brightness") { t = x; return true; } return false; }); });
		var c = (t && t.cfg) || {};
		if (typeof Look !== "undefined") Look.setPanel({ dim: c.panel == null ? 0 : 100 - c.panel, warm: !!c.warm });
	}

	return {
		check: function () { check(); applyPanel(); },
		alwaysSensors: alwaysSensors,
		_stWatch: false,
		_spark: sparkPath,
	};
})();
