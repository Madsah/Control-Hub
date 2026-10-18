/* Control Panel — Round 8B: sound, Discord and Spotify.
 * Discord: per-person volume (tap someone in the Discord tile), join a favourite voice channel.
 * Push-to-talk (hold a key from the panel), sound profiles, mic test.
 * Spotify: big now-playing tile/page, search with an on-screen keyboard, recently played, save the song to a playlist.
 * Needs Control Hub 2.2.0 or newer for the new parts; older helpers get a short "update the helper" note. */

var Round8b = (function () {
	var el = U.el, svg = U.svg, esc = U.esc, setText = U.setText, setHtml = U.setHtml;
	var types = T.types, helperGate = T.helperGate;

	function L() { return Editor.layout(); }
	function O() { var l = L(); return l.opts || (l.opts = {}); }

	/* ------------------------------------------------------------------ helper version */
	function verNum(v) {
		var p = String(v || "0").split(".");
		return (+p[0] || 0) * 10000 + (+p[1] || 0) * 100 + (+p[2] || 0);
	}
	function helperNew() {
		var v = Helper.state.version;
		return !v || v === "mock" || verNum(v) >= verNum("2.2.0");
	}
	var OLD_HELPER = "<b>Update the helper</b><span>Run Build Helper.bat once (helper 2.2.0) for this.</span>";
	/* Shows a note instead of the tile while the helper is too old. Returns true when the tile should stop there. */
	function gate(ctx, state) {
		if (helperGate(ctx) === true) { state.built = false; return true; }
		if (!helperNew()) {
			if (state.built !== "old") { ctx.body.innerHTML = '<div class="notice small">' + OLD_HELPER + "</div>"; state.built = "old"; }
			return true;
		}
		if (state.built === "old") state.built = false;
		return false;
	}

	/* ================================================================== on-screen keyboard */
	var KB_ROWS = [
		["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
		["q", "w", "e", "r", "t", "y", "u", "i", "o", "p", "å"],
		["a", "s", "d", "f", "g", "h", "j", "k", "l", "æ", "ø"],
		["z", "x", "c", "v", "b", "n", "m", "-", "'", "&"],
	];
	/* A touch keyboard for the Edge (Windows' own keyboard doesn't open in iCUE).
	   input: a real <input> (a PC keyboard works too). onType(text) after each key, onEnter(text) on the big key. */
	function keyboard(input, onType, onEnter, enterLabel) {
		var kb = el("div", "osk");
		var shift = false;
		function draw() {
			kb.innerHTML = "";
			KB_ROWS.forEach(function (row, ri) {
				var r = el("div", "osk-row");
				if (ri === 3) {
					var sh = el("button", "osk-k osk-wide osk-shift" + (shift ? " on" : ""), "⇧");
					sh.dataset.k = "shift";
					r.appendChild(sh);
				}
				row.forEach(function (k) {
					var b = el("button", "osk-k");
					b.textContent = shift ? k.toUpperCase() : k;
					b.dataset.k = shift ? k.toUpperCase() : k;
					r.appendChild(b);
				});
				if (ri === 0) {
					var bs = el("button", "osk-k osk-wide", svg("backspace"));
					bs.dataset.k = "back";
					r.appendChild(bs);
				}
				kb.appendChild(r);
			});
			var last = el("div", "osk-row");
			last.innerHTML = '<button class="osk-k osk-wide" data-k="clear">Clear</button><button class="osk-k osk-space" data-k=" ">space</button>' +
				(input.tagName === "TEXTAREA" ? '<button class="osk-k osk-wide" data-k="newline">New line</button>' : "") +
				'<button class="osk-k osk-wide" data-k=",">,</button><button class="osk-k osk-wide" data-k=".">.</button><button class="osk-k osk-go" data-k="enter"></button>';
			last.querySelector(".osk-go").textContent = enterLabel || "Search";
			kb.appendChild(last);
		}
		draw();
		var repeatT = null;
		function press(k) {
			var v = input.value;
			if (k === "back") v = v.slice(0, -1);
			else if (k === "clear") v = "";
			else if (k === "shift") { shift = !shift; draw(); return; }
			else if (k === "newline") v += "\n";
			else if (k === "enter") { if (onEnter) onEnter(v); return; }
			else {
				if (v.length >= (+input.maxLength > 0 ? +input.maxLength : 80)) return;
				v += k;
				if (shift) { shift = false; draw(); }
			}
			input.value = v;
			if (onType) onType(v);
		}
		kb.addEventListener("pointerdown", function (e) {
			var b = e.target.closest("[data-k]");
			if (!b) return;
			e.preventDefault();
			e.stopPropagation();
			b.classList.add("down");
			var k = b.dataset.k;
			press(k);
			clearTimeout(repeatT);
			if (k === "back") {
				// Hold backspace to delete faster.
				repeatT = setTimeout(function rep() { press("back"); repeatT = setTimeout(rep, 70); }, 450);
			}
		});
		function up() {
			clearTimeout(repeatT);
			kb.querySelectorAll(".down").forEach(function (b) { b.classList.remove("down"); });
		}
		["pointerup", "pointercancel", "pointerleave"].forEach(function (n) { kb.addEventListener(n, up); });
		kb.addEventListener("click", function (e) { e.stopPropagation(); });
		input.setAttribute("inputmode", "none"); // no Windows touch keyboard on top of ours
		input.addEventListener("input", function () { if (onType) onType(input.value); });
		input.addEventListener("keydown", function (e) { if (e.key === "Enter" && onEnter) onEnter(input.value); });
		return kb;
	}

	/* ================================================================== Discord */
	var dcGuilds = null, dcChannels = {};

	function dcAct(body) {
		body.action = "discord";
		return Helper.act(body, true);
	}

	function avatarHtml(m, size) {
		var letter = esc((m.name || "?").charAt(0).toUpperCase());
		var url = m.avatar ? "https://cdn.discordapp.com/avatars/" + encodeURIComponent(m.id) + "/" + encodeURIComponent(m.avatar) + ".png?size=" + (size || 128) : "";
		return '<span class="dcp-av"><b>' + letter + "</b>" + (url ? '<img alt="" src="' + esc(url) + '" onerror="this.remove()" />' : "") + "</span>";
	}

	/* Tap a person in the Discord tile: their volume (0–200 %) and mute, only for you. */
	function person(id, getState) {
		function member() {
			var s = getState();
			return ((s && s.members) || []).filter(function (m) { return m.id === id; })[0];
		}
		var m = member();
		if (!m) return;
		var wrap = el("div", "dcp");
		Editor.modal(m.name || "Discord", wrap);
		if (m.me) {
			wrap.innerHTML = avatarHtml(m) + '<p class="hint">That\'s you. Mute or deafen yourself here, or tap someone else to change how loud they are.</p><div class="dcp-me"><button class="pill big" data-w="mute"></button><button class="pill big" data-w="deaf"></button></div>';
			function meBtns() {
				var s = getState() || {};
				setHtml(wrap.querySelector('[data-w="mute"]'), svg(s.mute ? "micOff" : "mic") + "<span>" + (s.mute ? "Unmute" : "Mute") + "</span>");
				setHtml(wrap.querySelector('[data-w="deaf"]'), svg(s.deaf ? "speakerOff" : "headset") + "<span>" + (s.deaf ? "Undeafen" : "Deafen") + "</span>");
			}
			meBtns();
			wrap.querySelectorAll("[data-w]").forEach(function (b) {
				b.addEventListener("click", function () {
					var s = getState() || {};
					var w = b.dataset.w;
					if (w === "mute") s.mute = !s.mute;
					else { s.deaf = !s.deaf; if (s.deaf) s.mute = true; }
					meBtns();
					App.dirty();
					dcAct({ what: w });
				});
			});
			return;
		}
		if (m.vol == null) {
			wrap.innerHTML = avatarHtml(m) + '<div class="notice small">' + OLD_HELPER + "</div>";
			return;
		}
		wrap.innerHTML = avatarHtml(m) +
			'<div class="dcp-row"><span class="dcp-lbl">' + svg("speaker") + "<b>Volume for you</b></span><b class=\"dcp-v\"></b></div>" +
			'<div class="dcp-sl"></div>' +
			'<div class="chips dcp-chips"></div>' +
			'<button class="opt-toggle dcp-mute"><span class="switch"><i></i></span><span>Mute this person for me</span></button>' +
			'<p class="hint">Only you hear the change, like right-clicking them in Discord. 100% is normal.</p>';
		var vEl = wrap.querySelector(".dcp-v"), muteB = wrap.querySelector(".dcp-mute"), chips = wrap.querySelector(".dcp-chips");
		var lastSent = 0, pend = null;
		function send(v, final) {
			clearTimeout(pend);
			var now = Date.now();
			if (!final && now - lastSent < 220) { pend = setTimeout(function () { send(v, true); }, 220); return; }
			lastSent = now;
			dcAct({ what: "user", id: id, volume: v }).then(function (ok) { if (!ok && final) U.toast("Discord didn't change it"); });
		}
		var sl = T.slider(wrap.querySelector(".dcp-sl"), function (v, final) {
			var vol = v * 2, mm = member();
			if (mm) mm.vol = vol;
			show();
			send(vol, final);
			App.dirty();
		});
		[0, 50, 100, 150, 200].forEach(function (v) {
			var c = el("button", "chip", v + "%");
			c.addEventListener("click", function () {
				var mm = member();
				if (mm) mm.vol = v;
				show();
				send(v, true);
				App.dirty();
			});
			chips.appendChild(c);
		});
		muteB.addEventListener("click", function () {
			var mm = member();
			if (!mm) return;
			mm.lmute = !mm.lmute;
			show();
			App.dirty();
			dcAct({ what: "user", id: id, mute: !!mm.lmute }).then(function (ok) { if (!ok) U.toast("Discord didn't change it"); });
		});
		function show() {
			var mm = member() || m;
			var v = mm.vol == null ? 100 : mm.vol;
			setText(vEl, v + "%");
			sl.set(v / 2);
			muteB.classList.toggle("on", !!mm.lmute);
			chips.querySelectorAll(".chip").forEach(function (c) { c.classList.toggle("on", c.textContent === v + "%"); });
			wrap.classList.toggle("muted", !!mm.lmute);
		}
		show();
	}

	/* Pick a voice channel: your servers → their voice channels. onPick({id, name, guild}). */
	function pickChannel(onPick, back) {
		var wrap = el("div", "dc-pick");
		Editor.modal("Pick a voice channel", wrap, back);
		if (!Helper.online) { wrap.innerHTML = '<div class="notice small"><span>Start Control Hub first</span></div>'; return; }
		if (!helperNew()) { wrap.innerHTML = '<div class="notice small">' + OLD_HELPER + "</div>"; return; }
		function guilds() {
			wrap.innerHTML = '<p class="hint">Loading your servers…</p>';
			var p = dcGuilds ? Promise.resolve(dcGuilds) : Helper.fetch("/api/discord/guilds", { cache: "no-store" }, 12000).then(function (r) {
				if (!r || !r.ok) throw new Error("no");
				return (dcGuilds = r.items || []);
			});
			p.then(function (list) {
				wrap.innerHTML = "";
				var g = el("div", "pick-grid");
				list.forEach(function (gd) {
					var b = el("button", "pick", '<span class="logo pick-logo dc-gic"></span><span class="pick-tx"><b></b><em>Server</em></span>');
					b.querySelector("b").textContent = gd.name;
					var ic = b.querySelector(".dc-gic");
					ic.textContent = (gd.name || "?").charAt(0).toUpperCase();
					if (gd.icon && /^https:\/\//.test(gd.icon)) { var img = new Image(); img.alt = ""; img.onload = function () { ic.textContent = ""; ic.appendChild(img); }; img.src = gd.icon; }
					b.addEventListener("click", function () { channels(gd); });
					g.appendChild(b);
				});
				if (!list.length) g.appendChild(el("p", "hint", "No servers found."));
				wrap.appendChild(g);
			}, function () {
				wrap.innerHTML = '<div class="notice small"><b>Discord isn\'t connected</b><span>Open Discord and check the Discord tile.</span></div>';
			});
		}
		function channels(gd) {
			wrap.innerHTML = '<p class="hint">Loading voice channels…</p>';
			var p = dcChannels[gd.id] ? Promise.resolve(dcChannels[gd.id]) : Helper.fetch("/api/discord/channels?guild=" + encodeURIComponent(gd.id), { cache: "no-store" }, 12000).then(function (r) {
				if (!r || !r.ok) throw new Error("no");
				return (dcChannels[gd.id] = r.items || []);
			});
			p.then(function (list) {
				wrap.innerHTML = "";
				var backB = el("button", "pill", svg("back") + "<span>All servers</span>");
				backB.addEventListener("click", guilds);
				wrap.appendChild(backB);
				var ol = el("div", "opt-list");
				list.forEach(function (c) {
					var b = el("button", "opt-row", '<span class="src-check">' + svg("speaker") + "</span><span><b></b><em></em></span>");
					b.querySelector("b").textContent = c.name;
					b.querySelector("em").textContent = gd.name;
					b.addEventListener("click", function () { onPick({ id: c.id, name: c.name, guild: gd.name }); });
					ol.appendChild(b);
				});
				if (!list.length) ol.appendChild(el("p", "hint", "No voice channels you can see on this server."));
				wrap.appendChild(ol);
			}, function () { wrap.innerHTML = '<div class="notice small"><span>Couldn\'t load the channels</span></div>'; });
		}
		guilds();
	}

	function joinChannel(ch) {
		if (!ch || !ch.id) return Promise.resolve(false);
		return dcAct({ what: "join", channel: ch.id }).then(function (ok) {
			U.toast(ok ? "Joining " + ch.name : "Discord didn't join (is it open and connected?)");
			return ok;
		});
	}

	/* Called by the Discord tile: the "join" button while you aren't in a call. */
	function discordIdle(ctx, box, s) {
		var fav = (ctx.tile.cfg || {}).fav;
		var key = fav ? fav.id + fav.name : "none";
		if (box.__k === key) return;
		box.__k = key;
		box.innerHTML = fav
			? '<button class="pill accent dc-joinb">' + svg("speaker") + "<span>Join " + esc(fav.name) + "</span></button>"
			: '<button class="pill dc-joinb">' + svg("plus") + "<span>Pick a favourite channel</span></button>";
		box.querySelector(".dc-joinb").addEventListener("click", function (e) {
			e.stopPropagation();
			if (App.editing) return;
			var f = (ctx.tile.cfg || {}).fav;
			if (f) joinChannel(f);
			else pickChannel(function (ch) {
				ctx.tile.cfg = ctx.tile.cfg || {};
				ctx.tile.cfg.fav = ch;
				Editor.save();
				Editor.closeModal();
				box.__k = null;
				App.dirty();
			});
		});
	}

	// The Discord tile's ✏ settings: its favourite channel.
	if (types.discord) types.discord.edit = function (t, back) {
		var wrap = el("div", "opts");
		Editor.modal("Discord settings", wrap, back);
		function draw() {
			var fav = (t.cfg || {}).fav;
			wrap.innerHTML = '<div class="opt"><h4>Favourite voice channel</h4><p class="hint">A Join button shows on the tile when you\'re not in a call.</p><div class="chips"></div></div>';
			var c = wrap.querySelector(".chips");
			var pick = el("button", "chip" + (fav ? " on" : ""), esc(fav ? fav.name + (fav.guild ? " · " + fav.guild : "") : "Pick a channel"));
			pick.addEventListener("click", function () {
				pickChannel(function (ch) { t.cfg = t.cfg || {}; t.cfg.fav = ch; Editor.saveTile(t, function () { types.discord.edit(t, back); }); });
			});
			c.appendChild(pick);
			if (fav) {
				var rm = el("button", "chip", "None");
				rm.addEventListener("click", function () { delete t.cfg.fav; Editor.save(); draw(); });
				c.appendChild(rm);
			}
			var ok = el("button", "pill accent save-btn", "Done");
			ok.addEventListener("click", function () { Editor.saveTile(t, back); });
			wrap.appendChild(ok);
		}
		draw();
	};

	/* ------------------------------------------------------------------ a "join this channel" button tile */
	types.dcjoin = {
		name: "Discord channel", desc: "Join your favourite voice channel with one tap", icon: "chat", group: "pc", helper: true,
		w: 2, h: 1, minW: 1, minH: 1, maxW: 4, maxH: 2,
		edit: function (t, back) {
			pickChannel(function (ch) { t.cfg = { ch: ch }; Editor.saveTile(t, back); }, back);
		},
		build: function (ctx) {
			var st = { built: false };
			ctx.node.classList.add("press");
			ctx.node.addEventListener("click", function () {
				if (App.editing) return;
				var ch = (ctx.tile.cfg || {}).ch;
				if (!ch) return Editor.edit(ctx.tile);
				joinChannel(ch);
			});
			return function () {
				if (gate(ctx, st)) return;
				var ch = (ctx.tile.cfg || {}).ch;
				if (!st.built) {
					ctx.body.innerHTML = '<div class="dcj"><span class="dcj-ic">' + svg("speaker") + '</span><span class="dcj-tx"><b></b><em></em></span></div>';
					st.built = true;
				}
				setText(ctx.body.querySelector(".dcj-tx b"), ch ? ch.name : "Pick a channel");
				setText(ctx.body.querySelector(".dcj-tx em"), ch ? "Join · " + (ch.guild || "Discord") : "Tap to choose");
			};
		},
	};

	/* ================================================================== push-to-talk */
	var PTT_KEYS = ["Mouse4", "Mouse5", "CapsLock", "`", "V", "T", "B", "F13", "F14", "F15", "F16", "F17", "F18", "F19", "F20", "Num0", "Insert", "Home", "End", "PageUp", "PageDown", "Pause", "ScrollLock"];
	var ptt = { combo: null, beat: null, tile: null };

	function pttDown(combo, tileNode) {
		if (!combo) return;
		if (ptt.combo && ptt.combo !== combo) pttUp();
		ptt.combo = combo;
		ptt.tile = tileNode;
		Helper.act({ action: "hold", combo: combo, down: true }, true).then(function (ok) { if (!ok && ptt.combo === combo) { U.toast("Control Hub didn't accept that key"); pttUp(); } });
		clearInterval(ptt.beat);
		// "Still holding" every second; if this stops, the helper lets go by itself after 3 s.
		ptt.beat = setInterval(function () {
			if (!ptt.combo) return clearInterval(ptt.beat);
			Helper.act({ action: "hold", combo: ptt.combo, down: true }, true);
		}, 1000);
		document.body.classList.add("ptt-live");
	}
	function pttUp() {
		clearInterval(ptt.beat);
		var c = ptt.combo;
		ptt.combo = null;
		if (ptt.tile) ptt.tile.classList.remove("talking");
		ptt.tile = null;
		document.body.classList.remove("ptt-live");
		if (c) Helper.act({ action: "hold", combo: c, down: false }, true);
	}
	window.addEventListener("blur", function () { if (ptt.combo) pttUp(); });
	document.addEventListener("visibilitychange", function () { if (document.hidden && ptt.combo) pttUp(); });

	types.ptt = {
		name: "Push to talk", desc: "Hold to talk in Discord, SRS, games… (holds a key for you)", icon: "talk", group: "media", helper: true,
		w: 2, h: 2, minW: 1, minH: 1, maxW: 4, maxH: 4, ownHold: true,
		defaults: function () { return { combo: "", mode: "hold", label: "" }; },
		edit: function (t, back) { pttSettings(t, back); },
		build: function (ctx) {
			var st = { built: false }, latched = false, latchT = null;
			var cfg = function () { return ctx.tile.cfg || {}; };
			function start(e) {
				if (App.editing || !Helper.online || !helperNew()) return;
				var c = cfg();
				if (!c.combo) return;
				if (e) { e.stopPropagation(); try { ctx.node.setPointerCapture(e.pointerId); } catch (x) {} }
				if (c.mode === "toggle") {
					latched = !latched;
					clearTimeout(latchT);
					if (latched) {
						pttDown(c.combo, ctx.node);
						ctx.node.classList.add("talking");
						// Safety: a forgotten "on" turns itself off after 10 minutes.
						latchT = setTimeout(function () { latched = false; pttUp(); App.dirty(); }, 600000);
					} else pttUp();
					return;
				}
				pttDown(c.combo, ctx.node);
				ctx.node.classList.add("talking");
			}
			function stop() {
				if (cfg().mode === "toggle") return;
				if (ptt.tile === ctx.node) pttUp();
			}
			ctx.node.addEventListener("pointerdown", start);
			["pointerup", "pointercancel", "lostpointercapture"].forEach(function (n) { ctx.node.addEventListener(n, stop); });
			ctx.node.addEventListener("click", function (e) {
				if (App.editing) return;
				e.stopPropagation();
				if (!cfg().combo && Helper.online) Editor.edit(ctx.tile);
			});
			ctx.node.addEventListener("contextmenu", function (e) { e.preventDefault(); });
			return function () {
				if (gate(ctx, st)) return;
				if (!st.built) {
					ctx.body.innerHTML = '<div class="ptt"><span class="ptt-ring">' + svg("talk") + '</span><b class="ptt-l"></b><em class="ptt-k"></em></div>';
					st.built = true;
				}
				var c = cfg();
				var talking = ptt.tile === ctx.node && !!ptt.combo;
				if (!talking && latched) latched = false;
				ctx.node.classList.toggle("talking", talking);
				ctx.node.classList.toggle("ptt-unset", !c.combo);
				setText(ctx.body.querySelector(".ptt-l"), talking ? "Talking" : c.label || (c.mode === "toggle" ? "Tap to talk" : "Hold to talk"));
				setText(ctx.body.querySelector(".ptt-k"), c.combo ? keyLabel(c.combo) : "Tap to pick a key");
			};
		},
	};

	function keyLabel(k) {
		return String(k).replace(/^Mouse4$/i, "Mouse button 4").replace(/^Mouse5$/i, "Mouse button 5").replace(/\+/g, " + ");
	}

	function pttSettings(t, back) {
		var work = JSON.parse(JSON.stringify(t.cfg || {}));
		if (!work.mode) work.mode = "hold";
		var mods = { Ctrl: false, Shift: false, Alt: false };
		var key = "";
		String(work.combo || "").split("+").forEach(function (p) { if (mods.hasOwnProperty(p)) mods[p] = true; else if (p) key = p; });
		var wrap = el("div", "opts ptt-set");
		Editor.modal("Push to talk", wrap, back);
		function combo() {
			if (/^mouse[45]$/i.test(key)) return key;
			var out = Object.keys(mods).filter(function (m) { return mods[m]; });
			if (key) out.push(key);
			return out.join("+");
		}
		function draw() {
			work.combo = combo();
			wrap.innerHTML = "";
			var pv = el("div", "key-preview");
			pv.textContent = work.combo ? keyLabel(work.combo) : "Pick the key you use for push-to-talk";
			wrap.appendChild(pv);
			var how = el("div", "opt", "<h4>How</h4>");
			var hc = el("div", "chips");
			[["hold", "Hold to talk"], ["toggle", "Tap on, tap off"]].forEach(function (m) {
				var b = el("button", "chip" + (work.mode === m[0] ? " on" : ""), esc(m[1]));
				b.addEventListener("click", function () { work.mode = m[0]; draw(); });
				hc.appendChild(b);
			});
			how.appendChild(hc);
			wrap.appendChild(how);
			var ks = el("div", "opt", "<h4>Key (the same as your push-to-talk key in Discord, SRS or the game)</h4>");
			var kc = el("div", "chips");
			PTT_KEYS.concat("ABCDEFGHIJKLMNOPQRSUWXYZ".split("")).forEach(function (k) {
				var b = el("button", "chip" + (key === k ? " on" : ""), esc(keyLabel(k)));
				b.addEventListener("click", function () { key = k; draw(); });
				kc.appendChild(b);
			});
			ks.appendChild(kc);
			wrap.appendChild(ks);
			if (!/^mouse[45]$/i.test(key)) {
				var ms = el("div", "opt", "<h4>Together with</h4>");
				var mc = el("div", "chips");
				Object.keys(mods).forEach(function (m) {
					var b = el("button", "chip" + (mods[m] ? " on" : ""), esc(m));
					b.addEventListener("click", function () { mods[m] = !mods[m]; draw(); });
					mc.appendChild(b);
				});
				ms.appendChild(mc);
				wrap.appendChild(ms);
			}
			var ls = el("div", "opt", "<h4>Name on the tile</h4>");
			var lc = el("div", "chips");
			[["", "Automatic"], ["Discord", "Discord"], ["SRS", "SRS (DCS)"], ["Radio", "Radio"], ["Team", "Team"], ["ATC", "ATC"]].forEach(function (n) {
				var b = el("button", "chip" + ((work.label || "") === n[0] ? " on" : ""), esc(n[1]));
				b.addEventListener("click", function () { work.label = n[0]; draw(); });
				lc.appendChild(b);
			});
			ls.appendChild(lc);
			wrap.appendChild(ls);
			wrap.appendChild(el("p", "hint", "Tip: an unused key like F13 or Mouse button 5 works best, so nothing else reacts. If you let go of the screen, the key is let go too — and Control Hub lets go by itself if the panel stops answering."));
			var ok = el("button", "pill accent save-btn", "Save");
			ok.disabled = !work.combo;
			ok.addEventListener("click", function () { t.cfg = work; Editor.saveTile(t, back); });
			wrap.appendChild(ok);
		}
		draw();
	}

	/* ================================================================== sound profiles */
	function profiles() { var o = O(); return o.soundProfiles || (o.soundProfiles = []); }
	function profileById(id) { return profiles().filter(function (p) { return p.id === id; })[0]; }

	function captureNow(p) {
		var out = T.endpointFor(false, ""), inp = T.endpointFor(true, "");
		p.out = out ? { id: out.id, name: out.name, volume: out.volume } : null;
		p.inp = inp ? { id: inp.id, name: inp.name, volume: inp.volume } : null;
		p.apps = (Helper.state.mixer || []).map(function (a) { return { key: a.key, name: a.name, volume: a.volume }; });
		var sp = Round6.spotify.data, pl = sp && sp.player;
		p.spotify = pl && pl.volume != null ? pl.volume : null;
		return p;
	}

	function applyProfile(p) {
		if (!p) return Promise.resolve();
		if (!Helper.online) { U.toast("Start Control Hub first"); return Promise.resolve(); }
		var inc = p.use || {};
		var steps = [];
		if (inc.out !== false && p.out) {
			steps.push({ action: "setDefaultDevice", mic: false, device: p.out.id });
			if (inc.outVol !== false && p.out.volume != null) steps.push({ action: "speakersVolume", device: p.out.id, value: p.out.volume });
		}
		if (inc.inp !== false && p.inp) {
			steps.push({ action: "setDefaultDevice", mic: true, device: p.inp.id });
			if (inc.inVol !== false && p.inp.volume != null) steps.push({ action: "micVolume", device: p.inp.id, value: p.inp.volume });
		}
		if (inc.apps !== false) (p.apps || []).forEach(function (a) { if (a.on !== false) steps.push({ action: "appVolume", key: a.key, value: a.volume }); });
		if (inc.spotify !== false && p.spotify != null) steps.push({ action: "spotify", what: "volume", value: p.spotify });
		Helper.hold("outputs", 2500);
		Helper.hold("mixer", 2500);
		var chain = Promise.resolve();
		steps.forEach(function (b) { chain = chain.then(function () { return Helper.act(b, true); }).then(null, function () {}); });
		O().soundActive = p.id;
		Editor.save();
		App.dirty();
		U.toast("Sound: " + p.name);
		return chain.then(function () { setTimeout(Helper.poll, 200); });
	}

	var PROFILE_NAMES = ["Gaming", "Flying", "Music", "Calls", "Night", "Speakers", "Headset", "Movie"];
	var PROFILE_ICONS = ["headset", "speaker", "plane", "gamepad", "music", "chat", "moon", "mic"];

	function profileEditor(p, onDone, back) {
		var isNew = !p;
		var work = p ? JSON.parse(JSON.stringify(p)) : captureNow({ id: "sp" + Date.now().toString(36), name: "", icon: "headset", use: {} });
		if (!work.use) work.use = {};
		var wrap = el("div", "opts sp-prof");
		Editor.modal(isNew ? "New sound profile" : "Sound profile", wrap, back);
		function toggle(sec, key, label) {
			var on = work.use[key] !== false;
			var b = el("button", "opt-toggle" + (on ? " on" : ""), '<span class="switch"><i></i></span><span>' + esc(label) + "</span>");
			b.addEventListener("click", function () { work.use[key] = !on; draw(); });
			sec.appendChild(b);
			return on;
		}
		function volSlider(sec, obj, key) {
			var row = el("div", "spf-vol", "<b></b>");
			var lbl = row.querySelector("b");
			var sl = T.slider(row, function (v) { obj[key] = v; lbl.textContent = v + "%"; });
			sl.set(obj[key] || 0);
			lbl.textContent = (obj[key] || 0) + "%";
			sec.appendChild(row);
		}
		function draw() {
			var keepTop = wrap.parentNode ? wrap.parentNode.scrollTop : 0;
			wrap.innerHTML = "";
			// name + icon
			var ns = el("div", "opt", "<h4>Name</h4>");
			var nc = el("div", "chips");
			PROFILE_NAMES.forEach(function (n) {
				var b = el("button", "chip" + (work.name === n ? " on" : ""), esc(n));
				b.addEventListener("click", function () { work.name = n; draw(); });
				nc.appendChild(b);
			});
			var own = el("button", "chip" + (work.name && PROFILE_NAMES.indexOf(work.name) < 0 ? " on" : ""), svg("keyboard") + "<span>" + esc(work.name && PROFILE_NAMES.indexOf(work.name) < 0 ? work.name : "Type a name") + "</span>");
			own.addEventListener("click", function () {
				typeText("Profile name", work.name || "", function (v) {
					work.name = v.trim().slice(0, 20);
					reopen();
				});
			});
			nc.appendChild(own);
			ns.appendChild(nc);
			var ic = el("div", "chips spf-icons");
			PROFILE_ICONS.forEach(function (n) {
				var b = el("button", "chip" + (work.icon === n ? " on" : ""), svg(n));
				b.addEventListener("click", function () { work.icon = n; draw(); });
				ic.appendChild(b);
			});
			ns.appendChild(ic);
			wrap.appendChild(ns);
			// output
			var os = el("div", "opt", "<h4>Output</h4>");
			if (work.out) {
				if (toggle(os, "out", "Switch to " + work.out.name)) {
					if (toggle(os, "outVol", "Set its volume")) volSlider(os, work.out, "volume");
				}
			} else os.appendChild(el("p", "hint", "No output found."));
			wrap.appendChild(os);
			// mic
			var is = el("div", "opt", "<h4>Microphone</h4>");
			if (work.inp) {
				if (toggle(is, "inp", "Switch to " + work.inp.name)) {
					if (toggle(is, "inVol", "Set its volume")) volSlider(is, work.inp, "volume");
				}
			} else is.appendChild(el("p", "hint", "No microphone found."));
			wrap.appendChild(is);
			// apps
			var as = el("div", "opt", "<h4>App volumes</h4>");
			if ((work.apps || []).length) {
				if (toggle(as, "apps", "Set app volumes")) {
					work.apps.forEach(function (a) {
						var on = a.on !== false;
						var b = el("button", "opt-toggle" + (on ? " on" : ""), '<span class="switch"><i></i></span><span></span>');
						b.lastChild.textContent = a.name;
						b.addEventListener("click", function () { a.on = !on; draw(); });
						as.appendChild(b);
						if (on) volSlider(as, a, "volume");
					});
				}
			} else as.appendChild(el("p", "hint", "No apps were playing sound when this was made."));
			wrap.appendChild(as);
			// spotify
			if (work.spotify != null) {
				var ss = el("div", "opt", "<h4>Spotify</h4>");
				if (toggle(ss, "spotify", "Set Spotify's volume")) volSlider(ss, work, "spotify");
				wrap.appendChild(ss);
			}
			var again = el("button", "pill", svg("restart") + "<span>Use what's on now</span>");
			again.addEventListener("click", function () { captureNow(work); draw(); U.toast("Updated from what's on now"); });
			wrap.appendChild(again);
			var save = el("button", "pill accent save-btn", isNew ? "Save profile" : "Save");
			save.disabled = !work.name;
			save.addEventListener("click", function () {
				var list = profiles();
				var i = list.map(function (x) { return x.id; }).indexOf(work.id);
				if (i >= 0) list[i] = work; else list.push(work);
				Editor.save();
				App.dirty();
				if (onDone) onDone(work); else Editor.closeModal();
			});
			wrap.appendChild(save);
			if (wrap.parentNode) wrap.parentNode.scrollTop = keepTop;
		}
		function reopen() {
			Editor.modal(isNew ? "New sound profile" : "Sound profile", wrap, back);
			draw();
		}
		draw();
	}

	/* A small window with the on-screen keyboard to type a short text. */
	function typeText(title, value, onDone) {
		var w = el("div", "osk-wrap");
		var inp = el("input", "search osk-in");
		inp.value = value || "";
		w.appendChild(inp);
		w.appendChild(keyboard(inp, null, function (v) { onDone(v); }, "Done"));
		Editor.modal(title, w);
	}

	function profileManager(t, back) {
		var wrap = el("div", "opts");
		Editor.modal("Sound profiles", wrap, back);
		var me = function () { profileManager(t, back); };
		var list = profiles();
		var ol = el("div", "opt-list");
		list.forEach(function (p, i) {
			var r = el("div", "opt-row tpl-row", '<span class="src-check">' + svg(p.icon || "headset") + "</span><span><b></b><em></em></span>");
			r.querySelector("b").textContent = p.name;
			r.querySelector("em").textContent = [p.use && p.use.out === false ? "" : p.out && p.out.name, p.use && p.use.inp === false ? "" : p.inp && p.inp.name].filter(Boolean).join(" · ");
			r.addEventListener("click", function (e) { if (!e.target.closest(".tpl-del")) profileEditor(p, me, me); });
			var x = el("button", "ch-mini danger tpl-del", svg("x"));
			x.addEventListener("click", function (e) {
				e.stopPropagation();
				Editor.confirm({ title: "Delete " + p.name + "?", text: "The profile is removed from all tiles and buttons.", ok: "Delete", icon: "x", danger: true }, function () {
					list.splice(i, 1);
					Editor.save();
					App.dirty();
					me();
				});
			});
			r.appendChild(x);
			ol.appendChild(r);
		});
		if (!list.length) ol.appendChild(el("p", "hint", "No profiles yet. Set up your sound the way you like it (output, mic, app volumes), then tap New profile."));
		wrap.appendChild(ol);
		var add = el("button", "pill accent", svg("plus") + "<span>New profile from what's on now</span>");
		add.addEventListener("click", function () {
			if (!Helper.online) return U.toast("Start Control Hub first");
			profileEditor(null, me, me);
		});
		wrap.appendChild(add);
		if (t) {
			var ok = el("button", "pill save-btn", "Done");
			ok.addEventListener("click", function () { Editor.saveTile(t, back); });
			wrap.appendChild(ok);
		}
	}

	types.soundprof = {
		name: "Sound profiles", desc: "One tap: output, mic and app volumes the way you saved them", icon: "mixer", group: "media", helper: true, parts: ["audio", "mixer"],
		w: 3, h: 1, minW: 1, minH: 1, maxW: 8, maxH: 4,
		edit: function (t, back) { profileManager(t, back); },
		build: function (ctx) {
			var st = { built: false }, box, shown = "";
			return function () {
				if (helperGate(ctx) === true) { st.built = false; return; }
				if (!st.built) {
					ctx.body.innerHTML = '<div class="spf"></div>';
					box = ctx.body.querySelector(".spf");
					box.addEventListener("click", function (e) {
						if (App.editing) return;
						e.stopPropagation();
						if (e.target.closest(".spf-new")) return profileManager(null, null);
						var b = e.target.closest("[data-id]");
						if (b) applyProfile(profileById(b.dataset.id));
					});
					st.built = true;
					shown = "";
				}
				var list = profiles(), active = O().soundActive;
				var key = JSON.stringify([list.map(function (p) { return [p.id, p.name, p.icon]; }), active, ctx.w, ctx.h]);
				if (key === shown) return;
				shown = key;
				box.classList.toggle("one", ctx.w === 1 && ctx.h === 1);
				if (!list.length) return setHtml(box, '<button class="spf-new">' + svg("plus") + "<span>Make a sound profile</span></button>");
				setHtml(box, list.map(function (p) {
					return '<button class="spf-b' + (p.id === active ? " on" : "") + '" data-id="' + esc(p.id) + '">' + svg(p.icon || "headset") + "<b>" + esc(p.name) + "</b></button>";
				}).join(""));
			};
		},
	};

	/* ================================================================== mic test */
	var mt = { state: null, timer: null, level: 0 };
	function mtPoll() {
		if (mt.timer) return;
		mt.timer = setInterval(function () {
			Helper.fetch("/api/mictest", { cache: "no-store" }, 1500).then(function (r) {
				mt.state = r;
				if (!r || r.phase === "idle") { clearInterval(mt.timer); mt.timer = null; if (r && r.error) U.toast(r.error); }
				App.dirty();
			}, function () {});
			if (mt.state && mt.state.phase === "recording") {
				Helper.fetch("/api/micpeak?device=", { cache: "no-store" }, 800).then(function (r) {
					var p = r.peak || 0;
					mt.level = p > 0 ? U.clamp((20 * Math.log10(p) + 60) / 60, 0, 1) : 0;
					App.dirty();
				}, function () {});
			}
		}, 250);
	}

	types.mictest = {
		name: "Mic test", desc: "Record a few seconds and hear how you sound", icon: "mic", group: "media", helper: true, parts: ["audio"],
		w: 2, h: 1, minW: 1, minH: 1, maxW: 4, maxH: 3,
		defaults: function () { return { secs: 5 }; },
		options: function () {
			return [{ key: "secs", label: "Record for", type: "choice", "default": 5, choices: [{ value: 3, label: "3 seconds" }, { value: 5, label: "5 seconds" }, { value: 10, label: "10 seconds" }] }];
		},
		build: function (ctx) {
			var st = { built: false }, els = {};
			ctx.node.classList.add("press");
			ctx.node.addEventListener("click", function () {
				if (App.editing || !Helper.online || !helperNew()) return;
				var s = mt.state;
				if (s && s.phase !== "idle") {
					Helper.act({ action: "micTest", stop: true }, true);
					return;
				}
				mt.state = { phase: "starting", left: 0 };
				App.dirty();
				Helper.act({ action: "micTest", secs: (ctx.tile.cfg || {}).secs || 5 }, true).then(function (ok) {
					if (!ok) { mt.state = null; U.toast("A mic test is already running"); App.dirty(); }
					mtPoll();
				});
			});
			return function () {
				if (gate(ctx, st)) return;
				if (!st.built) {
					ctx.body.innerHTML = '<div class="mt"><span class="mt-ic"></span><div class="mt-tx"><b></b><em></em></div><div class="mt-bar"><i></i></div></div>';
					["mt-ic", "mt-tx b", "mt-tx em", "mt-bar i"].forEach(function (c) { els[c] = ctx.body.querySelector("." + c); });
					st.built = true;
				}
				var s = mt.state || { phase: "idle" }, ph = s.phase;
				ctx.node.dataset.phase = ph;
				var mic = T.endpointFor(true, "");
				setHtml(els["mt-ic"], svg(ph === "playing" ? "speaker" : "mic"));
				setText(els["mt-tx b"], ph === "recording" ? "Talk now… " + Math.ceil(s.left || 0) : ph === "playing" ? "Listen… " + Math.ceil(s.left || 0) : ph === "starting" ? "Starting…" : "Mic test");
				setText(els["mt-tx em"], ph === "idle" ? "Tap, talk, then hear yourself" + (mic ? " · " + mic.name : "") : "Tap to stop");
				els["mt-bar i"].style.width = ph === "recording" ? Math.round(mt.level * 100) + "%" : "0%";
			};
		},
	};


	/* ================================================================== Spotify */
	var spP = Round6.spotify;
	var plP = Round6.poller("/api/spotify/playlists", 300000, 20000);
	var recP = Round6.poller("/api/spotify/recent", 30000, 15000);
	var quP = Round6.poller("/api/spotify/queue", 10000, 15000);
	var RECONNECT = "Connect Spotify again in Control Hub → Connections to allow this";

	function spMissing(what) {
		var d = spP.data;
		return !!(d && d.missing && d.missing.indexOf(what) >= 0);
	}
	function spAct(body, okText) {
		body.action = "spotify";
		return Helper.act(body, true).then(function (ok) {
			U.toast(ok ? okText || "" : (spP.data && spP.data.error) || "Spotify didn't do that (is Spotify open on a device?)");
			spP.soon();
			quP.soon();
			return ok;
		});
	}
	function playUri(uri, name) { return spAct({ what: "uri", uri: uri }, "Playing " + (name || "")); }
	function queueUri(uri, name) { return spAct({ what: "queue", uri: uri }, "Up next: " + (name || "")); }
	function bg(url) { return url ? 'url("' + String(url).replace(/["\\]/g, "") + '")' : ""; }
	function mmss(ms) {
		var s = Math.max(0, Math.round((ms || 0) / 1000));
		return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2);
	}

	/* ------------------------------------------------------------------ save the song to a playlist */
	function doSave(pl, track) {
		return Helper.fetch("/api/spotify/save", {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-Control-Panel": "1" },
			body: JSON.stringify({ playlist: pl.uri, track: track || "" }),
		}, 12000).then(function (r) {
			U.toast(r && r.ok ? "Saved to " + pl.name : (r && r.error) || "Spotify didn't save it");
			if (r && r.ok) spP.soon();
			return !!(r && r.ok);
		}, function () { U.toast("Control Hub isn't running"); return false; });
	}

	/* One tap saves to your chosen playlist; without one (or with pick = true) you choose. */
	function saveSong(track, pick) {
		if (!helperNew()) return U.toast("Update the helper (Build Helper.bat) for this");
		if (spMissing("save")) return U.toast(RECONNECT);
		var fav = O().spSave;
		if (fav && !pick) return doSave(fav, track);
		pickSavePlaylist(track);
	}

	function pickSavePlaylist(track, onlyChoose) {
		var wrap = el("div", "opts sp-save");
		Editor.modal(onlyChoose ? "One-tap playlist" : "Save to a playlist", wrap);
		var remember = !!O().spSave || !!onlyChoose;
		function draw() {
			var lists = ((plP.data && plP.data.playlists) || []).filter(function (p) { return p.own !== false; });
			wrap.innerHTML = "";
			if (!onlyChoose) {
				var t = el("button", "opt-toggle" + (remember ? " on" : ""), '<span class="switch"><i></i></span><span>Remember it: next time one tap saves there</span>');
				t.addEventListener("click", function () { remember = !remember; if (!remember) { delete O().spSave; Editor.save(); } draw(); });
				wrap.appendChild(t);
			}
			if (!plP.data) { wrap.appendChild(el("p", "hint", "Loading your playlists…")); return; }
			var g = el("div", "pl-grid");
			lists.forEach(function (p) {
				var b = el("button", "pl" + (O().spSave && O().spSave.uri === p.uri ? " on" : ""), '<span class="pl-img"></span><b></b>');
				b.querySelector("b").textContent = p.name;
				if (p.image) b.querySelector(".pl-img").style.backgroundImage = bg(p.image);
				else b.querySelector(".pl-img").innerHTML = svg("heart");
				b.addEventListener("click", function () {
					if (remember) { O().spSave = { uri: p.uri, name: p.name }; Editor.save(); App.dirty(); }
					Editor.closeModal();
					if (!onlyChoose) doSave(p, track);
					else U.toast("One tap now saves to " + p.name);
				});
				g.appendChild(b);
			});
			if (!lists.length) g.appendChild(el("p", "hint", "No playlists of your own yet. Make one in Spotify first."));
			wrap.appendChild(g);
		}
		plP.get(true);
		draw();
		var wait = setInterval(function () { if (plP.data) { clearInterval(wait); if (wrap.isConnected) draw(); } }, 300);
		setTimeout(function () { clearInterval(wait); }, 20000);
	}

	types.spsave = {
		name: "Save song", desc: "Add the song that's playing to your playlist · hold to pick another", icon: "addlist", group: "media", helper: true, ownHold: true,
		w: 2, h: 1, minW: 1, minH: 1, maxW: 4, maxH: 2, tickMs: 3000,
		edit: function (t, back) { pickSavePlaylist(null, true); },
		build: function (ctx) {
			var st = { built: false }, holdT = null, held = false;
			ctx.node.classList.add("press");
			ctx.node.addEventListener("pointerdown", function () {
				held = false;
				clearTimeout(holdT);
				if (App.editing) return;
				holdT = setTimeout(function () { held = true; saveSong(null, true); }, 700);
			});
			["pointerup", "pointercancel", "pointerleave"].forEach(function (n) { ctx.node.addEventListener(n, function () { clearTimeout(holdT); }); });
			ctx.node.addEventListener("click", function () {
				if (App.editing) return;
				if (held) { held = false; return; }
				saveSong(null, false);
			});
			return function () {
				if (gate(ctx, st)) return;
				if (!st.built) {
					ctx.body.innerHTML = '<div class="sps1"><span class="sps1-ic">' + svg("addlist") + '</span><span class="sps1-tx"><b></b><em></em></span></div>';
					st.built = true;
				}
				var s = spP.get(), p = s && s.player, fav = O().spSave;
				setText(ctx.body.querySelector(".sps1-tx b"), fav ? "Save to " + fav.name : "Save to a playlist");
				setText(ctx.body.querySelector(".sps1-tx em"), s && !s.connected ? "Connect Spotify first" : p && p.title ? p.title + " · " + p.artist : "Nothing playing");
			};
		},
	};

	/* ------------------------------------------------------------------ search with the on-screen keyboard */
	var lastQ = "", lastRes = null;
	function resultRow(it, kind) {
		var r = el("div", "spr-row");
		r.dataset.uri = it.uri;
		r.__it = it;
		r.innerHTML = '<span class="spr-art' + (kind === "artists" ? " round" : "") + '"></span><span class="spr-tx"><b></b><em></em></span><span class="spr-btns">' +
			(kind === "tracks" ? '<button data-a="queue" aria-label="Play next">' + svg("list") + '</button><button data-a="save" aria-label="Save to a playlist">' + svg("addlist") + "</button>" : "") +
			'<button data-a="play" class="spr-play" aria-label="Play">' + svg("play") + "</button></span>";
		if (it.image) r.querySelector(".spr-art").style.backgroundImage = bg(it.image);
		else r.querySelector(".spr-art").innerHTML = svg("music");
		r.querySelector("b").textContent = it.title || "";
		var sub = { tracks: it.artist + (it.ms ? " · " + mmss(it.ms) : ""), artists: "Artist", albums: "Album · " + it.artist, playlists: "Playlist" + (it.artist ? " · " + it.artist : "") }[kind] || it.artist || "";
		r.querySelector("em").textContent = sub;
		return r;
	}
	function onResultClick(e) {
		var r = e.target.closest(".spr-row");
		if (!r) return;
		e.stopPropagation();
		var it = r.__it, b = e.target.closest("[data-a]"), a = b ? b.dataset.a : "play";
		if (a === "queue") queueUri(it.uri, it.title);
		else if (a === "save") saveSong(it.uri, false);
		else playUri(it.uri, it.title);
	}

	function searchWindow() {
		if (!helperNew()) return U.toast("Update the helper (Build Helper.bat) for search");
		var w = el("div", "sps");
		w.innerHTML = '<div class="sps-left"><div class="sps-bar"><span class="sps-ic">' + svg("search") + '</span><input class="sps-in" placeholder="Song, artist, album or playlist" /></div></div><div class="sps-res"></div>';
		var inp = w.querySelector(".sps-in"), res = w.querySelector(".sps-res"), left = w.querySelector(".sps-left");
		U.dragScroll(res);
		res.addEventListener("click", onResultClick);
		var t = null, asked = "";
		function show(r, q) {
			if (!r) return;
			var secs = [["tracks", "Songs"], ["artists", "Artists"], ["albums", "Albums"], ["playlists", "Playlists"]];
			res.innerHTML = "";
			var any = false;
			secs.forEach(function (sc) {
				var list = r[sc[0]] || [];
				if (!list.length) return;
				any = true;
				res.appendChild(el("h5", "spr-h", esc(sc[1])));
				list.slice(0, sc[0] === "tracks" ? 8 : 4).forEach(function (it) { res.appendChild(resultRow(it, sc[0])); });
			});
			if (!any) res.innerHTML = '<div class="notice small"><span>' + esc(r.error || "Nothing found for “" + q + "”") + "</span></div>";
		}
		function go(q) {
			q = (q || "").trim();
			clearTimeout(t);
			if (q.length < 2) { res.innerHTML = '<div class="notice small"><span>Type at least 2 letters</span></div>'; return; }
			if (q === asked) return;
			t = setTimeout(function () {
				asked = q;
				res.classList.add("loading");
				Helper.fetch("/api/spotify/search?q=" + encodeURIComponent(q), { cache: "no-store" }, 12000).then(function (r) {
					res.classList.remove("loading");
					if (asked !== q) return;
					lastQ = q;
					lastRes = r;
					show(r, q);
				}, function () { res.classList.remove("loading"); res.innerHTML = '<div class="notice small"><span>Couldn\'t search right now</span></div>'; });
			}, 450);
		}
		left.appendChild(keyboard(inp, go, function (q) { asked = ""; go(q); }, "Search"));
		Editor.modal("Search Spotify", w);
		inp.value = lastQ;
		if (lastRes && lastQ) { asked = lastQ; show(lastRes, lastQ); }
		else res.innerHTML = '<div class="notice small"><span>Type to search. Tap a result to play it, ' + svg("list") + " to play it next, " + svg("addlist") + " to save it.</span></div>";
	}

	types.spsearch = {
		name: "Spotify search", desc: "Search songs, artists and playlists with an on-screen keyboard", icon: "search", group: "media", helper: true,
		w: 2, h: 1, minW: 1, minH: 1, maxW: 4, maxH: 2,
		build: function (ctx) {
			ctx.node.classList.add("press");
			ctx.node.addEventListener("click", function () { if (!App.editing && Helper.online) searchWindow(); });
			ctx.body.innerHTML = '<div class="sps1"><span class="sps1-ic">' + svg("search") + '</span><span class="sps1-tx"><b>Search Spotify</b><em>Songs, artists, playlists</em></span></div>';
			return function () {};
		},
	};

	/* ------------------------------------------------------------------ recently played */
	function ago(iso) {
		var t = Date.parse(iso || "");
		if (!t) return "";
		var m = Math.round((Date.now() - t) / 60000);
		return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " d ago";
	}
	function recentList(box, max) {
		var r = recP.get();
		if (spMissing("recent")) return setHtml(box, '<div class="notice small"><b>One more click</b><span>' + esc(RECONNECT) + "</span></div>");
		if (!r) return setHtml(box, '<div class="notice small"><span>Loading…</span></div>');
		var items = (r.items || []).slice(0, max);
		var key = JSON.stringify(items.map(function (x) { return [x.uri, x.at]; }));
		if (box.__k === key) {
			box.querySelectorAll(".spr-row em[data-at]").forEach(function (e) { e.textContent = e.dataset.artist + " · " + ago(e.dataset.at); });
			return;
		}
		box.__k = key;
		box.innerHTML = "";
		if (!items.length) return setHtml(box, '<div class="notice small"><span>Nothing played lately</span></div>');
		items.forEach(function (it) {
			var row = resultRow(it, "tracks");
			var em = row.querySelector("em");
			em.dataset.at = it.at || "";
			em.dataset.artist = it.artist || "";
			em.textContent = it.artist + " · " + ago(it.at);
			box.appendChild(row);
		});
	}
	function recentWindow() {
		var w = el("div", "spr-win");
		var box = el("div", "spr-list");
		w.appendChild(box);
		box.addEventListener("click", onResultClick);
		Editor.modal("Recently played", w);
		recP.get(true);
		recentList(box, 25);
		var t = setInterval(function () { if (!w.isConnected) return clearInterval(t); recentList(box, 25); }, 500);
	}

	types.sprecent = {
		name: "Recently played", desc: "What you played on Spotify lately · tap to play again", icon: "history", group: "media", helper: true,
		w: 3, h: 2, minW: 2, minH: 1, maxW: 6, maxH: 6, tickMs: 30000,
		build: function (ctx) {
			var st = { built: false }, box;
			return function () {
				if (gate(ctx, st)) return;
				if (!st.built) {
					ctx.body.innerHTML = T.head("history", "Recently played") + '<div class="spr-list"></div>';
					box = ctx.body.querySelector(".spr-list");
					U.dragScroll(box);
					box.addEventListener("click", function (e) { if (!App.editing) onResultClick(e); });
					st.built = true;
				}
				var s = spP.get();
				if (s && !s.connected) return setHtml(box, '<div class="notice small"><span>Connect Spotify first (see the Spotify tile)</span></div>');
				recentList(box, 25);
			};
		},
	};

	/* ------------------------------------------------------------------ the big now-playing tile (fills a page) */
	var NOW_BUTTONS = [["like", "Like", "heart"], ["save", "Save to playlist", "addlist"], ["search", "Search", "search"], ["recent", "Recently played", "history"], ["lists", "Playlists", "list"]];
	types.spnow = {
		name: "Now playing (big)", desc: "Big cover, seek, volume, search and more · fills a page", icon: "music", group: "media", helper: true,
		w: 8, h: 4, minW: 4, minH: 2, maxW: 40, maxH: 24, tickMs: 1000,
		defaults: function () { return { buttons: ["like", "save", "search", "recent", "lists"], volume: true, next: true, blur: true }; },
		options: function () {
			return [
				{ key: "buttons", label: "Buttons", type: "multi", "default": ["like", "save", "search", "recent", "lists"], choices: NOW_BUTTONS.map(function (b) { return { value: b[0], label: b[1] }; }) },
				{ key: "volume", label: "Volume slider", type: "toggle", "default": true },
				{ key: "next", label: "Up next (when there's room)", type: "toggle", "default": true },
				{ key: "blur", label: "Cover as background", type: "toggle", "default": true },
			];
		},
		build: function (ctx) {
			var st = { built: false }, q = {}, shownImg = null, seekDrag = false, volHold = 0, volSl = null, lastVolSent = 0, volPend = null;
			var cfg = function () { return ctx.tile.cfg || {}; };
			function build() {
				ctx.body.innerHTML =
					'<div class="spn-bg"></div><div class="spn">' +
					'<span class="spn-art"></span>' +
					'<div class="spn-main"><div class="spn-tx"><b class="spn-t"></b><span class="spn-a"></span><span class="spn-d"></span></div>' +
					'<div class="spn-seek"><div class="spn-track"><i></i><s></s></div><div class="spn-times"><span class="spn-cur"></span><span class="spn-dur"></span></div></div>' +
					'<div class="spn-ctl"><button data-a="shuffle" class="sm">' + svg("shuffle") + '</button><button data-a="prev">' + svg("prev") + '</button><button data-a="play" class="spn-play"></button><button data-a="next">' + svg("next") + '</button><button data-a="repeat" class="sm"></button></div>' +
					'<div class="spn-low"><div class="spn-btns"></div><div class="spn-vol"><span class="spn-vi">' + svg("speaker") + '</span><div class="spn-vs"></div></div></div></div>' +
					'<div class="spn-q"></div></div><div class="spn-off notice"></div>';
				["spn-bg", "spn-art", "spn-t", "spn-a", "spn-d", "spn-track", "spn-cur", "spn-dur", "spn-play", "spn-btns", "spn-vol", "spn-vs", "spn-q", "spn-off", "spn"].forEach(function (c) { q[c] = ctx.body.querySelector("." + c); });
				q.fill = q["spn-track"].querySelector("i");
				q.knob = q["spn-track"].querySelector("s");
				q.rep = ctx.body.querySelector('[data-a="repeat"]');
				q.shuf = ctx.body.querySelector('[data-a="shuffle"]');
				volSl = T.slider(q["spn-vs"], function (v, final) {
					var p = player();
					if (!p) return;
					p.volume = v;
					volHold = Date.now() + 2500;
					clearTimeout(volPend);
					var now = Date.now();
					if (!final && now - lastVolSent < 300) { volPend = setTimeout(function () { Helper.act({ action: "spotify", what: "volume", value: v }, true); }, 300); return; }
					lastVolSent = now;
					Helper.act({ action: "spotify", what: "volume", value: v }, true);
				});
				ctx.body.querySelector(".spn-ctl").addEventListener("click", function (e) {
					var b = e.target.closest("[data-a]");
					if (!b || App.editing) return;
					e.stopPropagation();
					var p = player() || {};
					var w = b.dataset.a, body = { what: w };
					if (w === "play") { body.what = p.playing ? "pause" : "play"; p.playing = !p.playing; }
					if (w === "shuffle") { p.shuffle = !p.shuffle; body.value = p.shuffle ? 1 : 0; }
					if (w === "repeat") { var n = { off: 1, context: 2, track: 0 }[p.repeat || "off"]; p.repeat = ["off", "context", "track"][n]; body.value = n; }
					App.dirty();
					spAct(body, "");
				});
				q["spn-btns"].addEventListener("click", function (e) {
					var b = e.target.closest("[data-a]");
					if (!b || App.editing) return;
					e.stopPropagation();
					var w = b.dataset.a, p = player() || {};
					if (w === "like") { p.liked = !p.liked; App.dirty(); spAct({ what: p.liked ? "like" : "unlike" }, p.liked ? "Added to Liked Songs" : "Removed from Liked Songs"); }
					else if (w === "save") saveSong(null, false);
					else if (w === "search") searchWindow();
					else if (w === "recent") recentWindow();
					else if (w === "lists") pickPlaylistToPlay();
				});
				// Seek: tap or drag along the bar.
				var tr = q["spn-track"];
				function frac(e) { var r = tr.getBoundingClientRect(); return r.width ? U.clamp((e.clientX - r.left) / r.width, 0, 1) : 0; }
				tr.addEventListener("pointerdown", function (e) {
					if (App.editing || !player()) return;
					e.stopPropagation();
					seekDrag = true;
					try { tr.setPointerCapture(e.pointerId); } catch (x) {}
					showProgress(frac(e));
				});
				tr.addEventListener("pointermove", function (e) { if (seekDrag) showProgress(frac(e)); });
				tr.addEventListener("pointerup", function (e) {
					if (!seekDrag) return;
					seekDrag = false;
					var p = player();
					if (!p || !p.duration) return;
					var ms = Math.round(frac(e) * p.duration);
					p.progress = ms;
					spP.at = Date.now();
					Helper.act({ action: "spotify", what: "seek", value: ms }, true).then(function () { spP.soon(); });
				});
				tr.addEventListener("pointercancel", function () { seekDrag = false; });
				tr.addEventListener("click", function (e) { e.stopPropagation(); });
				q["spn-off"].addEventListener("click", function (e) { if (e.target.closest(".sp-how") && !App.editing) { e.stopPropagation(); Round6.spotifyGuide(); } });
				st.built = true;
				st.btns = "";
			}
			function player() { var s = spP.data; return s && s.connected && s.player && s.player.title ? s.player : null; }
			function nowMs(p) {
				var ms = p.progress || 0;
				if (p.playing) ms += Date.now() - (spP.at || Date.now());
				return Math.min(ms, p.duration || ms);
			}
			function showProgress(f) {
				var p = player();
				q.fill.style.width = f * 100 + "%";
				q.knob.style.left = f * 100 + "%";
				setText(q["spn-cur"], p ? mmss(f * (p.duration || 0)) : "");
			}
			return function () {
				if (gate(ctx, st)) return;
				if (!st.built) build();
				var c = cfg(), s = spP.get();
				var ready = !!(s && s.connected);
				ctx.node.classList.toggle("sp-ready", ready);
				if (!ready) {
					setHtml(q["spn-off"], !s ? "<span>Connecting…</span>" : '<b>Connect Spotify once</b><span>For the big player, search and more.</span><button class="pill accent sp-how">How?</button>');
					return;
				}
				var big = ctx.w >= 12 && ctx.h >= 3;
				ctx.node.classList.toggle("spn-big", big);
				ctx.node.classList.toggle("spn-narrow", ctx.w < 6);
				ctx.node.classList.toggle("spn-noblur", c.blur === false);
				var btns = (c.buttons || ["like", "save", "search", "recent", "lists"]).join(",");
				if (btns !== st.btns) {
					st.btns = btns;
					setHtml(q["spn-btns"], NOW_BUTTONS.filter(function (b) { return btns.split(",").indexOf(b[0]) >= 0; }).map(function (b) {
						return '<button data-a="' + b[0] + '" class="spn-b spn-' + b[0] + '">' + svg(b[2]) + "<span>" + esc(b[1]) + "</span></button>";
					}).join(""));
				}
				q["spn-vol"].hidden = c.volume === false;
				var p = player();
				ctx.node.classList.toggle("sp-idle", !p);
				ctx.node.classList.toggle("spn-img", !!(p && p.image));
				// The cover is a square as big as the tile allows (at most 45 % of its width).
				var box = q.spn.getBoundingClientRect(), sizeKey = Math.round(box.width) + "x" + Math.round(box.height);
				if (box.width && sizeKey !== st.size) {
					st.size = sizeKey;
					var pad = parseFloat(getComputedStyle(q.spn).paddingTop) || 0;
					var side = Math.max(0, Math.min(box.height - 2 * pad, box.width * 0.45));
					q["spn-art"].style.width = q["spn-art"].style.height = side + "px";
				}
				if (!p) {
					setText(q["spn-t"], s.starting ? "Starting Spotify…" : "Nothing playing");
					setText(q["spn-a"], s.starting ? "Your music starts in a moment" : s.error || "Tap play to start Spotify, or search for something");
					setText(q["spn-d"], "");
					setHtml(q["spn-play"], svg("play"));
					q["spn-art"].style.backgroundImage = q["spn-bg"].style.backgroundImage = "";
					shownImg = null;
					showProgress(0);
					setText(q["spn-dur"], "");
					return;
				}
				setText(q["spn-t"], p.title);
				setText(q["spn-a"], p.artist);
				setText(q["spn-d"], p.device ? "Playing on " + p.device : "");
				if (p.image !== shownImg) {
					shownImg = p.image;
					q["spn-art"].style.backgroundImage = bg(p.image);
					q["spn-bg"].style.backgroundImage = bg(p.image);
				}
				setHtml(q["spn-play"], svg(p.playing ? "pause" : "play"));
				q.shuf.classList.toggle("on", !!p.shuffle);
				setHtml(q.rep, svg("repeat") + (p.repeat === "track" ? "<small>1</small>" : ""));
				q.rep.classList.toggle("on", p.repeat && p.repeat !== "off");
				var lk = q["spn-btns"].querySelector(".spn-like");
				if (lk) lk.classList.toggle("on", !!p.liked);
				var sv = q["spn-btns"].querySelector(".spn-save span");
				if (sv) setText(sv, O().spSave ? "Save to " + O().spSave.name : "Save to playlist");
				if (!seekDrag) {
					showProgress(p.duration ? nowMs(p) / p.duration : 0);
					setText(q["spn-cur"], mmss(nowMs(p)));
				}
				setText(q["spn-dur"], mmss(p.duration));
				if (p.volume != null && Date.now() > volHold) volSl.set(p.volume);
				q["spn-vol"].classList.toggle("na", p.volume == null);
				var showQ = c.next !== false && ctx.w >= 11 && ctx.h >= 3;
				ctx.node.classList.toggle("spn-hasq", showQ);
				if (showQ) {
					var qu = quP.get();
					var list = (qu && qu.queue) || [];
					var key = JSON.stringify(list.slice(0, 8));
					if (q["spn-q"].__k !== key) {
						q["spn-q"].__k = key;
						setHtml(q["spn-q"], list.length ? "<h5>Up next</h5>" + list.slice(0, ctx.h >= 5 ? 8 : 5).map(function (x) { return "<div><b>" + esc(x.title) + "</b><span>" + esc(x.artist) + "</span></div>"; }).join("") : "");
					}
				}
			};
		},
	};

	function pickPlaylistToPlay() {
		var wrap = el("div", "opts");
		Editor.modal("Play a playlist", wrap);
		function draw() {
			wrap.innerHTML = "";
			if (!plP.data) { wrap.appendChild(el("p", "hint", "Loading your playlists…")); return; }
			var g = el("div", "pl-grid");
			((plP.data && plP.data.playlists) || []).forEach(function (p) {
				var b = el("button", "pl", '<span class="pl-img"></span><b></b>');
				b.querySelector("b").textContent = p.name;
				if (p.image) b.querySelector(".pl-img").style.backgroundImage = bg(p.image);
				else b.querySelector(".pl-img").innerHTML = svg("heart");
				b.addEventListener("click", function () {
					spAct({ what: "playlist", uri: p.uri }, "Playing " + p.name).then(function (ok) { if (ok) Editor.closeModal(); });
				});
				g.appendChild(b);
			});
			wrap.appendChild(g);
		}
		plP.get(true);
		draw();
		var wait = setInterval(function () { if (plP.data) { clearInterval(wait); if (wrap.isConnected) draw(); } }, 300);
		setTimeout(function () { clearInterval(wait); }, 20000);
	}

	/* Built-in page templates (Pages → + → New page). */
	function builtinTemplates() {
		return [{
			name: "Music", sub: "Big now playing + recently played",
			make: function () {
				var g = Editor.gridInfo() || { cols: 16, rows: 6 };
				var side = g.cols >= 14 ? 4 : 0;
				var tiles = [Editor.makeTile("spnow", Math.max(4, g.cols - side), g.rows)];
				if (side) tiles.push(Editor.makeTile("sprecent", side, g.rows));
				return { name: "Music", tiles: tiles };
			},
		}];
	}
	return {
		person: person,
		discordIdle: discordIdle,
		pickChannel: pickChannel,
		joinChannel: joinChannel,
		profiles: profiles,
		profileById: profileById,
		applyProfile: applyProfile,
		profileManager: profileManager,
		keyboard: keyboard,
		helperNew: helperNew,
		pttUp: pttUp,
		_ptt: ptt,
		saveSong: saveSong,
		searchWindow: searchWindow,
		recentWindow: recentWindow,
		builtinTemplates: builtinTemplates,
	};
})();
