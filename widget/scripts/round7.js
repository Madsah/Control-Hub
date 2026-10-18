/* Control Panel — Round 7: the helper's live channel (games starting / closing, notifications, CS2),
 * notification banners, volume sliders, CS2 tiles, game launcher, quick actions and Flight mode,
 * system health and the weather radar. */

var Round7 = (function () {
	var svg = U.svg, el = U.el, esc = U.esc, setText = U.setText, setHtml = U.setHtml;
	var types = T.types, helperGate = T.helperGate, head = T.head;
	T.GROUPS.push(["cs2", "Counter-Strike 2"]);

	/* ================================================================== live channel */
	/* One request stays open at the helper. It answers the moment a game starts or closes, a notification
	   arrives or CS2 sends news; otherwise after 25 seconds. No polling while nothing happens. */
	var live = { ok: false, unsupported: false, unsupVer: null, seq: 0, nseq: -1, busy: false, ctrl: null, sig: "", restart: false, cs2: null, cs2At: 0 };

	/* "cs2": CS2 tiles on screen, every update. "cs2q": only round changes, so banners can wait for the round to end. */
	function cs2Topic() {
		if (Editor.visibleTiles().some(function (t) { return /^cs2/.test(t.type); })) return "cs2";
		var c = notifCfg();
		return c.on && c.quietCs2 ? "cs2q" : "";
	}
	function wantCs2() { return !!cs2Topic(); }
	function signature() { return Pages.watchList().join(",") + "|" + cs2Topic(); }

	function loop() {
		if (live.busy || live.unsupported || !Helper.online) return;
		live.busy = true;
		live.sig = signature();
		var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
		live.ctrl = ctrl;
		var watch = Pages.watchList();
		var url = Helper.base() + "/api/events?since=" + live.seq + "&nseq=" + live.nseq + (watch.length ? "&watch=" + encodeURIComponent(watch.join(",")) : "") + "&topics=" + cs2Topic();
		var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 32000);
		fetch(url, { cache: "no-store", signal: ctrl ? ctrl.signal : undefined }).then(function (r) {
			if (r.status === 404) {
				live.unsupported = true;
				live.unsupVer = Helper.state.version || "";
				throw new Error("old helper");
			}
			return r.json();
		}).then(function (r) {
			clearTimeout(timer);
			if (!r || !r.ok) throw new Error("bad answer");
			var was = live.ok;
			live.ok = true;
			live.busy = false;
			live.seq = r.seq;
			if (r.nseq < live.nseq) live.nseq = r.nseq; // the helper was restarted
			if (live.nseq < 0) live.nseq = r.nseq; // first answer: older notifications aren't shown
			else {
				(r.notifs || []).slice().reverse().forEach(onNotif);
				live.nseq = r.nseq;
			}
			if (typeof r.dnd === "boolean" && !(Helper._busyUntil.dnd > Date.now()) && Helper.state.dnd !== r.dnd) { Helper.state.dnd = r.dnd; App.dirty(); }
			if (Array.isArray(r.running)) Pages.onRunning(r.running);
			if (r.restore && typeof Round11 !== "undefined") Round11.restoreFromHub(r.restore);
			// FlightLine's Start / End session asks for a page (by id, or by name).
			if (r.showPage && !App.editing) {
				var L = Editor.layout();
				for (var pi = 0; pi < L.pages.length; pi++) {
					if (L.pages[pi].id === r.showPage || L.pages[pi].name === r.showPage) { if (L.current !== pi) Editor.goPage(pi, "user"); break; }
				}
			}
			if (r.cs2) {
				live.cs2 = r.cs2;
				live.cs2At = Date.now();
				onCs2(r.cs2);
				App.dirty();
			}
			if (!was) App.refreshNeeds();
			setTimeout(loop, 40);
		}, function () {
			clearTimeout(timer);
			live.busy = false;
			if (live.restart) {
				live.restart = false;
				return setTimeout(loop, 20);
			}
			if (live.ok) {
				live.ok = false;
				App.refreshNeeds();
			}
			if (live.unsupported) App.refreshNeeds();
			else setTimeout(loop, 5000);
		});
	}

	/* The pages or tiles changed: ask again with the new list right away. */
	function needsChanged() {
		if (live.busy && live.ctrl && signature() !== live.sig) {
			live.restart = true;
			live.ctrl.abort();
		} else if (!live.busy) loop();
	}

	function check() {
		if (live.unsupported && Helper.state.version && Helper.state.version !== live.unsupVer) live.unsupported = false;
		if (Helper.online && !live.busy && !live.unsupported) loop();
	}

	/* ================================================================== notification banners */
	function notifCfg() {
		var c = Editor.storeGet("cpNotif") || {};
		return { on: c.on !== false, quietFlight: c.quietFlight !== false, quietCs2: c.quietCs2 !== false, secs: c.secs || 8, blocked: c.blocked || [] };
	}
	function setNotifCfg(c) {
		Editor.storeSet("cpNotif", c);
		App.refreshNeeds();
	}

	var queue = [], showing = null, bannerEl = null, hideTimer = null, simPhase = { at: 0, phase: "" };

	function onNotif(n) {
		var c = notifCfg();
		recentP.at = 0;
		App.dirty();
		if (!c.on || Helper.state.dnd) return;
		if (c.blocked.some(function (b) { return b.key === n.appKey; })) return;
		queue.push(n);
		if (queue.length > 6) queue.splice(0, queue.length - 6);
		pump();
	}

	/* Taking off / landing (MSFS) or mid-round in CS2: keep the banners for later. */
	function quiet() {
		var c = notifCfg();
		if (c.quietCs2 && live.cs2 && live.cs2.live && Date.now() - live.cs2At < 60000) {
			var ph = live.cs2.map && live.cs2.map.phase, rp = live.cs2.round && live.cs2.round.phase;
			if (ph === "live" && rp === "live") return true;
		}
		if (c.quietFlight) {
			var s = Helper.state.sim;
			if (s && s.connected) simPhase = { at: Date.now(), phase: s.phase };
			else if (Date.now() - simPhase.at > 5000) {
				simPhase.at = Date.now();
				Helper.fetch("/api/state?parts=sim", { cache: "no-store" }, 3000).then(function (r) {
					simPhase = { at: Date.now(), phase: r && r.sim && r.sim.connected ? r.sim.phase : "" };
				}, function () {});
			}
			if (/^(takeoff|climb|approach|landing)$/.test(simPhase.phase || "")) return true;
		}
		return false;
	}

	var pumpTimer = null;
	function pump() {
		clearTimeout(pumpTimer);
		if (showing || !queue.length) return;
		if (quiet()) { pumpTimer = setTimeout(pump, 3000); return; }
		show(queue.shift());
	}

	function ago(t) {
		var s = Math.max(0, Math.round((Date.now() - t) / 1000));
		if (s < 45) return "now";
		if (s < 3600) return Math.round(s / 60) + " min ago";
		var d = new Date(t);
		return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
	}

	function banner() {
		if (bannerEl) return bannerEl;
		bannerEl = el("div", "nb");
		bannerEl.innerHTML = '<span class="nb-ic"></span><div class="nb-tx"><div class="nb-top"><b class="nb-app"></b><span class="nb-time"></span><span class="nb-more"></span></div><b class="nb-title"></b><span class="nb-text"></span></div>';
		document.body.appendChild(bannerEl);
		var start = null, held = false, holdT = null;
		bannerEl.addEventListener("pointerdown", function (e) {
			start = { x: e.clientX, y: e.clientY };
			held = false;
			clearTimeout(holdT);
			try { bannerEl.setPointerCapture(e.pointerId); } catch (x) {}
			clearTimeout(hideTimer);
			holdT = setTimeout(function () {
				held = true;
				var n = showing;
				if (!n || n.test) return;
				hide();
				Editor.confirm({ title: "Stop banners from " + n.app + "?", text: "Notifications from " + n.app + " won't show on the panel. Turn them back on in Pages → Notification banners.", ok: "Stop them", icon: "bell" }, function () {
					var c = notifCfg();
					c.blocked = c.blocked.filter(function (b) { return b.key !== n.appKey; }).concat([{ key: n.appKey, name: n.app }]);
					setNotifCfg(c);
					U.toast("No more banners from " + n.app);
				});
			}, 750);
			e.stopPropagation();
		});
		bannerEl.addEventListener("pointermove", function (e) {
			if (!start) return;
			var dy = e.clientY - start.y;
			if (Math.abs(dy) + Math.abs(e.clientX - start.x) > 10) clearTimeout(holdT);
			if (dy < 0) bannerEl.style.transform = "translate(-50%, " + dy / (Cfg.scale || 1) + "px)";
		});
		function end(e) {
			clearTimeout(holdT);
			if (!start) return;
			var dy = e.clientY - start.y, dx = e.clientX - start.x;
			start = null;
			bannerEl.style.transform = "";
			if (held) return;
			if (dy < -25) return hide();
			if (Math.abs(dy) < 10 && Math.abs(dx) < 10 && e.type === "pointerup") {
				var n = showing;
				hide();
				if (n && !n.test) Helper.act({ action: "notifOpen", key: n.appKey }, true).then(function (ok) { if (!ok) U.toast("Couldn't open " + n.app); });
				return;
			}
			hideTimer = setTimeout(hide, 2500);
		}
		bannerEl.addEventListener("pointerup", end);
		bannerEl.addEventListener("pointercancel", end);
		bannerEl.addEventListener("click", function (e) { e.stopPropagation(); });
		return bannerEl;
	}

	function show(n) {
		var b = banner();
		showing = n;
		var ic = b.querySelector(".nb-ic");
		ic.innerHTML = svg("bell");
		if (n.icon) {
			var img = new Image();
			img.alt = "";
			img.onload = function () { if (showing === n) { ic.innerHTML = ""; ic.appendChild(img); } };
			img.src = Helper.iconUrl(n.icon);
		}
		setText(b.querySelector(".nb-app"), n.app || "Notification");
		setText(b.querySelector(".nb-time"), n.time ? ago(n.time) : "now");
		setText(b.querySelector(".nb-more"), queue.length ? "+" + queue.length + " more" : "");
		setText(b.querySelector(".nb-title"), n.title || "");
		setText(b.querySelector(".nb-text"), n.text || "");
		b.classList.toggle("no-text", !n.text);
		if (typeof Look !== "undefined") Look.wake();
		void b.offsetWidth;
		b.classList.add("show");
		clearTimeout(hideTimer);
		hideTimer = setTimeout(hide, notifCfg().secs * 1000);
	}

	function hide() {
		clearTimeout(hideTimer);
		if (!bannerEl || !showing) return;
		bannerEl.classList.remove("show");
		showing = null;
		setTimeout(pump, 450);
	}

	function testBanner() {
		queue.push({ test: true, app: "Control Panel", title: "This is how a notification looks", text: "Tap to open the app, swipe up to hide, hold to stop banners from that app.", time: Date.now() });
		pump();
	}

	/* Recent notifications tile */
	var recentP = Round6.poller("/api/notifs", 20000, 6000);
	types.notifs = {
		name: "Notifications", desc: "Your latest Windows notifications · tap to open", icon: "bell", group: "pc", helper: true,
		w: 3, h: 2, minW: 2, minH: 1, maxW: 6, maxH: 6, tickMs: 20000,
		build: function (ctx) {
			ctx.body.innerHTML = head("bell", "Notifications") + '<div class="nf-list"></div>';
			var list = ctx.body.querySelector(".nf-list");
			U.dragScroll(list);
			list.addEventListener("click", function (e) {
				var r = e.target.closest("[data-key]");
				if (!r || App.editing) return;
				e.stopPropagation();
				Helper.act({ action: "notifOpen", key: r.dataset.key }, true).then(function (ok) { if (!ok) U.toast("Couldn't open that app"); });
			});
			var shown = "";
			return function () {
				if (helperGate(ctx) === true) return;
				var r = recentP.get();
				if (!r) return setHtml(list, '<div class="notice small"><span>Loading…</span></div>');
				if (r.notifs === undefined) return setHtml(list, '<div class="notice small"><span>Update Control Hub for this</span></div>');
				var items = r.notifs || [];
				var key = JSON.stringify(items.map(function (n) { return n.id; })) + Math.floor(Date.now() / 60000);
				if (key === shown) return;
				shown = key;
				if (!items.length) return setHtml(list, '<div class="notice small"><span>' + (r.status && r.status !== "ok" ? esc(r.status) : "No new notifications since Control Hub started") + "</span></div>");
				setHtml(list, items.map(function (n) {
					return '<button class="nf-row" data-key="' + esc(n.appKey) + '"><span class="nf-ic" data-icon="' + esc(n.icon || "") + '"></span><span class="nf-tx"><span class="nf-top"><b>' + esc(n.app) + "</b><em>" + esc(ago(n.time)) + "</em></span><b class=\"nf-t\">" + esc(n.title) + "</b>" + (n.text ? "<span>" + esc(n.text) + "</span>" : "") + "</span></button>";
				}).join(""));
				list.querySelectorAll(".nf-ic").forEach(function (ic) { Round6.iconInto(ic, ic.dataset.icon, "bell"); });
			};
		},
	};

	/* ================================================================== volume sliders */
	var ORIENT = { key: "vertical", label: "Slider", type: "choice", "default": false, choices: [{ value: false, label: "Horizontal" }, { value: true, label: "Vertical" }] };

	/* One look for both volume tiles. src() → {value, muted, name, icon?, missing?}; set(v, final); mute(). */
	function volumeTile(ctx, glyph, src, set, mute) {
		var cfg = ctx.tile.cfg || {}, vert = !!cfg.vertical && ctx.h >= 2; // too short for a standing slider: lie it down
		ctx.node.classList.add("vol-tile", vert ? "vol-v" : "vol-h");
		ctx.body.innerHTML = '<div class="vt"><button class="vt-ic"></button><span class="vt-nm"></span><b class="vt-val"></b><div class="vt-sl"></div></div>';
		var ic = ctx.body.querySelector(".vt-ic"), nm = ctx.body.querySelector(".vt-nm"), val = ctx.body.querySelector(".vt-val");
		var sl = T.slider(ctx.body.querySelector(".vt-sl"), function (v, final) { setText(val, v + "%"); set(v, final); }, { vertical: vert });
		ic.addEventListener("click", function (e) {
			e.stopPropagation();
			if (!App.editing) mute();
		});
		var iconShown = null;
		return function () {
			var s = src();
			ctx.node.classList.toggle("missing", !!s.missing);
			ctx.node.classList.toggle("muted", !!s.muted);
			setText(nm, s.name || "");
			if (s.missing) {
				setText(val, "–");
				setHtml(ic, svg(glyph));
				iconShown = null;
				return;
			}
			sl.set(s.value || 0);
			setText(val, s.muted ? "Muted" : Math.round(s.value || 0) + "%");
			var want = s.muted ? "speakerOff" : s.icon || glyph;
			if (want !== iconShown) {
				iconShown = want;
				if (s.icon && !s.muted) Round6.iconInto(ic, s.icon, glyph);
				else { ic.__icon = null; ic.innerHTML = svg(want); }
			}
		};
	}

	function findMixer(match) {
		var m = Helper.state.mixer || [];
		if (!match) return null;
		if (match.indexOf("key:") === 0) {
			var k = match.slice(4);
			for (var i = 0; i < m.length; i++) if (m[i].key === k) return m[i];
			return null;
		}
		if (match === "system") return m.filter(function (a) { return a.key === "system"; })[0] || null;
		var re = APP_MATCH[match];
		return re ? m.filter(function (a) { return re.test(a.name + " " + a.key); })[0] || null : null;
	}
	var APP_MATCH = {
		discord: /discord/i, spotify: /spotify/i, msfs: /flight ?sim|flightsimulator/i, cs2: /\bcs2\b|counter-?strike/i,
		browser: /chrome|msedge|firefox|opera|brave/i, sayintentions: /sayintentions/i,
	};
	var APP_LABEL = { discord: "Discord", spotify: "Spotify", msfs: "Flight Simulator", cs2: "Counter-Strike 2", browser: "Web browser", sayintentions: "SayIntentions", system: "System sounds" };

	types.spvolume = {
		name: "Spotify volume", desc: "Spotify's own volume as a big slider", icon: "music", group: "media", helper: true, parts: ["mixer"],
		w: 2, h: 1, minW: 1, minH: 1, maxW: 6, maxH: 6, tickMs: 2000,
		defaults: function () { return { vertical: false }; },
		options: function () { return [ORIENT]; },
		build: function (ctx) {
			var sp = Round6.spotify, holdUntil = 0, lastSent = 0, pend = null, before = 50;
			function apiVol() {
				var s = sp.get(), p = s && s.connected && s.player;
				return p && p.volume != null ? p : null;
			}
			function send(v, final) {
				var now = Date.now();
				clearTimeout(pend);
				if (!final && now - lastSent < 300) { pend = setTimeout(function () { send(v, false); }, 300); return; }
				lastSent = now;
				Helper.act({ action: "spotify", what: "volume", value: v }, !final);
			}
			function set(v, final) {
				var p = apiVol();
				if (p) {
					p.volume = v;
					holdUntil = Date.now() + 2500;
					send(v, final);
					if (final) setTimeout(function () { sp.soon(); }, 600);
					return;
				}
				var a = findMixer("spotify");
				if (!a) return;
				a.volume = v;
				a.muted = false;
				Helper.hold("mixer");
				Helper.act({ action: "appVolume", key: a.key, value: v }, !final);
			}
			var up = volumeTile(ctx, "music", function () {
				var p = apiVol();
				if (p) return { value: p.volume, name: "Spotify" + (p.device ? " · " + p.device : "") };
				var a = findMixer("spotify");
				if (a) return { value: a.volume, muted: a.muted, name: "Spotify", icon: a.icon };
				return { missing: true, name: "Spotify isn't playing" };
			}, set, function () {
				var p = apiVol();
				if (p) {
					if (p.volume > 0) { before = p.volume; set(0, true); } else set(before || 50, true);
					App.dirty();
					return;
				}
				var a = findMixer("spotify");
				if (!a) return;
				a.muted = !a.muted;
				Helper.hold("mixer");
				App.dirty();
				Helper.act({ action: "appMute", key: a.key, value: a.muted });
			});
			return function () {
				if (helperGate(ctx) === true) return;
				if (Date.now() < holdUntil) return;
				up();
			};
		},
	};

	types.appvol = {
		name: "App volume", desc: "A big volume slider for one app (Discord, MSFS, a game…)", icon: "mixer", group: "media", helper: true, parts: ["mixer"],
		w: 2, h: 1, minW: 1, minH: 1, maxW: 6, maxH: 6,
		defaults: function () { return { app: "discord", vertical: false }; },
		options: function () {
			var choices = Object.keys(APP_LABEL).map(function (k) { return { value: k, label: APP_LABEL[k], sub: k === "system" ? "Windows sounds" : "Finds it whenever it plays sound" }; });
			(Helper.state.mixer || []).forEach(function (a) {
				if (a.key === "system" || Object.keys(APP_MATCH).some(function (k) { return APP_MATCH[k].test(a.name + " " + a.key); })) return;
				choices.push({ value: "key:" + a.key, label: a.name, sub: "Playing sound right now" });
			});
			return [{ key: "app", label: "Which app", type: "choice", layout: "list", "default": "discord", choices: choices }, ORIENT];
		},
		build: function (ctx) {
			var cfg = ctx.tile.cfg || {};
			var label = APP_LABEL[cfg.app] || cfg.appName || "App";
			if (cfg.app && cfg.app.indexOf("key:") === 0) {
				var m0 = findMixer(cfg.app);
				if (m0) label = cfg.appName = m0.name;
			}
			var up = volumeTile(ctx, "mixer", function () {
				var a = findMixer(cfg.app);
				if (!a) return { missing: true, name: label + " · not playing" };
				return { value: a.volume, muted: a.muted, name: a.key === "system" ? "System sounds" : a.name, icon: a.icon };
			}, function (v, final) {
				var a = findMixer(cfg.app);
				if (!a) return;
				a.volume = v;
				a.muted = false;
				Helper.hold("mixer");
				Helper.act({ action: "appVolume", key: a.key, value: v }, !final);
			}, function () {
				var a = findMixer(cfg.app);
				if (!a) return;
				a.muted = !a.muted;
				Helper.hold("mixer");
				App.dirty();
				Helper.act({ action: "appMute", key: a.key, value: a.muted });
			});
			return function () {
				if (helperGate(ctx) === true) return;
				up();
			};
		},
	};

	/* ================================================================== Counter-Strike 2 */
	var bomb = { planted: false, at: 0, result: "", resultAt: 0 }, lastKills = 0, killFlashAt = 0;

	function onCs2(s) {
		var rb = s.live && s.round ? s.round.bomb : "";
		var cd = s.countdown && s.countdown.phase === "bomb" ? s.countdown.endsIn : null;
		if (s.bomb && s.bomb.state === "planted" && s.bomb.countdown) cd = s.bomb.countdown;
		var planted = rb === "planted" || (s.bomb && s.bomb.state === "planted");
		if (planted && !bomb.planted) {
			bomb.planted = true;
			bomb.at = Date.now() - (cd != null ? Math.max(0, 40 - cd) * 1000 : 0);
			bomb.result = "";
			App.refreshNeeds();
		} else if (planted && cd != null) bomb.at = Date.now() - Math.max(0, 40 - cd) * 1000; // keep in step with the game
		else if (!planted && bomb.planted) {
			bomb.planted = false;
			bomb.result = rb === "defused" ? "defused" : rb === "exploded" ? "exploded" : "";
			bomb.resultAt = Date.now();
			App.refreshNeeds();
		}
		var p = s.player || {};
		var k = p.own ? p.round_kills || 0 : 0;
		if (k > lastKills && k >= 3) killFlashAt = Date.now();
		lastKills = k;
	}

	function cs2() { return live.cs2; }

	/* Shows what's missing (helper, setup, game not running). Returns true when the tile can't show data. */
	function cs2Gate(ctx) {
		var box = ctx.body.querySelector(".cs-gate"), main = ctx.body.querySelector(".cs-main");
		function msg(html) {
			ctx.node.classList.add("cs-off");
			setHtml(box, '<div class="notice small">' + html + "</div>");
			return true;
		}
		var s = cs2();
		if (live.unsupported) return msg("<b>Update Control Hub</b><span>CS2 needs a newer Control Hub.</span>");
		if (!s) return msg("<span>Connecting…</span>");
		if (s.setup === "nocs2") return msg("<b>Counter-Strike 2 not found</b><span>Install it in Steam, then try again.</span>");
		if (s.setup !== "installed")
			return msg('<b>Connect CS2 once</b><span>Uses Valve\'s own Game State Integration (VAC-safe, like iCUE\'s CS2 lighting).</span><button class="pill accent cs-setup">Set it up</button>');
		if (!s.live) return msg(s.running ? "<b>In the menu</b><span>Join a match and this fills in.</span>" : "<b>Waiting for CS2</b><span>Start CS2 and join a match. Restart CS2 if it was already open when you set this up.</span>");
		ctx.node.classList.remove("cs-off");
		return false;
	}

	function csTile(def) {
		def.group = "cs2";
		def.helper = true;
		var build = def.build;
		def.build = function (ctx) {
			ctx.node.classList.add("cs-tile");
			var inner;
			function make() {
				inner = build(ctx);
				var gate = el("div", "cs-gate");
				ctx.body.appendChild(gate);
				gate.addEventListener("click", function (e) {
					if (!e.target.closest(".cs-setup") || App.editing) return;
					e.stopPropagation();
					Helper.act({ action: "cs2Setup" }, true).then(function (ok) {
						U.toast(ok ? "Done. Restart CS2 if it's open" : "Couldn't find CS2's folder. Try Control Hub → Connections → CS2");
						live.restart = true;
						if (live.ctrl) live.ctrl.abort();
					});
				});
			}
			make();
			return function () {
				var g = helperGate(ctx);
				if (g === true) return;
				if (g === "rebuild") make();
				if (cs2Gate(ctx)) return;
				inner(cs2());
			};
		};
		return def;
	}

	var PHASE_NAME = { warmup: "Warmup", intermission: "Halftime", gameover: "Game over", live: "Live" };
	var ROUND_NAME = { freezetime: "Buy time", live: "Live", over: "Round over" };

	types.cs2score = csTile({
		name: "CS2 score", desc: "CT vs T score, round and map", icon: "crosshair",
		w: 3, h: 1, minW: 2, minH: 1, maxW: 6, maxH: 3,
		build: function (ctx) {
			ctx.body.innerHTML = '<div class="cs-main cs-sc"><div class="cs-team ct"><b></b><span>CT</span></div><div class="cs-mid"><span class="cs-map"></span><b class="cs-rd"></b><span class="cs-ph"></span></div><div class="cs-team t"><b></b><span>T</span></div></div>';
			var q = function (c) { return ctx.body.querySelector(c); };
			var ct = q(".ct b"), t = q(".t b"), map = q(".cs-map"), rd = q(".cs-rd"), ph = q(".cs-ph");
			return function (s) {
				var m = s.map || {}, r = s.round || {}, p = s.player || {};
				setText(ct, m.ct);
				setText(t, m.t);
				setText(map, (m.name || "") + (m.mode ? " · " + m.mode : ""));
				var over = m.phase === "gameover";
				setText(rd, over ? (m.ct === m.t ? "Draw" : (m.ct > m.t ? "CT" : "T") + " win") : "Round " + ((m.round || 0) + (r.phase === "over" ? 0 : 1)));
				var phase = m.phase === "live" ? ROUND_NAME[r.phase] || "Live" : PHASE_NAME[m.phase] || m.phase;
				if (r.bomb === "planted") phase = "Bomb planted";
				setText(ph, phase);
				ctx.node.classList.toggle("cs-bomb", r.bomb === "planted");
				ctx.node.dataset.mine = p.own ? p.team || "" : "";
				ctx.node.dataset.win = r.phase === "over" ? r.win || "" : "";
			};
		},
	});

	types.cs2stats = csTile({
		name: "CS2 you", desc: "Health, armor, money, kills, deaths, MVPs", icon: "shield",
		w: 3, h: 2, minW: 1, minH: 1, maxW: 6, maxH: 4,
		build: function (ctx) {
			ctx.body.innerHTML = '<div class="cs-main cs-me"><div class="cs-who"></div><div class="cs-vit">' +
				'<div class="cs-hp"><span>' + svg("pulse") + '</span><b></b><i><s></s></i></div>' +
				'<div class="cs-ar"><span>' + svg("shield") + '</span><b></b><em></em></div>' +
				'<div class="cs-money"><span>$</span><b></b></div></div>' +
				'<div class="cs-kda"><div><b class="k"></b><span>Kills</span></div><div><b class="d"></b><span>Deaths</span></div><div><b class="a"></b><span>Assists</span></div><div><b class="mvp"></b><span>MVP</span></div></div></div>';
			var q = function (c) { return ctx.body.querySelector(c); };
			return function (s) {
				var p = s.player || {};
				var hp = p.health || 0;
				setText(q(".cs-who"), p.own ? "" : "Watching " + (p.name || "a player"));
				setText(q(".cs-hp b"), hp);
				q(".cs-hp s").style.width = hp + "%";
				ctx.node.dataset.hp = hp > 50 ? "ok" : hp > 20 ? "low" : hp > 0 ? "crit" : "dead";
				setText(q(".cs-ar b"), p.armor || 0);
				setText(q(".cs-ar em"), p.helmet ? "+ helmet" : p.armor ? "no helmet" : "");
				setText(q(".cs-money b"), Number(p.money || 0).toLocaleString("en-US"));
				setText(q(".k"), p.kills != null ? p.kills : "–");
				setText(q(".d"), p.deaths != null ? p.deaths : "–");
				setText(q(".a"), p.assists != null ? p.assists : "–");
				setText(q(".mvp"), p.mvps != null ? p.mvps : "–");
				ctx.node.classList.toggle("cs-flashed", (p.flashed || 0) > 100);
				ctx.node.classList.toggle("cs-burning", (p.burning || 0) > 0);
			};
		},
	});

	types.cs2weapon = csTile({
		name: "CS2 weapon", desc: "Your weapon, ammo and grenades", icon: "crosshair",
		w: 2, h: 2, minW: 1, minH: 1, maxW: 6, maxH: 3,
		build: function (ctx) {
			ctx.body.innerHTML = '<div class="cs-main cs-wp"><span class="cs-wn"></span><b class="cs-ammo"></b><span class="cs-res"></span><div class="cs-nades"></div></div>';
			var q = function (c) { return ctx.body.querySelector(c); };
			return function (s) {
				var w = s.weapon || {};
				setText(q(".cs-wn"), w.name || "–");
				var hasAmmo = w.clip != null && w.clipMax != null && w.clipMax > 0;
				setHtml(q(".cs-ammo"), hasAmmo ? w.clip + "<small> / " + w.clipMax + "</small>" : "–");
				setText(q(".cs-res"), hasAmmo ? (w.reserve || 0) + " in reserve" : "");
				ctx.node.classList.toggle("cs-low", hasAmmo && w.clip <= Math.max(1, Math.floor(w.clipMax * 0.25)));
				ctx.node.classList.toggle("cs-empty", hasAmmo && w.clip === 0);
				setHtml(q(".cs-nades"), (s.grenades || []).map(function (n) { return '<span class="chip">' + esc(n) + "</span>"; }).join("") + (s.player && s.player.bomb ? '<span class="chip cs-c4">C4</span>' : "") + (s.player && s.player.defuse ? '<span class="chip">Kit</span>' : ""));
			};
		},
	});

	types.cs2bomb = csTile({
		name: "CS2 bomb timer", desc: "Big 40-second countdown when the bomb is planted", icon: "bomb",
		w: 2, h: 1, minW: 1, minH: 1, maxW: 6, maxH: 3,
		tickMs: function () { return bomb.planted || (bomb.result && Date.now() - bomb.resultAt < 6000) ? 100 : 0; },
		build: function (ctx) {
			ctx.body.innerHTML = '<div class="cs-main cs-bt"><span class="cs-bic">' + svg("bomb") + '</span><div class="cs-btx"><b class="cs-bt-v"></b><span class="cs-bt-s"></span></div><i class="cs-bt-bar"><s></s></i></div>';
			var q = function (c) { return ctx.body.querySelector(c); };
			return function () {
				var left = bomb.planted ? Math.max(0, 40 - (Date.now() - bomb.at) / 1000) : 0;
				var recent = bomb.result && Date.now() - bomb.resultAt < 6000;
				ctx.node.dataset.st = bomb.planted ? (left <= 5 ? "late" : left <= 10 ? "kit" : "planted") : recent ? bomb.result : "idle";
				if (bomb.planted) {
					setHtml(q(".cs-bt-v"), Math.floor(left) + "<small>." + Math.floor((left % 1) * 10) + "</small>");
					setText(q(".cs-bt-s"), left > 10 ? "Planted · time to defuse" : left > 5 ? "Only with a kit" : "Too late to defuse");
					q(".cs-bt-bar s").style.width = (left / 40) * 100 + "%";
				} else {
					setText(q(".cs-bt-v"), recent ? (bomb.result === "defused" ? "Defused" : "Boom") : "No bomb");
					setText(q(".cs-bt-s"), recent ? "" : "Counts down when it's planted");
					q(".cs-bt-bar s").style.width = "0%";
				}
			};
		},
	});

	types.cs2kills = csTile({
		name: "CS2 round kills", desc: "Kills this round, flashes on 3 or more", icon: "skull",
		w: 1, h: 1, minW: 1, minH: 1, maxW: 3, maxH: 2,
		build: function (ctx) {
			ctx.body.innerHTML = '<div class="cs-main cs-rk"><b class="cs-rk-v"></b><span class="cs-rk-s"></span></div>';
			var v = ctx.body.querySelector(".cs-rk-v"), sub = ctx.body.querySelector(".cs-rk-s"), shown = -1;
			return function (s) {
				var p = s.player || {}, k = p.own ? p.round_kills || 0 : 0;
				setText(v, k);
				setText(sub, k >= 5 ? "ACE!" : k === 4 ? "4K" : k === 3 ? "3K" : (p.round_killhs ? p.round_killhs + " headshot" + (p.round_killhs === 1 ? "" : "s") : "kills this round"));
				ctx.node.dataset.k = Math.min(k, 5);
				if (k !== shown && k >= 3 && Date.now() - killFlashAt < 2000) {
					ctx.node.classList.remove("cs-pop");
					void ctx.node.offsetWidth;
					ctx.node.classList.add("cs-pop");
				}
				shown = k;
			};
		},
	});

	var histP = Round6.poller("/api/cs2history", 60000, 6000);
	types.cs2history = {
		name: "CS2 match history", desc: "Your last matches: map, result, score and K/D", icon: "trophy", group: "cs2", helper: true,
		w: 3, h: 2, minW: 2, minH: 1, maxW: 6, maxH: 6, tickMs: 60000,
		build: function (ctx) {
			ctx.body.innerHTML = '<div class="th">' + svg("trophy") + '<span>CS2 matches</span><span class="ch-sum"></span></div><div class="ch-list"></div>';
			var list = ctx.body.querySelector(".ch-list"), sum = ctx.body.querySelector(".ch-sum"), shown = "";
			U.dragScroll(list);
			return function () {
				if (helperGate(ctx) === true) return;
				var r = histP.get();
				if (!r) return setHtml(list, '<div class="notice small"><span>Loading…</span></div>');
				var ms = r.matches || [];
				var key = JSON.stringify(ms.map(function (m) { return m.time; }));
				if (key === shown) return;
				shown = key;
				var last = ms.slice(0, 10), w = 0, l = 0, k = 0, d = 0;
				last.forEach(function (m) { if (m.result === "win") w++; if (m.result === "loss") l++; k += m.k || 0; d += m.d || 0; });
				setText(sum, ms.length ? w + "W " + l + "L · K/D " + (d ? (k / d).toFixed(2) : k) : "");
				if (!ms.length) return setHtml(list, '<div class="notice small"><span>Finished matches show up here (from now on).</span></div>');
				setHtml(list, ms.map(function (m) {
					var dt = new Date(m.time);
					return '<div class="ch-row ' + esc(m.result) + '"><span class="ch-res">' + (m.result === "win" ? "W" : m.result === "loss" ? "L" : "T") + '</span><span class="ch-map"><b>' + esc(String(m.map || "").replace(/^(de|cs)_/, "")) + "</b><em>" + esc(m.mode || "") + " · " + dt.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + '</em></span><b class="ch-sc">' + m.us + " : " + m.them + '</b><span class="ch-kd">' + m.k + "/" + m.d + "/" + m.a + "</span></div>";
				}).join(""));
			};
		},
	};

	/* ================================================================== game launcher */
	var steamP = Round6.poller("/api/steam", 120000, 20000);
	function coverHtml(g) {
		if (g.k === "steam")
			return '<img alt="" src="https://cdn.cloudflare.steamstatic.com/steam/apps/' + esc(g.id) + '/library_600x900.jpg" onerror="if(this.dataset.f){this.style.visibility=\'hidden\'}else{this.dataset.f=1;this.src=\'https://cdn.cloudflare.steamstatic.com/steam/apps/' + esc(g.id) + '/header.jpg\'}" />';
		return '<span class="gl-app">' + (g.icon ? '<img alt="" src="' + esc(Helper.iconUrl(g.icon)) + '" onerror="this.remove()" />' : svg("gamepad")) + "</span>";
	}
	function startGame(g) {
		var body = g.k === "steam" ? { action: "steamRun", id: g.id } : { action: "launch", id: g.id };
		Helper.act(body, true).then(function (ok) { U.toast(ok ? "Starting " + g.name + "…" : "Couldn't start " + g.name); });
	}

	types.launcher = {
		name: "Game launcher", desc: "Big covers of your favourite games · tap to play", icon: "launch", group: "pc", helper: true,
		w: 4, h: 2, minW: 1, minH: 1, maxW: 8, maxH: 4, tickMs: 60000,
		edit: function (t, back) { pickGames(t, back); },
		build: function (ctx) {
			var cfg = ctx.tile.cfg || {};
			ctx.body.innerHTML = '<div class="gl"></div>';
			var box = ctx.body.querySelector(".gl"), shown = "";
			U.dragScroll(box);
			box.addEventListener("click", function (e) {
				var b = e.target.closest("[data-i]");
				if (!b || App.editing) return;
				e.stopPropagation();
				b.classList.remove("ran");
				void b.offsetWidth;
				b.classList.add("ran");
				startGame(b.__g);
			});
			return function () {
				if (helperGate(ctx) === true) return;
				var games = cfg.games || [];
				var auto = !games.length;
				if (auto) {
					var s = steamP.get();
					games = ((s && s.games) || []).slice(0, 8).map(function (g) { return { k: "steam", id: g.id, name: g.name }; });
				}
				var key = JSON.stringify(games) + auto;
				if (key === shown) return;
				shown = key;
				box.classList.toggle("gl-auto", auto);
				if (!games.length) return setHtml(box, '<div class="notice small"><b>Pick your games</b><span>Tap Edit, then ✏ on this tile.</span></div>');
				setHtml(box, games.map(function (g, i) {
					return '<button class="gl-g" data-i="' + i + '">' + coverHtml(g) + "<b>" + esc(g.name) + "</b></button>";
				}).join("") + (auto ? '<span class="gl-hint">Your latest Steam games · ✏ to pick your own</span>' : ""));
				box.querySelectorAll("[data-i]").forEach(function (b) { b.__g = games[+b.dataset.i]; });
			};
		},
	};

	function pickGames(t, back) {
		var cfg = t.cfg || (t.cfg = {});
		var picked = (cfg.games || []).slice();
		var wrap = el("div", "picker");
		wrap.innerHTML = '<div class="tabs"><button data-tab="steam" class="on">Steam</button><button data-tab="apps">Other games and apps</button></div><div class="gl-picked"></div><div class="tab-body"></div>';
		Editor.modal("Your games", wrap, back);
		var tb = wrap.querySelector(".tab-body"), pk = wrap.querySelector(".gl-picked"), tab = "steam";
		function has(k, id) { return picked.some(function (g) { return g.k === k && g.id === id; }); }
		function toggle(g) {
			if (has(g.k, g.id)) picked = picked.filter(function (x) { return !(x.k === g.k && x.id === g.id); });
			else picked.push(g);
			draw();
		}
		function drawPicked() {
			pk.innerHTML = "";
			var row = el("div", "chips");
			picked.forEach(function (g, i) {
				var c = el("button", "chip on", esc(g.name) + " ✕");
				c.addEventListener("click", function () { picked.splice(i, 1); draw(); });
				row.appendChild(c);
			});
			if (!picked.length) row.appendChild(el("p", "hint", "Nothing picked: the tile shows your latest Steam games."));
			pk.appendChild(row);
			var save = el("button", "pill accent", "Save (" + picked.length + ")");
			save.addEventListener("click", function () {
				cfg.games = picked;
				Editor.saveTile(t, back);
			});
			pk.appendChild(save);
		}
		function draw() {
			drawPicked();
			tb.innerHTML = "";
			if (tab === "steam") {
				var s = steamP.get(!steamP.data);
				if (!s) { tb.innerHTML = '<p class="hint">Loading your Steam games…</p>'; setTimeout(function () { if (wrap.isConnected && tab === "steam") draw(); }, 700); return; }
				var g = el("div", "pick-grid");
				(s.games || []).forEach(function (x) {
					var b = el("button", "pick" + (has("steam", x.id) ? " on" : ""), '<span class="pick-logo gl-mini">' + coverHtml({ k: "steam", id: x.id }) + '</span><span class="pick-tx"><b></b><em></em></span>');
					b.querySelector("b").textContent = x.name;
					b.querySelector("em").textContent = has("steam", x.id) ? "Picked" : x.minutes ? Math.round(x.minutes / 60) + " h played" : "";
					b.addEventListener("click", function () { toggle({ k: "steam", id: x.id, name: x.name }); });
					g.appendChild(b);
				});
				if (!g.children.length) g.innerHTML = '<p class="hint">No Steam games found on this PC.</p>';
				tb.appendChild(g);
			} else {
				tb.innerHTML = '<p class="hint">Loading your apps…</p>';
				Helper.loadApps(false).then(function (apps) {
					if (tab !== "apps") return;
					tb.innerHTML = "";
					var search = el("input", "search");
					search.placeholder = "Search, e.g. Flight Simulator";
					var g = el("div", "pick-grid");
					function fill(q) {
						g.innerHTML = "";
						q = (q || "").toLowerCase();
						apps.filter(function (a) { return a.kind !== "url" && (!q || a.name.toLowerCase().indexOf(q) >= 0); }).slice(0, 80).forEach(function (a) {
							var b = el("button", "pick" + (has("app", a.id) ? " on" : ""));
							b.appendChild(T.shortcutLogo({ kind: "app", icon: a.icon }, "pick-logo"));
							b.appendChild(el("span", "pick-tx", "<b>" + esc(a.name) + "</b><em>" + (has("app", a.id) ? "Picked" : "") + "</em>"));
							b.addEventListener("click", function () { toggle({ k: "app", id: a.id, name: a.name, icon: a.icon }); });
							g.appendChild(b);
						});
					}
					search.addEventListener("input", function () { fill(search.value); });
					tb.appendChild(search);
					tb.appendChild(g);
					fill("");
				}, function () { tb.innerHTML = '<p class="hint">Couldn\'t load your apps. Is Control Hub running?</p>'; });
			}
		}
		wrap.querySelectorAll("[data-tab]").forEach(function (b) {
			b.addEventListener("click", function () {
				tab = b.dataset.tab;
				wrap.querySelectorAll("[data-tab]").forEach(function (x) { x.classList.toggle("on", x === b); });
				draw();
			});
		});
		draw();
	}

	/* ================================================================== Flight mode / CS2 mode */
	/* Custom buttons that start from a ready-made template (On / Off), found under Flight sim and CS2 in the drawer. */
	function presetButton(name, desc, icon, group, template) {
		var base = Buttons.tileType, def = {};
		Object.keys(base).forEach(function (k) { def[k] = base[k]; });
		def.name = name;
		def.desc = desc;
		def.icon = icon;
		def.group = group;
		def.w = 2;
		def.h = 1;
		def.defaults = function () { return {}; };
		def.edit = function (t, back) { Buttons.openEditor(t, back, template); };
		return def;
	}
	types.flightmode = presetButton("Flight mode", "One tap: MSFS, SimBrief, SayIntentions, Do Not Disturb, headphones, flight page", "plane", "flight", "Flight mode");
	types.cs2mode = presetButton("CS2 mode", "One tap: CS2, Do Not Disturb, high performance, CS2 page", "crosshair", "cs2", "CS2 mode");

	/* ================================================================== system health */
	var healthP = Round6.poller("/api/health", 300000, 15000);
	types.health = {
		name: "System health", desc: "Only speaks up when something needs you (full drive, updates, heat…)", icon: "pulse", group: "pc", helper: true, parts: ["system"],
		w: 3, h: 2, minW: 1, minH: 1, maxW: 6, maxH: 6, tickMs: 30000,
		options: function () {
			return [{ key: "temps", label: "Temperature warnings", type: "toggle", "default": true, on: "Warn when the CPU runs above 97 °C or the GPU above 85 °C", off: "No temperature warnings" }];
		},
		sourcesOf: function (t) { return t.cfg && t.cfg.temps === false ? [] : ["auto:cputemp", "auto:gputemp"]; },
		build: function (ctx) {
			var cfg = ctx.tile.cfg || {};
			ctx.body.innerHTML = '<div class="th">' + svg("pulse") + '<span>System health</span><span class="hl-n"></span></div><div class="hl-list"></div>';
			var list = ctx.body.querySelector(".hl-list"), n = ctx.body.querySelector(".hl-n"), shown = "";
			U.dragScroll(list);
			list.addEventListener("click", function (e) {
				var r = e.target.closest("[data-fix]");
				if (!r || App.editing) return;
				e.stopPropagation();
				Helper.act({ action: "quick", what: r.dataset.fix });
			});
			return function () {
				if (helperGate(ctx) === true) return;
				var r = healthP.get(), items = ((r && r.items) || []).slice();
				if (cfg.temps !== false) {
					var c = T.readSource("auto:cputemp"), g = T.readSource("auto:gputemp");
					var cc = c.value != null ? T.scaleOf(c.value, c.units) : null, gc = g.value != null ? T.scaleOf(g.value, g.units) : null;
					if (cc != null && cc >= 97) items.unshift({ level: "bad", icon: "thermo", text: "CPU is very hot: " + Math.round(cc) + "°C", sub: "Check the fans and the cooler" });
					if (gc != null && gc >= 85) items.unshift({ level: "warn", icon: "thermo", text: "GPU is very hot: " + Math.round(gc) + "°C", sub: "Check the fans and airflow" });
				}
				var mem = Helper.state.memory;
				if (mem && mem.percent >= 90) items.unshift({ level: "warn", icon: "chart", text: "Memory almost full: " + mem.percent + "%", sub: "Close something you don't need" });
				var key = JSON.stringify(items) + !!r;
				if (key === shown) return;
				shown = key;
				var worst = items.some(function (i) { return i.level === "bad"; }) ? "bad" : items.some(function (i) { return i.level === "warn"; }) ? "warn" : items.length ? "info" : "ok";
				ctx.node.dataset.level = worst;
				setText(n, items.length ? items.length + "" : "");
				if (ctx.w === 1 || (ctx.h === 1 && ctx.w === 2)) {
					ctx.body.querySelector(".th").style.display = "none";
					return setHtml(list, items.length ? '<div class="hl-mini"><b>' + items.length + "</b><span>" + (items.length === 1 ? "thing needs you" : "things need you") + "</span></div>"
						: '<div class="hl-mini">' + svg("check") + "<span>All good</span></div>");
				}
				if (!r && !items.length) return setHtml(list, '<div class="notice small"><span>Checking…</span></div>');
				if (r && r.items === undefined) return setHtml(list, '<div class="notice small"><span>Update Control Hub for this</span></div>');
				if (!items.length) return setHtml(list, '<div class="hl-ok">' + svg("check") + "<b>All good</b><span>Nothing needs your attention</span></div>");
				setHtml(list, items.map(function (i) {
					return '<div class="hl-row ' + esc(i.level) + '"' + (i.fix ? ' data-fix="' + esc(i.fix) + '"' : "") + '><span class="hl-ic">' + svg(i.icon || "bolt") + '</span><span class="hl-tx"><b>' + esc(i.text) + "</b>" + (i.sub ? "<em>" + esc(i.sub) + "</em>" : "") + "</span>" + (i.fix ? '<span class="hl-go">Open</span>' : "") + "</div>";
				}).join(""));
			};
		},
	};

	/* ================================================================== weather radar */
	var radarData = { at: 0, busy: false, frames: null, host: "", err: false };
	function loadRadar() {
		if (radarData.busy || Date.now() - radarData.at < 5 * 60000) return;
		radarData.busy = true;
		var url = "https://api.rainviewer.com/public/weather-maps.json";
		var get = Helper.online ? Helper.fetch("/api/fetch?url=" + encodeURIComponent(url), { cache: "no-store" }, 10000) : fetch(url).then(function (r) { return r.json(); });
		get.then(function (j) {
			radarData.frames = ((j && j.radar && j.radar.past) || []).slice(-6);
			radarData.host = (j && j.host) || "https://tilecache.rainviewer.com";
			radarData.err = !radarData.frames.length;
		}, function () { radarData.err = true; }).then(function () {
			radarData.at = Date.now();
			radarData.busy = false;
			App.dirty();
		});
	}

	function radarPlace(cfg) {
		if (cfg.place === "dest" || cfg.place === "from") {
			var c = typeof Flight !== "undefined" && Flight.plan ? Flight.plan() : null, p = c && c.data;
			if (p && p.to_lat != null) return cfg.place === "dest" ? { lat: p.to_lat, lon: p.to_lon, name: p.to } : { lat: p.from_lat, lon: p.from_lon, name: p.from };
			return { lat: 55.6759, lon: 12.5655, name: "Copenhagen (no SimBrief plan)" };
		}
		var w = null;
		Editor.layout().pages.forEach(function (pg) { pg.tiles.forEach(function (t) { if (!w && t.type === "weather" && t.cfg && t.cfg.lat != null) w = t.cfg; }); });
		return w ? { lat: +w.lat, lon: +w.lon, name: w.name || "" } : { lat: 55.6759, lon: 12.5655, name: "Copenhagen" };
	}

	types.radar = {
		name: "Weather radar", desc: "Rain radar for the last hour, animated", icon: "radar", group: "everyday",
		w: 3, h: 2, minW: 2, minH: 2, maxW: 8, maxH: 6, tickMs: 60000,
		options: function () {
			return [
				{ key: "place", label: "Where", type: "choice", "default": "home", choices: [{ value: "home", label: "My weather place" }, { value: "dest", label: "Flight destination (SimBrief)" }, { value: "from", label: "Flight departure (SimBrief)" }] },
				{ key: "zoom", label: "Zoom", type: "choice", "default": 6, choices: [{ value: 5, label: "Wide" }, { value: 6, label: "Region" }, { value: 7, label: "Close" }] },
			];
		},
		build: function (ctx) {
			var cfg = ctx.tile.cfg || {};
			ctx.node.classList.add("radar");
			ctx.body.innerHTML = '<div class="rd-map"><div class="rd-base"></div><div class="rd-frames"></div><div class="rd-labels"></div><i class="rd-dot"></i></div><div class="rd-bar"><span class="rd-place"></span><b class="rd-time"></b></div><div class="rd-note notice small" hidden></div>';
			var map = ctx.body.querySelector(".rd-map"), base = ctx.body.querySelector(".rd-base"), framesBox = ctx.body.querySelector(".rd-frames"), labels = ctx.body.querySelector(".rd-labels");
			var placeEl = ctx.body.querySelector(".rd-place"), timeEl = ctx.body.querySelector(".rd-time"), note = ctx.body.querySelector(".rd-note");
			var drawnKey = "", layers = [], idx = 0, anim = null, hold = 0;
			var TILE = 256 * 1.25;
			function world(lat, lon, z) {
				var n = Math.pow(2, z), r = (lat * Math.PI) / 180;
				return { x: ((lon + 180) / 360) * n, y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n };
			}
			function tilesHtml(z, c, W, H, urlOf) {
				var n = Math.pow(2, z), html = "";
				var x0 = Math.floor(c.x - W / 2 / TILE), x1 = Math.floor(c.x + W / 2 / TILE), y0 = Math.max(0, Math.floor(c.y - H / 2 / TILE)), y1 = Math.min(n - 1, Math.floor(c.y + H / 2 / TILE));
				for (var ty = y0; ty <= y1; ty++)
					for (var tx = x0; tx <= x1; tx++) {
						var wx = ((tx % n) + n) % n;
						var left = Math.round(W / 2 + (tx - c.x) * TILE), top = Math.round(H / 2 + (ty - c.y) * TILE);
						html += '<img alt="" draggable="false" onerror="this.style.visibility=\'hidden\'" style="left:' + left + "px;top:" + top + "px;width:" + TILE + "px;height:" + TILE + 'px" src="' + urlOf(wx, ty, (tx + ty) % 4) + '" />';
					}
				return html;
			}
			function stop() { clearInterval(anim); anim = null; }
			function step() {
				if (!ctx.node.isConnected) return stop();
				if (!layers.length || (typeof Look !== "undefined" && Look.sleeping) || App.editing) return;
				if (hold > 0) { hold--; return; }
				idx = (idx + 1) % layers.length;
				layers.forEach(function (l, i) { l.classList.toggle("on", i === idx); });
				var f = radarData.frames[idx];
				if (f) {
					var d = new Date(f.time * 1000);
					setText(timeEl, ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2) + (idx === layers.length - 1 ? " · latest" : ""));
				}
				if (idx === layers.length - 1) hold = 3;
			}
			return function () {
				loadRadar();
				var p = radarPlace(cfg), z = Math.min(7, cfg.zoom || 6);
				setText(placeEl, p.name);
				var W = map.clientWidth, H = map.clientHeight;
				if (!W || !H) return;
				var dark = !document.body.classList.contains("theme-light");
				var key = [p.lat, p.lon, z, W, H, dark, radarData.at].join("|");
				note.hidden = !(radarData.err && !radarData.frames);
				if (!note.hidden) setHtml(note, "<span>Couldn't load the radar right now</span>");
				if (key === drawnKey) return;
				drawnKey = key;
				var c = world(p.lat, p.lon, z);
				var sub = "abcd";
				base.innerHTML = tilesHtml(z, c, W, H, function (x, y, s) { return "https://" + sub[s] + ".basemaps.cartocdn.com/" + (dark ? "dark_nolabels" : "light_nolabels") + "/" + z + "/" + x + "/" + y + ".png"; });
				labels.innerHTML = tilesHtml(z, c, W, H, function (x, y, s) { return "https://" + sub[s] + ".basemaps.cartocdn.com/" + (dark ? "dark_only_labels" : "light_only_labels") + "/" + z + "/" + x + "/" + y + ".png"; });
				framesBox.innerHTML = "";
				layers = (radarData.frames || []).map(function (f, i) {
					var l = el("div", "rd-layer" + (i === (radarData.frames.length - 1) ? " on" : ""));
					l.innerHTML = tilesHtml(z, c, W, H, function (x, y) { return radarData.host + f.path + "/256/" + z + "/" + x + "/" + y + "/2/1_1.png"; });
					framesBox.appendChild(l);
					return l;
				});
				idx = layers.length - 1;
				hold = 3;
				if (layers.length) {
					var f = radarData.frames[idx], d = new Date(f.time * 1000);
					setText(timeEl, ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2) + " · latest");
				}
				stop();
				if (layers.length > 1) anim = setInterval(step, 650);
			};
		},
	};

	return {
		check: check,
		needsChanged: needsChanged,
		live: function () { return live.ok; },
		cs2: cs2,
		csTile: csTile,
		notifCfg: notifCfg,
		setNotifCfg: setNotifCfg,
		testBanner: testBanner,
		_onNotif: onNotif,
		_onCs2: onCs2,
	};
})();
