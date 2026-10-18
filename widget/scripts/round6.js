/* Control Panel — Round 6: window switcher, app audio output, mic level, Do Not Disturb, clean-up,
 * Spotify, Twitch, Steam, stopwatch, Pomodoro and keyboard shortcuts for pages. */

var Round6 = (function () {
	var svg = U.svg, el = U.el, esc = U.esc, setText = U.setText, setHtml = U.setHtml;
	var types = T.types, helperGate = T.helperGate;

	/* Asks the helper for something while a tile is on screen, at most every `every` ms. */
	function poller(path, every, timeout) {
		var p = { data: null, at: 0, busy: false, err: false };
		p.get = function (force) {
			if (Helper.online && !p.busy && (force || Date.now() - p.at > every)) {
				p.busy = true;
				Helper.fetch(path, { cache: "no-store" }, timeout || 10000).then(function (r) { p.data = r; p.err = false; }, function () { p.err = true; }).then(function () {
					p.at = Date.now();
					p.busy = false;
					App.dirty();
				});
			}
			return p.data;
		};
		p.soon = function () { p.at = 0; setTimeout(function () { p.get(true); }, 400); };
		return p;
	}

	function iconInto(box, iconId, fallback) {
		if (box.__icon === iconId) return;
		box.__icon = iconId;
		box.innerHTML = svg(fallback);
		if (!iconId) return;
		var img = new Image();
		img.alt = "";
		img.onload = function () { if (box.__icon === iconId) { box.innerHTML = ""; box.appendChild(img); } };
		img.src = Helper.iconUrl(iconId);
	}

	function gb(bytes) {
		var mb = (bytes || 0) / 1048576;
		return mb >= 1024 ? (mb / 1024).toFixed(1) + " GB" : Math.round(mb) + " MB";
	}

	function guide(title, steps, url, urlLabel) {
		var wrap = el("div", "opts");
		Editor.modal(title, wrap);
		var ol = el("ol", "guide");
		steps.forEach(function (s) {
			var li = el("li", "", "<b></b>" + (s[1] ? "<em></em>" : ""));
			li.querySelector("b").textContent = s[0];
			if (s[1]) li.querySelector("em").textContent = s[1];
			ol.appendChild(li);
		});
		wrap.appendChild(ol);
		if (url) {
			var b = el("button", "pill accent save-btn", esc(urlLabel || "Open the website on my PC"));
			b.addEventListener("click", function () { Helper.act({ action: "openUrl", url: url }); });
			wrap.appendChild(b);
		}
	}

	/* ------------------------------------------------------------------ window switcher */
	var winP = poller("/api/windowlist", 2000);
	types.windows = {
		name: "Window switcher", desc: "Your open windows · tap to bring to the front", icon: "window", group: "pc", helper: true,
		w: 3, h: 2, minW: 1, minH: 1, maxW: 6, maxH: 6, tickMs: 2000,
		build: function (ctx) {
			ctx.body.innerHTML = '<div class="ws"></div>';
			var box = ctx.body.querySelector(".ws"), items = {}, holdT = null, held = false;
			box.addEventListener("pointerdown", function (e) {
				var b = e.target.closest("[data-id]");
				held = false;
				clearTimeout(holdT);
				if (!b || App.editing) return;
				holdT = setTimeout(function () {
					held = true;
					Editor.confirm({ title: "Close this window?", text: b.__title || "", ok: "Close", icon: "x", danger: true }, function () {
						Helper.act({ action: "winClose", id: b.dataset.id }).then(function () { winP.soon(); });
					});
				}, 800);
			});
			["pointerup", "pointercancel", "pointerleave"].forEach(function (n) { box.addEventListener(n, function () { clearTimeout(holdT); }); });
			box.addEventListener("click", function (e) {
				var b = e.target.closest("[data-id]");
				if (!b || App.editing) return;
				e.stopPropagation();
				if (held) { held = false; return; }
				Helper.act({ action: "winFocus", id: b.dataset.id }, true).then(function () { winP.soon(); });
			});
			return function () {
				if (helperGate(ctx) === true) return;
				var r = winP.get();
				var wins = (r && r.windows) || [];
				var max = Math.max(1, ctx.w * ctx.h * (ctx.w >= 2 ? 2 : 1));
				wins = wins.slice(0, max);
				var seen = {};
				wins.forEach(function (w, i) {
					seen[w.id] = true;
					var b = items[w.id];
					if (!b) {
						b = items[w.id] = el("button", "ws-b", '<span class="ws-ic"></span><span class="ws-t"></span>');
						b.dataset.id = w.id;
					}
					b.__title = w.title;
					iconInto(b.querySelector(".ws-ic"), w.icon, "window");
					setText(b.querySelector(".ws-t"), w.name || w.title);
					b.title = w.title;
					b.classList.toggle("on", !!w.active);
					b.classList.toggle("min", !!w.min);
					if (box.children[i] !== b) box.insertBefore(b, box.children[i] || null);
				});
				Object.keys(items).forEach(function (id) { if (!seen[id]) { if (items[id].parentNode) items[id].parentNode.removeChild(items[id]); delete items[id]; } });
				if (!wins.length && !box.querySelector(".notice")) box.innerHTML = '<div class="notice small"><span>' + (r ? "No open windows" : "Loading…") + "</span></div>";
				else if (wins.length) { var n = box.querySelector(".notice"); if (n) n.remove(); }
			};
		},
	};

	/* ------------------------------------------------------------------ app audio output */
	var outP = poller("/api/appout", 5000);
	types.appout = {
		name: "App audio output", desc: "Pick headphones or speakers per app", icon: "headset", group: "media", helper: true, parts: ["audio"],
		w: 3, h: 2, minW: 2, minH: 1, maxW: 6, maxH: 6, tickMs: 5000,
		build: function (ctx) {
			ctx.body.innerHTML = T.head("headset", "App audio output") + '<div class="ao-list"></div>';
			var list = ctx.body.querySelector(".ao-list");
			U.dragScroll(list);
			list.addEventListener("click", function (e) {
				var c = e.target.closest("[data-dev]");
				if (!c || App.editing) return;
				e.stopPropagation();
				var row = c.closest("[data-key]");
				row.querySelectorAll("[data-dev]").forEach(function (x) { x.classList.toggle("on", x === c); });
				Helper.act({ action: "appOut", key: row.dataset.key, device: c.dataset.dev }, true).then(function (ok) {
					U.toast(ok ? "Done. Some apps switch after their next sound, some after a restart" : "Windows didn't allow that for this app");
					outP.soon();
				});
			});
			var shown = "";
			return function () {
				if (helperGate(ctx) === true) return;
				var r = outP.get(), outs = (Helper.state.outputs || []);
				if (!r) return setHtml(list, '<div class="notice small"><span>Loading…</span></div>');
				var apps = r.apps || [];
				var key = JSON.stringify([apps, outs.map(function (o) { return o.id; })]);
				if (key === shown) return;
				shown = key;
				if (!apps.length) return setHtml(list, '<div class="notice small"><span>No apps are playing sound right now</span></div>');
				function short(n) { return (n || "").replace(/\s*\(.*\)\s*$/, "") || n; }
				setHtml(list, apps.map(function (a) {
					return '<div class="ao-row" data-key="' + esc(a.key) + '"><div class="ao-name"><span class="ao-ic" data-icon="' + esc(a.icon || "") + '"></span><b>' + esc(a.name) + '</b></div><div class="ao-devs">' +
						'<button class="chip' + (!a.device ? " on" : "") + '" data-dev="">Default</button>' +
						outs.map(function (o) { return '<button class="chip' + (a.device === o.id ? " on" : "") + '" data-dev="' + esc(o.id) + '">' + esc(short(o.name)) + "</button>"; }).join("") + "</div></div>";
				}).join(""));
				list.querySelectorAll(".ao-ic").forEach(function (ic) { iconInto(ic, ic.dataset.icon, "apps"); });
			};
		},
	};

	/* ------------------------------------------------------------------ mic level */
	types.micmeter = {
		name: "Mic level", desc: "See your mic pick you up", icon: "mic", group: "media", helper: true, parts: ["audio"],
		w: 2, h: 1, minW: 1, minH: 1, maxW: 6, maxH: 2,
		options: function () {
			return [{ key: "device", label: "Microphone", type: "choice", "default": "", layout: "list", choices: [{ value: "", label: "Windows default" }].concat(T.deviceChoices(true)) }];
		},
		build: function (ctx) {
			var cfg = ctx.tile.cfg || {};
			ctx.body.innerHTML = '<div class="mm"><div class="mm-top">' + svg("mic") + '<b class="mm-name"></b><span class="mm-st"></span></div><div class="mm-bar"><i></i><s></s></div></div>';
			var bar = ctx.body.querySelector(".mm-bar i"), peakMark = ctx.body.querySelector(".mm-bar s"), name = ctx.body.querySelector(".mm-name"), st = ctx.body.querySelector(".mm-st");
			var hold = 0, holdAt = 0, timer = null, smooth = 0;
			function tick() {
				if (!ctx.node.isConnected) { clearInterval(timer); return; }
				if (!Helper.online || Look.sleeping) return;
				Helper.fetch("/api/micpeak?device=" + encodeURIComponent(cfg.device || ""), { cache: "no-store" }, 1500).then(function (r) {
					var p = r.peak || 0;
					// Shown on a "loudness" scale so normal talking fills the bar nicely.
					var lvl = p > 0 ? U.clamp((20 * Math.log10(p) + 60) / 60, 0, 1) : 0;
					smooth = lvl > smooth ? lvl : smooth * 0.8 + lvl * 0.2;
					if (smooth >= hold || Date.now() - holdAt > 1200) { hold = smooth; holdAt = Date.now(); }
					bar.style.width = Math.round(smooth * 100) + "%";
					peakMark.style.left = Math.round(hold * 100) + "%";
					ctx.node.classList.toggle("mm-hot", smooth > 0.92);
					setText(name, r.name || "Microphone");
					setText(st, smooth > 0.25 ? "We hear you" : "Quiet");
				}, function () {});
			}
			timer = setInterval(tick, 120);
			return function () {
				if (helperGate(ctx) === true) return;
				var ep = T.endpointFor(true, cfg.device || "");
				ctx.node.classList.toggle("mm-muted", !!(ep && ep.muted));
				if (ep && ep.muted) setText(st, "Muted");
			};
		},
	};

	/* ------------------------------------------------------------------ Do Not Disturb */
	types.dnd = {
		name: "Do Not Disturb", desc: "Turn Windows notifications off and on", icon: "moon", group: "pc", helper: true, parts: ["dnd"],
		w: 1, h: 1, minW: 1, minH: 1, maxW: 2, maxH: 2,
		build: function (ctx) {
			ctx.node.classList.add("press", "toggle-tile");
			ctx.body.innerHTML = '<div class="tg">' + svg("moon") + '<span class="nm">Do Not Disturb</span><span class="switch"><i></i></span><b class="st"></b></div>';
			var st = ctx.body.querySelector(".st");
			ctx.node.addEventListener("click", function () {
				if (App.editing) return;
				if (!Helper.online) return U.toast("Start Control Hub for this");
				Helper.state.dnd = !Helper.state.dnd;
				Helper.hold("dnd", 3000);
				App.dirty();
				Helper.act({ action: "dnd", on: Helper.state.dnd });
			});
			return function () {
				var on = !!(Helper.online && Helper.state.dnd);
				ctx.node.classList.toggle("on", on);
				setText(st, on ? "On" : "Off");
			};
		},
	};

	/* ------------------------------------------------------------------ clean-up */
	types.cleanup = {
		name: "Clean-up", desc: "Empty the recycle bin and old temporary files", icon: "x", group: "pc", helper: true, parts: ["cleanup"],
		w: 2, h: 1, minW: 1, minH: 1, maxW: 4, maxH: 2,
		build: function (ctx) {
			ctx.node.classList.add("press");
			ctx.body.innerHTML = '<div class="cu"><span class="cu-ic">' + svg("x") + '</span><div class="cu-tx"><b class="cu-v"></b><span class="cu-s"></span></div></div>';
			var v = ctx.body.querySelector(".cu-v"), s = ctx.body.querySelector(".cu-s"), wasRunning = false;
			ctx.node.addEventListener("click", function () {
				if (App.editing) return;
				var c = Helper.state.cleanup;
				if (!Helper.online || !c) return U.toast("Start Control Hub for this");
				if (c.running) return;
				Editor.confirm({ title: "Clean up?", text: "Empties the recycle bin (" + gb(c.bin) + ") and deletes temporary files older than a day (" + gb(c.temp) + "). This can't be undone.", ok: "Clean up", icon: "x", danger: true }, function () {
					c.running = true;
					App.dirty();
					Helper.act({ action: "cleanup" });
				});
			});
			return function () {
				if (helperGate(ctx) === true) return;
				var c = Helper.state.cleanup;
				if (!c) return setText(v, "…");
				if (wasRunning && !c.running && c.freed != null) U.toast("Freed " + gb(c.freed));
				wasRunning = !!c.running;
				ctx.node.classList.toggle("measuring", !!c.running);
				setText(v, c.running ? "Cleaning…" : gb((c.bin || 0) + (c.temp || 0)));
				setText(s, c.running ? "" : "can be freed · tap to clean");
			};
		},
	};

	/* ------------------------------------------------------------------ Spotify */
	var spP = poller("/api/spotify", 2000, 15000);
	var plP = poller("/api/spotify/playlists", 300000, 20000);
	var quP = poller("/api/spotify/queue", 10000, 15000);
	function spotifyGuide() {
		var s = spP.data || {};
		guide("Connect Spotify (one time)", [
			["On your PC, open developer.spotify.com/dashboard and log in", ""],
			["Click Create app. Name: Control Panel. Description: anything", ""],
			["Redirect URI: type " + (s.redirect || "http://127.0.0.1:39812/spotify/callback") + " and click Add", "Exactly like that"],
			["Tick Web API, accept the terms and click Save", ""],
			["Open the app's Settings and copy the Client ID", ""],
			["Open Control Hub → Connections → Spotify and paste the Client ID", "Your browser opens: log in and click Agree"],
			["Changing what plays needs Spotify Premium", "That's Spotify's rule for all apps. Without Premium you can still see what plays"],
		], "https://developer.spotify.com/dashboard", "Open Spotify's developer site on my PC");
	}

	types.spotify = {
		name: "Spotify", desc: "Playlists, like, shuffle, repeat and up next", icon: "music", group: "media", helper: true,
		w: 3, h: 2, minW: 2, minH: 1, maxW: 6, maxH: 4, tickMs: 2000,
		build: function (ctx) {
			ctx.body.innerHTML = '<div class="sp"><div class="sp-top"><span class="sp-art"></span><div class="sp-tx"><b class="sp-t"></b><span class="sp-a"></span><span class="sp-d"></span></div></div>' +
				'<div class="sp-prog"><i></i></div><div class="sp-ctl">' +
				'<button data-a="shuffle" class="sp-sm">' + svg("shuffle") + '</button><button data-a="prev">' + svg("prev") + '</button><button data-a="play" class="sp-play"></button><button data-a="next">' + svg("next") + '</button><button data-a="repeat" class="sp-sm"></button>' +
				'<button data-a="like" class="sp-sm sp-like">' + svg("heart") + '</button><button data-a="lists" class="sp-sm">' + svg("list") + '</button></div><div class="sp-q"></div></div><div class="sp-off notice small"></div>';
			var q = function (c) { return ctx.body.querySelector(c); };
			var art = q(".sp-art"), t = q(".sp-t"), a = q(".sp-a"), dv = q(".sp-d"), prog = q(".sp-prog i"), play = q(".sp-play"), rep = q('[data-a="repeat"]'), like = q(".sp-like"), off = q(".sp-off"), queue = q(".sp-q");
			var shownImg = null;
			ctx.body.querySelector(".sp-ctl").addEventListener("click", function (e) {
				var b = e.target.closest("[data-a]");
				if (!b || App.editing) return;
				e.stopPropagation();
				var p = (spP.data && spP.data.player) || {};
				var w = b.dataset.a;
				if (w === "lists") return pickPlaylist();
				var body = { action: "spotify", what: w };
				if (w === "play") { body.what = p.playing ? "pause" : "play"; p.playing = !p.playing; }
				if (w === "shuffle") { p.shuffle = !p.shuffle; body.value = p.shuffle ? 1 : 0; }
				if (w === "repeat") { var n = { off: 1, context: 2, track: 0 }[p.repeat || "off"]; p.repeat = ["off", "context", "track"][n]; body.value = n; }
				if (w === "like") { body.what = p.liked ? "unlike" : "like"; p.liked = !p.liked; }
				App.dirty();
				Helper.act(body, true).then(function (ok) {
					if (!ok) U.toast((spP.data && spP.data.error) || "Spotify didn't do that (is Spotify open and playing on a device?)");
					spP.soon();
					quP.soon();
				});
			});
			off.addEventListener("click", function (e) { if (e.target.closest(".sp-how") && !App.editing) { e.stopPropagation(); spotifyGuide(); } });
			return function () {
				if (helperGate(ctx) === true) return;
				var s = spP.get();
				var ready = s && s.connected;
				ctx.node.classList.toggle("sp-ready", !!ready);
				if (!ready) {
					setHtml(off, !s ? "<span>Connecting…</span>" : '<b>Connect Spotify once</b><span>For playlists, like, shuffle and what plays next.</span><button class="pill accent sp-how">How?</button>');
					return;
				}
				var p = s.player;
				ctx.node.classList.toggle("sp-idle", !p || !p.title);
				if (s.starting) { shownImg = null; art.style.backgroundImage = ""; setHtml(queue, ""); ctx.node.classList.add("sp-idle"); setText(t, "Starting Spotify…"); setText(a, "Your music starts in a moment"); setText(dv, ""); setHtml(play, svg("play")); return; }
				if (!p || !p.title) { setText(t, "Nothing playing"); setText(a, s.error || "Tap play to start Spotify"); setText(dv, ""); setHtml(play, svg("play")); return; }
				setText(t, p.title);
				setText(a, p.artist);
				setText(dv, p.device ? "on " + p.device : "");
				if (p.image !== shownImg) { shownImg = p.image; art.style.backgroundImage = p.image ? 'url("' + p.image.replace(/"/g, "") + '")' : ""; }
				prog.style.width = p.duration ? Math.min(100, (p.progress / p.duration) * 100) + "%" : "0%";
				setHtml(play, svg(p.playing ? "pause" : "play"));
				q('[data-a="shuffle"]').classList.toggle("on", !!p.shuffle);
				setHtml(rep, svg("repeat") + (p.repeat === "track" ? "<small>1</small>" : ""));
				rep.classList.toggle("on", p.repeat && p.repeat !== "off");
				like.classList.toggle("on", !!p.liked);
				if (ctx.h >= 3 || (ctx.h >= 2 && ctx.w >= 4)) {
					var qu = quP.get();
					setHtml(queue, qu && qu.queue && qu.queue.length ? "<h5>Up next</h5>" + qu.queue.slice(0, ctx.h >= 3 ? 6 : 3).map(function (x) { return "<div><b>" + esc(x.title) + "</b> · " + esc(x.artist) + "</div>"; }).join("") : "");
				}
			};
		},
	};

	function pickPlaylist() {
		var wrap = el("div", "opts");
		Editor.modal("Play a playlist", wrap);
		wrap.innerHTML = '<p class="hint">Loading your playlists…</p>';
		var r = plP.get(true);
		function draw() {
			var lists = (plP.data && plP.data.playlists) || [];
			if (!plP.data) return;
			var g = el("div", "pl-grid");
			lists.forEach(function (p) {
				var b = el("button", "pl", '<span class="pl-img"></span><b></b>');
				b.querySelector("b").textContent = p.name;
				if (p.image) b.querySelector(".pl-img").style.backgroundImage = 'url("' + p.image.replace(/"/g, "") + '")';
				else b.querySelector(".pl-img").innerHTML = svg("heart");
				b.addEventListener("click", function () {
					Helper.act({ action: "spotify", what: "playlist", uri: p.uri }, true).then(function (ok) {
						U.toast(ok ? "Playing " + p.name : (spP.data && spP.data.error) || "Spotify didn't start it (open Spotify on a device first)");
						if (ok) Editor.closeModal();
						spP.soon();
					});
				});
				g.appendChild(b);
			});
			wrap.innerHTML = "";
			wrap.appendChild(g);
		}
		if (r) draw();
		var wait = setInterval(function () { if (plP.data) { clearInterval(wait); draw(); } }, 300);
		setTimeout(function () { clearInterval(wait); }, 20000);
	}

	/* ------------------------------------------------------------------ Twitch */
	var twP = poller("/api/twitch", 60000, 15000);
	function twitchGuide() {
		guide("Connect Twitch (one time)", [
			["On your PC, open dev.twitch.tv/console/apps and log in", "Twitch may ask you to turn on two-factor login first"],
			["Click Register Your Application. Name: Control Panel (plus something unique, e.g. your name)", ""],
			["OAuth Redirect URL: http://localhost. Category: Application Integration. Client Type: Public", ""],
			["Click Create, then Manage, and copy the Client ID", ""],
			["Open Control Hub → Connections → Twitch and paste the Client ID", "Your browser opens: check the code and click Activate"],
		], "https://dev.twitch.tv/console/apps", "Open Twitch's developer site on my PC");
	}
	types.twitch = {
		name: "Twitch live", desc: "Who you follow is live right now", icon: "stream", group: "media", helper: true,
		w: 3, h: 2, minW: 2, minH: 1, maxW: 6, maxH: 6, tickMs: 30000,
		build: function (ctx) {
			ctx.body.innerHTML = '<div class="th">' + svg("stream") + '<span>Live on Twitch</span><span class="tw-n"></span></div><div class="tw-list"></div>';
			var list = ctx.body.querySelector(".tw-list"), n = ctx.body.querySelector(".tw-n");
			U.dragScroll(list);
			list.addEventListener("click", function (e) {
				if (App.editing) return;
				if (e.target.closest(".tw-how")) { e.stopPropagation(); return twitchGuide(); }
				var r = e.target.closest("[data-login]");
				if (r) { e.stopPropagation(); Helper.act({ action: "openUrl", url: "https://www.twitch.tv/" + r.dataset.login }); }
			});
			var shown = "";
			return function () {
				if (helperGate(ctx) === true) return;
				var s = twP.get();
				if (s && s.code) twP.at = Date.now() - 55000; // logging in: check again soon
				if (!s || !s.connected) {
					shown = "";
					return setHtml(list, '<div class="notice small">' + (!s ? "<span>Connecting…</span>" : s.code ? "<b>Enter " + esc(s.code) + "</b><span>on twitch.tv/activate (it's open in your browser)</span>" : '<b>Connect Twitch once</b><span>To see who you follow is live.</span><button class="pill accent tw-how">How?</button>') + "</div>");
				}
				var live = s.live || [];
				setText(n, live.length ? live.length + " live" : "");
				var key = JSON.stringify(live.map(function (x) { return [x.login, x.viewers, x.title]; }));
				if (key === shown) return;
				shown = key;
				setHtml(list, live.length ? live.map(function (x) {
					return '<button class="tw-row" data-login="' + esc(x.login) + '"><span class="tw-th" style="background-image:url(&quot;' + esc(x.thumb) + '&quot;)"><i>LIVE</i></span><span class="tw-tx"><b>' + esc(x.name) + "</b><em>" + esc(x.game || "") + "</em><small>" + esc(x.title || "") + '</small></span><span class="tw-v">' + Number(x.viewers || 0).toLocaleString("en-GB") + "</span></button>";
				}).join("") : '<div class="notice small"><span>' + esc(s.error || "Nobody you follow is live right now") + "</span></div>");
			};
		},
	};

	/* ------------------------------------------------------------------ Steam */
	var stP = poller("/api/steam", 120000, 20000);
	types.steam = {
		name: "Steam games", desc: "Your games, newest played first · tap to play", icon: "gamepad", group: "pc", helper: true,
		w: 4, h: 2, minW: 1, minH: 1, maxW: 6, maxH: 6, tickMs: 60000,
		options: function () {
			return [{ key: "show", label: "Show", type: "choice", "default": "games", choices: [{ value: "games", label: "Games" }, { value: "friends", label: "Friends online (needs a Steam key)" }] }];
		},
		build: function (ctx) {
			var cfg = ctx.tile.cfg || {};
			ctx.body.innerHTML = '<div class="sg"></div>';
			var box = ctx.body.querySelector(".sg");
			box.addEventListener("click", function (e) {
				var b = e.target.closest("[data-app]");
				if (!b || App.editing) return;
				e.stopPropagation();
				Helper.act({ action: "steamRun", id: b.dataset.app }, true).then(function (ok) { U.toast(ok ? "Starting " + b.dataset.name + "…" : "Couldn't start it"); });
			});
			var shown = "";
			return function () {
				if (helperGate(ctx) === true) return;
				var s = stP.get();
				if (!s) return setHtml(box, '<div class="notice small"><span>Loading your games…</span></div>');
				var key;
				if (cfg.show === "friends") {
					if (!s.hasKey) return setHtml(box, '<div class="notice small"><b>Needs a Steam Web API key</b><span>Get one free at steamcommunity.com/dev/apikey, then Control Hub → Connections → Steam</span></div>');
					var f = s.friends || [];
					key = JSON.stringify(f);
					if (key === shown) return;
					shown = key;
					box.className = "sg sg-friends";
					return setHtml(box, f.length ? f.map(function (x) {
						return '<div class="sf"><img alt="" src="' + esc(x.avatar) + '" /><span><b>' + esc(x.name) + "</b><em>" + esc(x.game ? "Playing " + x.game : ["Offline", "Online", "Busy", "Away", "Snooze", "Looking to trade", "Looking to play"][x.state] || "Online") + "</em></span></div>";
					}).join("") : '<div class="notice small"><span>No friends online</span></div>');
				}
				var games = (s.games || []).slice(0, Math.max(1, ctx.w * ctx.h * 2));
				key = JSON.stringify(games.map(function (g) { return g.id; }));
				if (key === shown) return;
				shown = key;
				box.className = "sg";
				setHtml(box, games.length ? games.map(function (g) {
					var hours = g.minutes ? Math.round(g.minutes / 60) + " h" : "";
					return '<button class="sg-g" data-app="' + esc(g.id) + '" data-name="' + esc(g.name) + '"><img alt="" loading="lazy" src="https://cdn.cloudflare.steamstatic.com/steam/apps/' + esc(g.id) + '/library_600x900.jpg" onerror="if(this.dataset.f){this.style.visibility=\'hidden\'}else{this.dataset.f=1;this.src=\'https://cdn.cloudflare.steamstatic.com/steam/apps/' + esc(g.id) + '/header.jpg\'}" /><span><b>' + esc(g.name) + "</b>" + (hours ? "<em>" + hours + "</em>" : "") + "</span></button>";
				}).join("") : '<div class="notice small"><span>No Steam games found on this PC</span></div>');
			};
		},
	};

	/* ------------------------------------------------------------------ stopwatch */
	function clock(ms, tenths) {
		var s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
		return (h ? h + ":" + ("0" + m).slice(-2) : m) + ":" + ("0" + (s % 60)).slice(-2) + (tenths ? "<small>." + Math.floor((ms % 1000) / 100) + "</small>" : "");
	}
	types.stopwatch = {
		name: "Stopwatch", desc: "Start, stop and laps", icon: "timer", group: "everyday",
		w: 2, h: 1, minW: 1, minH: 1, maxW: 4, maxH: 3,
		tickMs: function (t) { return t.cfg && t.cfg.startAt ? 100 : 0; },
		build: function (ctx) {
			var cfg = ctx.tile.cfg || (ctx.tile.cfg = {});
			ctx.body.innerHTML = '<div class="sw"><b class="sw-t"></b><div class="sw-btns"><button data-a="go" class="sw-go"></button><button data-a="lap">Lap</button><button data-a="reset">Reset</button></div></div><div class="sw-laps"></div>';
			var t = ctx.body.querySelector(".sw-t"), go = ctx.body.querySelector(".sw-go"), laps = ctx.body.querySelector(".sw-laps");
			function now() { return (cfg.acc || 0) + (cfg.startAt ? Date.now() - cfg.startAt : 0); }
			ctx.body.querySelector(".sw-btns").addEventListener("click", function (e) {
				var b = e.target.closest("[data-a]");
				if (!b || App.editing) return;
				e.stopPropagation();
				if (b.dataset.a === "go") { if (cfg.startAt) { cfg.acc = now(); cfg.startAt = 0; } else cfg.startAt = Date.now(); }
				if (b.dataset.a === "lap" && cfg.startAt) cfg.laps = [now()].concat(cfg.laps || []).slice(0, 20);
				if (b.dataset.a === "reset") { cfg.acc = 0; cfg.startAt = 0; cfg.laps = []; }
				Editor.save();
				App.refreshNeeds();
				App.dirty();
			});
			return function () {
				setHtml(t, clock(now(), true));
				setText(go, cfg.startAt ? "Stop" : now() ? "Go on" : "Start");
				go.classList.toggle("on", !!cfg.startAt);
				var l = cfg.laps || [];
				setHtml(laps, ctx.h >= 2 ? l.map(function (x, i) { return "<div><span>Lap " + (l.length - i) + "</span><b>" + clock(x, true) + "</b></div>"; }).join("") : "");
			};
		},
	};

	/* ------------------------------------------------------------------ Pomodoro */
	var beepCtx = null;
	function chime(n) {
		try {
			beepCtx = beepCtx || new (window.AudioContext || window.webkitAudioContext)();
			for (var i = 0; i < n; i++) {
				var t0 = beepCtx.currentTime + i * 0.3, o = beepCtx.createOscillator(), g = beepCtx.createGain();
				o.frequency.value = 660 + i * 220;
				g.gain.setValueAtTime(0.0001, t0);
				g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
				g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
				o.connect(g); g.connect(beepCtx.destination); o.start(t0); o.stop(t0 + 0.3);
			}
		} catch (e) {}
	}
	types.pomodoro = {
		name: "Pomodoro", desc: "Focus 25 min, break 5 min", icon: "timer", group: "everyday",
		w: 2, h: 1, minW: 1, minH: 1, maxW: 4, maxH: 2,
		tickMs: function (t) { return t.cfg && t.cfg.endAt ? 1000 : 0; },
		options: function () {
			return [
				{ key: "focus", label: "Focus", type: "choice", "default": 25, choices: [15, 20, 25, 30, 45, 50].map(function (m) { return { value: m, label: m + " min" }; }) },
				{ key: "brk", label: "Break", type: "choice", "default": 5, choices: [3, 5, 10, 15].map(function (m) { return { value: m, label: m + " min" }; }) },
			];
		},
		build: function (ctx) {
			var cfg = ctx.tile.cfg || (ctx.tile.cfg = {});
			ctx.node.classList.add("press");
			ctx.body.innerHTML = '<div class="pd"><span class="pd-ph"></span><b class="pd-t"></b><span class="pd-s"></span></div>';
			var ph = ctx.body.querySelector(".pd-ph"), t = ctx.body.querySelector(".pd-t"), s = ctx.body.querySelector(".pd-s");
			function len(phase) { return (phase === "break" ? cfg.brk || 5 : cfg.focus || 25) * 60000; }
			ctx.node.addEventListener("click", function () {
				if (App.editing) return;
				if (cfg.endAt) { cfg.left = cfg.endAt - Date.now(); cfg.endAt = 0; }
				else { cfg.phase = cfg.phase || "focus"; cfg.endAt = Date.now() + (cfg.left || len(cfg.phase)); cfg.left = 0; }
				Editor.save();
				App.refreshNeeds();
				App.dirty();
			});
			var holdT = null;
			ctx.node.addEventListener("pointerdown", function () {
				clearTimeout(holdT);
				holdT = setTimeout(function () { cfg.endAt = 0; cfg.left = 0; cfg.phase = "focus"; cfg.round = 0; Editor.save(); U.toast("Pomodoro reset"); App.refreshNeeds(); App.dirty(); }, 900);
			});
			["pointerup", "pointercancel", "pointerleave"].forEach(function (n) { ctx.node.addEventListener(n, function () { clearTimeout(holdT); }); });
			return function () {
				var phase = cfg.phase || "focus";
				if (cfg.endAt && Date.now() >= cfg.endAt) {
					// Switch focus ⇄ break by itself.
					var next = phase === "focus" ? "break" : "focus";
					if (phase === "focus") cfg.round = (cfg.round || 0) + 1;
					cfg.phase = next;
					cfg.endAt = Date.now() + len(next);
					Editor.save();
					chime(next === "break" ? 2 : 3);
					U.toast(next === "break" ? "Time for a break" : "Back to focus");
					if (typeof Look !== "undefined") Look.wake();
					phase = next;
				}
				var left = cfg.endAt ? cfg.endAt - Date.now() : cfg.left || len(phase);
				ctx.node.dataset.phase = phase;
				setText(ph, phase === "break" ? "Break" : "Focus" + (cfg.round ? " · " + (cfg.round + 1) : ""));
				setHtml(t, clock(Math.max(0, left)));
				setText(s, cfg.endAt ? "tap to pause" : cfg.left ? "paused · tap to go on" : "tap to start · hold to reset");
			};
		},
	};

	/* ------------------------------------------------------------------ keyboard shortcuts → pages */
	var keySeq = -1, keyRunning = false;
	function watchKeys() {
		if (keyRunning) return;
		keyRunning = true;
		(function next() {
			if (!Helper.online) { keyRunning = false; return; }
			Helper.fetch("/api/pagecmd?since=" + keySeq, { cache: "no-store" }, 30000).then(function (r) {
				var first = keySeq < 0;
				keySeq = r.seq;
				if (!first && r.cmd) {
					var L = Editor.layout(), n = L.pages.length;
					if (typeof Look !== "undefined") Look.wake();
					if (r.cmd === "next") Editor.goPage((L.current + 1) % n, "user");
					else if (r.cmd === "prev") Editor.goPage((L.current - 1 + n) % n, "user");
					else { var i = +r.cmd.split(":")[1]; if (i < n) Editor.goPage(i, "user"); }
				}
				setTimeout(next, 50);
			}, function () { setTimeout(next, 5000); });
		})();
	}

	return {
		check: function () { /* page shortcuts were removed (AltGr clash) */ },
		spotify: spP,
		poller: poller,
		iconInto: iconInto,
		guide: guide,
		spotifyGuide: spotifyGuide,
	};
})();
