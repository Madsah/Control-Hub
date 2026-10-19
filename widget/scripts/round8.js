/* Control Panel — Round 8A: panel tools and design.
 * Quick menu, lock, undo bar, picking several tiles, tile quick settings (hold), double-tap actions, colors per tile,
 * favourite page, and the Look window (themes, size, shapes, spacing, backgrounds, animations, screensavers).
 * Everything is a choice: nothing changes until you switch it on. Settings live in the layout (L.opts), so they are
 * backed up and shared by every iCUE profile. */

var Round8 = (function () {
	var el = U.el, svg = U.svg, esc = U.esc;

	// Tiles that use holding for something of their own (holding them doesn't open quick settings).
	["timer", "topapps", "windows", "pomodoro"].forEach(function (k) { if (T.types[k]) T.types[k].ownHold = true; });

	function L() { return Editor.layout(); }
	function O() { var l = L(); return l.opts || (l.opts = {}); }
	function setOpt(k, v) { O()[k] = v; Editor.save(); }

	var THEMES = [["", "Same as all pages"], ["navy", "Navy"], ["dark", "Dark"], ["teal", "Teal"], ["light", "Light"], ["cockpit", "Cockpit"], ["midnight", "Midnight"], ["nordic", "Nordic"], ["neon", "Neon"]];
	var ALL_THEMES = THEMES.slice(1).map(function (t) { return t[0]; });
	var COLORS = ["", "#2BB3A3", "#3B82F6", "#5865F2", "#8B5CF6", "#EC4899", "#EF4444", "#F97316", "#F59E0B", "#22C55E", "#1DB954", "#64748B"];

	/* ================================================================== applying the look */
	var wallRgb = null, wallFor = "";
	function applyLook() {
		var b = document.body, o = O(), l = L();
		var page = l.pages[l.current] || {};
		var theme = page.theme || o.theme || "";
		if (theme) {
			ALL_THEMES.forEach(function (t) { b.classList.toggle("theme-" + t, t === theme); });
		} else if (typeof Cfg !== "undefined") {
			ALL_THEMES.forEach(function (t) { b.classList.toggle("theme-" + t, t === Cfg.theme || (!/^(navy|dark|teal|light)$/.test(Cfg.theme) && t === "navy")); });
		}
		b.dataset.radius = o.radius || "";
		b.dataset.pageanim = o.pageAnim || "";
		b.classList.toggle("count-up", !!o.countUp);
		b.classList.toggle("no-pulse", o.pulse === false);
		b.classList.toggle("bg-blur", !!o.bgBlur);
		b.classList.toggle("locked", !!o.locked);
		b.classList.toggle("locked-all", !!o.locked && o.lockMode !== "edits");
		b.classList.toggle("qm-on", o.quickMenu !== false);
		background();
		wallpaperAccent();
		lockLayer();
	}

	/* Moving backgrounds and video backgrounds. They pause while a game page is showing. */
	function background() {
		var bg = document.getElementById("bg"), o = O();
		var anim = o.bgAnim || "";
		var layer = bg.querySelector(".bg-anim");
		if (anim && !layer) { layer = el("div", "bg-anim"); bg.appendChild(layer); }
		if (layer) {
			layer.className = "bg-anim" + (anim ? " bga-" + anim : "");
			layer.hidden = !anim;
			if (anim === "stars" && !layer.firstChild) layer.innerHTML = '<i class="st1"></i><i class="st2"></i><i class="st3"></i>';
			if (anim === "clouds" && !layer.querySelector(".cl")) layer.innerHTML = '<i class="cl c1"></i><i class="cl c2"></i><i class="cl c3"></i>';
			if (anim === "gradient") layer.innerHTML = "";
		}
		var gaming = typeof Pages !== "undefined" && Pages._auto && Pages._auto().active;
		document.body.classList.toggle("bg-paused", !!gaming || (typeof Look !== "undefined" && Look.sleeping));
		// A video file picked as the background in iCUE plays (muted, looping).
		var src = typeof Cfg !== "undefined" && Cfg.backgroundStyle === "image" ? Cfg.bgImage : "";
		var isVideo = /\.(mp4|webm|mov|m4v)(\?|$)/i.test(src || "");
		var v = bg.querySelector("video");
		if (isVideo) {
			if (!v) { v = el("video", "bg-video"); v.muted = true; v.loop = true; v.autoplay = true; v.setAttribute("playsinline", ""); bg.appendChild(v); }
			if (v.getAttribute("src") !== src) { v.setAttribute("src", src); try { v.play(); } catch (e) {} }
			bg.style.backgroundImage = "";
			if (document.body.classList.contains("bg-paused")) { try { v.pause(); } catch (e) {} } else if (v.paused) { try { v.play(); } catch (e) {} }
		} else if (v) v.remove();
	}

	function wallpaperAccent() {
		var src = typeof Cfg !== "undefined" && Cfg.backgroundStyle === "image" ? Cfg.bgImage : "";
		if (!O().wallAccent || !src || /\.(mp4|webm|mov|m4v)/i.test(src)) {
			if (wallRgb) { wallRgb = null; wallFor = ""; Look.setBaseAccent(null); }
			return;
		}
		if (src === wallFor) return;
		wallFor = src;
		var img = new Image();
		img.onload = function () { if (wallFor === src) { wallRgb = Look._vivid(img); Look.setBaseAccent(wallRgb); } };
		img.src = src;
	}

	/* ================================================================== undo bar */
	var undoEl = null, undoTimer = null;
	function offerUndo(label) {
		if (!undoEl) {
			undoEl = el("div", "undo-bar", '<span></span><button class="pill accent">Undo</button>');
			document.body.appendChild(undoEl);
			undoEl.querySelector("button").addEventListener("click", function (e) {
				e.stopPropagation();
				undoEl.classList.remove("show");
				if (Editor.undo()) U.toast("Undone");
			});
		}
		undoEl.querySelector("span").textContent = label;
		undoEl.classList.add("show");
		clearTimeout(undoTimer);
		undoTimer = setTimeout(function () { undoEl.classList.remove("show"); }, 8000);
	}

	/* ================================================================== lock */
	function locked() { return !!O().locked; }
	function lockedAll() { return !!O().locked && O().lockMode !== "edits"; }
	function setLocked(on) {
		O().locked = !!on;
		Editor.save();
		if (on && App.editing) Editor.setEditing(false);
		applyLook();
		U.toast(on ? (O().lockMode === "edits" ? "Panel locked: no editing. Hold the lock to unlock" : "Panel locked. Hold anywhere to unlock") : "Panel unlocked");
	}
	var lockEl = null;
	function lockLayer() {
		if (!lockEl) {
			lockEl = el("div", "lock-layer", '<span class="lock-badge">' + svg("lock") + '<i class="lock-ring"></i></span>');
			document.body.appendChild(lockEl);
			var t = null, hint = 0;
			function down(e) {
				e.preventDefault();
				e.stopPropagation();
				lockEl.classList.add("holding");
				clearTimeout(t);
				t = setTimeout(function () { lockEl.classList.remove("holding"); setLocked(false); }, 1200);
			}
			function up() {
				clearTimeout(t);
				if (lockEl.classList.contains("holding") && Date.now() - hint > 3000) { hint = Date.now(); U.toast("Locked · hold for a second to unlock"); }
				lockEl.classList.remove("holding");
			}
			lockEl.addEventListener("pointerdown", down);
			lockEl.addEventListener("pointerup", up);
			lockEl.addEventListener("pointercancel", up);
			lockEl.addEventListener("click", function (e) { e.stopPropagation(); });
		}
		lockEl.hidden = !locked();
	}

	/* ================================================================== quick menu (swipe down from the top) */
	var QM_ITEMS = [
		["volume", "Volume slider", "speaker"], ["dim", "Panel brightness", "sun"], ["dnd", "Do Not Disturb", "moon"], ["mic", "Mute mic", "micOff"],
		["speakers", "Mute sound", "speakerOff"], ["output", "Switch output", "headset"], ["awake", "Keep awake", "sun"],
		["warm", "Warm light", "moon"], ["lock", "Lock panel", "lock"], ["saver", "Screensaver now", "clock"], ["edit", "Edit layout", "pencil"],
	];
	var QM_DEFAULT = ["volume", "dnd", "mic", "output", "awake", "warm", "lock", "saver"];
	var qmEl = null, qmDim = 0, qmWarm = false;

	function qmItems() { return O().qmItems || QM_DEFAULT; }

	function openQuick() {
		if (O().quickMenu === false || lockedAll() || App.editing) return;
		if (!qmEl) {
			qmEl = el("div", "qm", '<div class="qm-sheet"><div class="qm-grid"></div><div class="qm-sliders"></div><i class="qm-grab"></i></div>');
			document.body.appendChild(qmEl);
			qmEl.addEventListener("click", function (e) { if (e.target === qmEl) closeQuick(); });
			var sy = null;
			qmEl.addEventListener("pointerdown", function (e) { if (!e.target.closest(".slider")) sy = e.clientY; });
			qmEl.addEventListener("pointerup", function (e) { if (sy !== null && sy - e.clientY > 40) closeQuick(); sy = null; });
		}
		drawQuick();
		qmEl.hidden = false;
		void qmEl.offsetWidth;
		qmEl.classList.add("show");
		Helper.fetch("/api/state?parts=audio,dnd", { cache: "no-store" }, 3000).then(function (s) {
			["outputs", "inputs", "speakers", "mic", "dnd"].forEach(function (k) { if (s[k] !== undefined) Helper.state[k] = s[k]; });
			if (qmEl.classList.contains("show")) drawQuick();
		}, function () {});
	}
	function closeQuick() {
		if (!qmEl) return;
		qmEl.classList.remove("show");
		setTimeout(function () { if (!qmEl.classList.contains("show")) qmEl.hidden = true; }, 260);
	}

	function drawQuick() {
		var grid = qmEl.querySelector(".qm-grid"), sliders = qmEl.querySelector(".qm-sliders");
		grid.innerHTML = "";
		sliders.innerHTML = "";
		var items = qmItems(), st = Helper.state;
		var outDef = T.endpointFor(false, ""), micDef = T.endpointFor(true, "");
		items.forEach(function (k) {
			var it = QM_ITEMS.filter(function (x) { return x[0] === k; })[0];
			if (!it) return;
			if (k === "volume" || k === "dim") {
				var row = el("div", "qm-sl", svg(it[2]) + "<span></span>");
				row.querySelector("span").textContent = it[1];
				var sl = T.slider(row, function (v, final) {
					if (k === "volume") {
						var d = T.endpointFor(false, "");
						if (!d) return;
						d.volume = v;
						Helper.hold("outputs");
						Helper.act({ action: "speakersVolume", device: d.id, value: v }, !final);
					} else {
						qmDim = Math.round((100 - v) * 0.8);
						Look.setPanel({ dim: qmDim, warm: qmWarm });
					}
				});
				sl.set(k === "volume" ? (outDef ? outDef.volume : 0) : 100 - qmDim / 0.8);
				sliders.appendChild(row);
				return;
			}
			var on = k === "dnd" ? !!st.dnd : k === "mic" ? !!(micDef && micDef.muted) : k === "speakers" ? !!(outDef && outDef.muted) : k === "awake" ? !!st.keepAwake : k === "warm" ? qmWarm : false;
			var sub = k === "output" && outDef ? outDef.name.replace(/\s*\(.*\)\s*$/, "") : on ? "On" : "";
			var b = el("button", "qm-b" + (on ? " on" : ""), '<span class="qm-ic">' + svg(on && k === "mic" ? "micOff" : it[2]) + "</span><b></b><em></em>");
			b.querySelector("b").textContent = it[1];
			b.querySelector("em").textContent = sub;
			b.addEventListener("click", function () { quickAction(k); });
			grid.appendChild(b);
		});
		if (!grid.children.length && !sliders.children.length) grid.appendChild(el("p", "hint", "Nothing in the quick menu. Edit → Look → Quick menu."));
	}

	function quickAction(k) {
		var st = Helper.state;
		if (!Helper.online && /^(dnd|mic|speakers|output|awake)$/.test(k)) return U.toast("Start Control Hub for this");
		if (k === "dnd") { st.dnd = !st.dnd; Helper.hold("dnd", 3000); Helper.act({ action: "dnd", on: st.dnd }, true); }
		else if (k === "mic" || k === "speakers") {
			var mic = k === "mic", d = T.endpointFor(mic, "");
			if (!d) return U.toast("No device found");
			d.muted = !d.muted;
			Helper.hold(mic ? "inputs" : "outputs");
			Helper.act({ action: mic ? "micMute" : "speakersMute", device: d.id, value: d.muted }, true);
		} else if (k === "output") {
			var all = T.endpoints(false);
			if (all.length < 2) return U.toast("Only one output device");
			var cur = T.endpointFor(false, ""), next = all[(all.indexOf(cur) + 1) % all.length];
			all.forEach(function (d) { d.isDefault = d === next; });
			Helper.hold("outputs", 2500);
			Helper.act({ action: "setDefaultDevice", mic: false, device: next.id }, true);
			U.toast("Sound → " + next.name);
		} else if (k === "awake") { st.keepAwake = !st.keepAwake; Helper.act({ action: "keepAwake", value: st.keepAwake }, true); }
		else if (k === "warm") { qmWarm = !qmWarm; Look.setPanel({ dim: qmDim, warm: qmWarm }); }
		else if (k === "lock") { closeQuick(); return setLocked(true); }
		else if (k === "saver") { closeQuick(); return Look.sleepNow(); }
		else if (k === "edit") { closeQuick(); return Editor.setEditing(true); }
		App.dirty();
		drawQuick();
	}

	/* ================================================================== picking several tiles */
	var selecting = false, selected = {}, selBar = null;
	function startSelect() {
		selecting = true;
		selected = {};
		document.body.classList.add("selecting");
		if (!selBar) {
			selBar = el("div", "sel-bar", '<b class="sel-n"></b><button data-a="move" class="pill">Move to page…</button><button data-a="copy" class="pill">Copy to page…</button><button data-a="pin" class="pill">On every page</button><button data-a="del" class="pill danger">Delete</button><button data-a="done" class="pill strong">Done</button>');
			document.body.appendChild(selBar);
			selBar.addEventListener("click", function (e) {
				var b = e.target.closest("[data-a]");
				if (!b) return;
				e.stopPropagation();
				selAction(b.dataset.a);
			});
		}
		selBar.hidden = false;
		paintSelection();
	}
	function stopSelect() {
		selecting = false;
		selected = {};
		document.body.classList.remove("selecting");
		if (selBar) selBar.hidden = true;
		paintSelection();
	}
	function paintSelection() {
		var nodes = Editor.nodes();
		Object.keys(nodes).forEach(function (id) { nodes[id].classList.toggle("sel", !!selected[id]); });
		if (selBar) selBar.querySelector(".sel-n").textContent = Object.keys(selected).length + " selected";
	}
	function selTiles() { return L().tiles.filter(function (t) { return selected[t.id]; }); }
	function pickPage(title, fn) {
		var wrap = el("div", "opts"), rows = el("div", "opt-list");
		Editor.modal(title, wrap);
		L().pages.forEach(function (p, i) {
			if (i === L().current) return;
			var b = el("button", "opt-row", "<span><b></b><em></em></span>");
			b.querySelector("b").textContent = p.name;
			b.querySelector("em").textContent = p.tiles.length + " tiles";
			b.addEventListener("click", function () { Editor.closeModal(); fn(i); });
			rows.appendChild(b);
		});
		if (!rows.children.length) rows.appendChild(el("p", "hint", "There's no other page yet. Add one in Pages."));
		wrap.appendChild(rows);
	}
	function selAction(a) {
		var list = selTiles();
		if (a === "done") return stopSelect();
		if (!list.length) return U.toast("Tap the tiles you want first");
		if (a === "move" || a === "copy") return pickPage(a === "move" ? "Move to which page?" : "Copy to which page?", function (i) {
			Editor.pushUndo((a === "move" ? "Moved " : "Copied ") + list.length + " tiles");
			var l = L(), keep = l.current, hiddenN = 0;
			list.forEach(function (t) {
				var c = a === "copy" ? Editor.cloneTile(t) : t;
				if (a === "move") l.tiles.splice(l.tiles.indexOf(t), 1);
				Editor.usePage(i);
				if (!Editor.place(c)) { c.x = 9999; c.y = 9999; hiddenN++; }
				l.tiles.push(c);
				Editor.usePage(keep);
			});
			Editor.save();
			stopSelect();
			App.render();
			App.refreshNeeds();
			U.toast((a === "move" ? "Moved " : "Copied ") + list.length + " tiles to " + l.pages[i].name + (hiddenN ? " (" + hiddenN + " under Hidden, no space)" : ""));
		});
		if (a === "pin") {
			var bad = 0;
			list.forEach(function (t) { if (!Editor.pinTile(t)) bad++; });
			stopSelect();
			return U.toast(bad ? bad + " didn't fit in the same spot on every page" : "Now on every page");
		}
		if (a === "del") {
			Editor.pushUndo("Deleted " + list.length + " tiles");
			var l2 = L();
			list.forEach(function (t) { l2.tiles.splice(l2.tiles.indexOf(t), 1); });
			Editor.save();
			stopSelect();
			App.render();
			App.refreshNeeds();
		}
	}

	/* ================================================================== hold a tile: quick settings */
	var DBL = [["", "Nothing"], ["page", "Go to a page…"], ["mic", "Mute / unmute mic"], ["play", "Play / pause"], ["next", "Next song"], ["like", "Like the song (Spotify)"],
		["dnd", "Do Not Disturb on / off"], ["quick", "Open the quick menu"], ["lock", "Lock the panel"], ["saver", "Screensaver"]];

	function tileSheet(t, node) {
		var def = T.types[t.type], cfg = t.cfg || (t.cfg = {});
		var pinned = (L().pinned || []).indexOf(t) >= 0;
		var wrap = el("div", "opts tile-sheet");
		Editor.modal(Editor.titleOf(t), wrap);
		function draw() {
			wrap.innerHTML = "";
			var acts = el("div", "chips");
			function act(label, icon, fn) {
				var b = el("button", "pill", svg(icon) + " " + esc(label));
				b.addEventListener("click", fn);
				acts.appendChild(b);
			}
			if (def.options || def.edit || def.editable || t.type === "shortcut" || t.type === "folder") act("Settings", "pencil", function () { Editor.closeModal(); Editor.edit(t); });
			act(pinned ? "Only on this page" : "Show on every page", "pages", function () {
				Editor.closeModal();
				if (pinned) {
					var l = L();
					Editor.pushUndo("Unpinned " + Editor.titleOf(t));
					l.pinned.splice(l.pinned.indexOf(t), 1);
					l.tiles.push(t);
					Editor.save();
					App.render();
				} else if (!Editor.pinTile(t)) U.toast("No spot that's free on every page");
				else U.toast("Now on every page");
			});
			act("Move or resize (Edit)", "resize", function () { Editor.closeModal(); Editor.setEditing(true); });
			wrap.appendChild(acts);

			var s1 = el("div", "opt", "<h4>Double-tap does</h4>");
			var ch = el("div", "chips");
			DBL.forEach(function (d) {
				var on = (cfg.dbl || "") === d[0];
				var c = el("button", "chip" + (on ? " on" : ""), esc(d[0] === "page" && on && cfg.dblPage ? "Go to " + pageName(cfg.dblPage) : d[1]));
				c.addEventListener("click", function () {
					if (d[0] === "page") return pickPage("Double-tap goes to", function (i) { cfg.dbl = "page"; cfg.dblPage = L().pages[i].id; Editor.save(); tileSheet(t, node); });
					cfg.dbl = d[0];
					Editor.save();
					draw();
				});
				ch.appendChild(c);
			});
			s1.appendChild(ch);
			s1.appendChild(el("p", "hint", "Tap twice quickly. The first tap still does the tile's normal thing."));
			wrap.appendChild(s1);

			var s2 = el("div", "opt", "<h4>Tile color</h4>");
			var cols = el("div", "colors");
			COLORS.forEach(function (c) {
				var b = el("button", "color" + ((cfg.color || "") === c ? " on" : "") + (c ? "" : " none"));
				if (c) b.style.background = c; else b.innerHTML = svg("x");
				b.addEventListener("click", function () { cfg.color = c; Editor.save(); App.render(); draw(); });
				cols.appendChild(b);
			});
			s2.appendChild(cols);
			wrap.appendChild(s2);
		}
		draw();
	}
	function pageName(id) { var p = L().pages.filter(function (x) { return x.id === id; })[0]; return p ? p.name : "page"; }

	function runDbl(t) {
		var cfg = t.cfg || {};
		switch (cfg.dbl) {
			case "page": var l = L(); for (var i = 0; i < l.pages.length; i++) if (l.pages[i].id === cfg.dblPage) Editor.goPage(i, "user"); return;
			case "mic": return quickAction("mic");
			case "dnd": return quickAction("dnd");
			case "play": return Icue.mediaCommand("triggerPlayPause");
			case "next": return Icue.mediaCommand("triggerNextTrack");
			case "like": return Helper.act({ action: "spotify", what: "like" }).then(function (ok) { if (ok) U.toast("Liked on Spotify"); });
			case "quick": return openQuick();
			case "lock": return setLocked(true);
			case "saver": return Look.sleepNow();
		}
	}

	/* After every redraw: tile colors, selection marks. */
	function afterRender(nodes) {
		applyLook();
		var all = L().tiles.concat(L().pinned || []);
		all.forEach(function (t) {
			var n = nodes[t.id];
			if (!n) return;
			var c = t.cfg && t.cfg.color;
			n.classList.toggle("tinted", !!c);
			if (c) n.style.setProperty("--tint", c); else n.style.removeProperty("--tint");
		});
		if (selecting) paintSelection();
	}

	/* ================================================================== favourite page */
	var idleT = null;
	function idleReset() {
		clearTimeout(idleT);
		var f = O().fav;
		if (!f || !f.page || !f.min) return;
		idleT = setTimeout(function () {
			var l = L(), i = -1;
			for (var k = 0; k < l.pages.length; k++) if (l.pages[k].id === f.page) i = k;
			var gaming = Pages._auto && Pages._auto().active;
			if (i >= 0 && i !== l.current && !App.editing && !gaming && document.getElementById("modal").hidden) Editor.goPage(i, "auto");
			idleReset();
		}, f.min * 60000);
	}

	/* ================================================================== clock styles and counting numbers */
	/* Numbers that count to their new value instead of jumping (Look → Counting numbers). */
	function countTo(node, value, digits, suffix, fmt) {
		suffix = suffix || "";
		fmt = fmt || function (n) { return n.toFixed(digits || 0); };
		if (!document.body.classList.contains("count-up") || value == null || isNaN(value)) {
			node.__v = value == null || isNaN(value) ? null : +value;
			U.setText(node, value == null || isNaN(value) ? "--" : fmt(+value) + suffix);
			return;
		}
		var from = node.__v != null ? node.__v : +value;
		if (node.__to === +value) return;
		node.__to = +value;
		if (Math.abs(from - value) < 0.5 / Math.pow(10, digits || 0)) { node.__v = +value; return U.setText(node, fmt(+value) + suffix); }
		var t0 = performance.now(), dur = 450;
		cancelAnimationFrame(node.__raf);
		(function step(now) {
			var k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
			node.__v = from + (value - from) * e;
			U.setText(node, fmt(node.__v) + suffix);
			if (k < 1) node.__raf = requestAnimationFrame(step);
		})(t0);
	}

	/* ================================================================== screensavers */
	function drawSaver(s) {
		var style = O().saver || "";
		if (!style) return false;
		var now = new Date(), h = now.getHours(), m = now.getMinutes();
		var hh = Cfg.clock24h ? ("0" + h).slice(-2) : String(h % 12 || 12), mm = ("0" + m).slice(-2);
		var date = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
		var md = Icue.media || {};
		if (style === "flip") {
			s.innerHTML = '<div class="sv-flip"><div class="fl-card"><b>' + hh + '</b></div><div class="fl-card"><b>' + mm + '</b></div></div><div class="sv-flip-date">' + esc(date) + "</div>";
			return true;
		}
		if (style === "cover") {
			if (!md.song) return false;
			s.innerHTML = '<div class="sv-cover">' + (md.thumb ? '<div class="sv-cv-bg" style="background-image:url(&quot;' + esc(md.thumb) + '&quot;)"></div><img alt="" src="' + esc(md.thumb) + '" />' : '<div class="sv-cv-ph">' + svg("music") + "</div>") +
				"<div><b>" + esc(md.song) + "</b><em>" + esc(md.artist || "") + "</em><span>" + hh + ":" + mm + "</span></div></div>";
			return true;
		}
		if (style === "world") {
			s.innerHTML = '<div class="sv-world">' + worldMap() + '<div class="sv-w-time">' + hh + ":" + mm + "<small>" + esc(date) + "</small></div></div>";
			return true;
		}
		return false;
	}

	/* A world map (pictures from CARTO) with the night side shaded, worked out from where the sun is. */
	function worldMap() {
		var W = 1024, H = 512, tiles = "";
		for (var y = 0; y < 2; y++) for (var x = 0; x < 4; x++)
			tiles += '<image onerror="this.remove()" href="https://' + "abcd"[(x + y) % 4] + '.basemaps.cartocdn.com/dark_nolabels/2/' + x + "/" + (y + 1) + '.png" x="' + x * 256 + '" y="' + y * 256 + '" width="256" height="256" />';
		// Sun position (simple formulas, good to a fraction of a degree).
		var now = new Date(), day = (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - Date.UTC(now.getUTCFullYear(), 0, 0)) / 864e5;
		var decl = -23.44 * Math.cos((2 * Math.PI / 365) * (day + 10)) * Math.PI / 180;
		var hours = now.getUTCHours() + now.getUTCMinutes() / 60;
		var sunLon = (12 - hours) * 15;
		// The map shows latitudes ±66.5° (map tiles 1–2 of 4 at zoom 2): mercator y for the line between day and night.
		function yOf(lat) { var r = lat * Math.PI / 180, yy = Math.log(Math.tan(Math.PI / 4 + r / 2)); return H / 2 - (yy / Math.PI) * (H); }
		var pts = [];
		for (var lon = -180; lon <= 180; lon += 4) {
			var lat = Math.atan(-Math.cos((lon - sunLon) * Math.PI / 180) / Math.tan(decl)) * 180 / Math.PI;
			pts.push(((lon + 180) / 360 * W).toFixed(1) + "," + U.clamp(yOf(lat), -50, H + 50).toFixed(1));
		}
		var edge = decl > 0 ? H + 60 : -60;
		var night = "M" + pts.join(" L") + " L" + W + "," + edge + " L0," + edge + " Z";
		var sx = ((sunLon + 180) % 360 + 360) % 360 / 360 * W, sy = U.clamp(yOf(decl * 180 / Math.PI), 0, H);
		return '<svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="xMidYMid slice"><rect width="' + W + '" height="' + H + '" fill="#0d1520"/>' + tiles + '<path d="' + night + '" fill="rgba(0,0,20,0.55)"/><circle cx="' + sx.toFixed(0) + '" cy="' + sy.toFixed(0) + '" r="9" fill="#ffd36b"/></svg>';
	}

	/* ================================================================== the Look window */
	function chooser(sec, items, cur, fn) {
		var ch = el("div", "chips");
		items.forEach(function (it) {
			var c = el("button", "chip" + (cur === it[0] ? " on" : ""), esc(it[1]));
			c.addEventListener("click", function () { fn(it[0]); });
			ch.appendChild(c);
		});
		sec.appendChild(ch);
	}
	function toggleRow(sec, on, label, fn) {
		var b = el("button", "opt-toggle" + (on ? " on" : ""), '<span class="switch"><i></i></span><span></span>');
		b.lastChild.textContent = label;
		b.addEventListener("click", fn);
		sec.appendChild(b);
	}

	function lookWindow() {
		var wrap = el("div", "opts look-win");
		Editor.modal("Look", wrap);
		var o = O();
		function again() {
			var mb = document.getElementById("modalBody"), top = mb ? mb.scrollTop : 0;
			applyLook();
			App.render();
			lookWindow();
			if (mb) mb.scrollTop = top; // stay where you were in the window
		}
		function sec(title, hint) { var s = el("div", "opt"); s.appendChild(el("h4", "", esc(title))); if (hint) s.appendChild(el("p", "hint", esc(hint))); wrap.appendChild(s); return s; }

		var s0 = sec("Style", "Studio: the newest look, with big album covers, thick sliders and true black on the Midnight theme. Soft: the look from before. Classic: exactly like the very first panel.");
		chooser(s0, [["studio", "Studio"], ["new", "Soft"], ["classic", "Classic"]], Editor.storeGet("cpLook") || "studio", function (v) { Editor.storeSet("cpLook", v); Look.apply(); again(); });
		if (window.Studio) Studio.lookSection(sec, chooser, again);

		var s1 = sec("Theme", "For every page. A page can have its own theme in its ✏ (Pages).");
		chooser(s1, [["", "Like the iCUE setting"]].concat(THEMES.slice(1)), o.theme || "", function (v) { setOpt("theme", v); again(); });

		var s2 = sec("Size", "How big everything is. “Like iCUE” uses the Tile size setting in iCUE.");
		chooser(s2, [["", "Like iCUE"], ["compact", "Compact (more tiles)"], ["comfortable", "Comfortable"], ["large", "Large (easy to tap)"]], o.size || "", function (v) { setOpt("size", v); again(); });

		var s3 = sec("Tiles");
		chooser(s3, [["", "Normal corners"], ["round", "Rounder"], ["sharp", "Sharper"]], o.radius || "", function (v) { setOpt("radius", v); again(); });
		chooser(s3, [["", "Normal spacing"], ["tight", "Tight"], ["airy", "Airy (floating tiles)"]], o.spacing || "", function (v) { setOpt("spacing", v); again(); });
		s3.appendChild(el("p", "hint", "Give one tile its own color: hold it (not in Edit) → Tile color."));

		var s4 = sec("Background", "Your own picture or video: iCUE widget settings → Background → Picture (pick an image or an .mp4 file).");
		chooser(s4, [["", "Still"], ["gradient", "Slow color waves"], ["stars", "Stars"], ["clouds", "Clouds"]], o.bgAnim || "", function (v) { setOpt("bgAnim", v); again(); });
		toggleRow(s4, !!o.bgBlur, "Blur the background picture behind the tiles", function () { setOpt("bgBlur", !o.bgBlur); again(); });
		toggleRow(s4, !!o.wallAccent, "Accent color from the background picture", function () { setOpt("wallAccent", !o.wallAccent); again(); });
		s4.appendChild(el("p", "hint", "Moving backgrounds pause while a game page is showing."));

		var s5 = sec("Motion");
		chooser(s5, [["", "Pages slide"], ["fade", "Fade"], ["flip", "Flip"], ["none", "No animation"]], o.pageAnim || "", function (v) { setOpt("pageAnim", v); again(); });
		toggleRow(s5, !!o.countUp, "Numbers count up and down to new values (gauges, sensors, flight dashboard)", function () { setOpt("countUp", !o.countUp); again(); });
		toggleRow(s5, o.pulse !== false, "Tiles pulse softly when they need you (low fuel, bomb planted, website down, too hot…)", function () { setOpt("pulse", o.pulse === false); again(); });

		var s6 = sec("Screensaver", "When it starts: iCUE widget settings → Screensaver.");
		chooser(s6, [["", "Clock"], ["flip", "Flip clock"], ["cover", "Album cover"], ["world", "World map, day and night"]], o.saver || "", function (v) { setOpt("saver", v); again(); });

		var s7 = sec("Quick menu", "Swipe down from the top of the panel, on any page.");
		toggleRow(s7, o.quickMenu !== false, "Quick menu on", function () { setOpt("quickMenu", o.quickMenu === false); again(); });
		var items = qmItems().slice(), ch = el("div", "chips");
		QM_ITEMS.forEach(function (it) {
			var on = items.indexOf(it[0]) >= 0;
			var c = el("button", "chip" + (on ? " on" : ""), esc(it[1]));
			c.addEventListener("click", function () {
				if (on) items.splice(items.indexOf(it[0]), 1); else items.push(it[0]);
				setOpt("qmItems", items);
				again();
			});
			ch.appendChild(c);
		});
		s7.appendChild(ch);

		var s8 = sec("Lock", "Lock it from the quick menu, or a double-tap action. Unlock: hold for a second.");
		chooser(s8, [["", "Lock blocks every tap"], ["edits", "Lock only blocks editing"]], o.lockMode || "", function (v) { setOpt("lockMode", v); again(); });

		var s9 = sec("Pages");
		toggleRow(s9, !!o.edgeSwipe, "Swipe from the very left / right edge to jump to the first / last page", function () { setOpt("edgeSwipe", !o.edgeSwipe); again(); });
		var fav = o.fav || {};
		s9.appendChild(el("p", "hint", "Favourite page: comes back by itself when you haven't touched the panel for a while (not during a game)."));
		chooser(s9, [[0, "Off"], [2, "After 2 min"], [5, "5 min"], [10, "10 min"], [30, "30 min"]], fav.min || 0, function (v) {
			setOpt("fav", { page: fav.page || (L().pages[0] && L().pages[0].id), min: v });
			idleReset();
			again();
		});
		if (fav.min) chooser(s9, L().pages.map(function (p) { return [p.id, p.name]; }), fav.page, function (v) { setOpt("fav", { page: v, min: fav.min }); idleReset(); again(); });
		if (window.Round10) Round10.lookSection(sec, chooser, toggleRow, again);
		if (window.Popout && Popout.lookSection) Popout.lookSection(sec, toggleRow, again);
	}

	/* ================================================================== wiring */
	function wire() {
		// Edit tools: Look and Select buttons.
		var tools = document.getElementById("editTools"), pagesBtn = document.getElementById("pagesBtn");
		var lookBtn = el("button", "pill", "Look");
		lookBtn.type = "button";
		lookBtn.id = "lookBtn";
		lookBtn.addEventListener("click", lookWindow);
		var selBtn = el("button", "pill", "Select");
		selBtn.type = "button";
		selBtn.id = "selBtn";
		selBtn.addEventListener("click", function () { selecting ? stopSelect() : startSelect(); });
		tools.insertBefore(selBtn, pagesBtn);
		tools.insertBefore(lookBtn, pagesBtn);

		// Swipe down from the top edge: quick menu.
		var qs = null;
		document.addEventListener("pointerdown", function (e) {
			qs = null;
			if (O().quickMenu === false || App.editing || e.clientY > Math.max(26, window.innerHeight * 0.05)) return;
			if (e.target.closest(".modal, .drawer, .qm, .nb")) return;
			qs = { y: e.clientY, x: e.clientX };
		}, true);
		document.addEventListener("pointermove", function (e) {
			if (!qs) return;
			if (e.clientY - qs.y > 45 && Math.abs(e.clientX - qs.x) < 60) { qs = null; openQuick(); }
		}, true);
		document.addEventListener("pointerup", function () { qs = null; }, true);

		// Taps while picking several tiles; double-taps.
		var lastTap = { id: null, at: 0 };
		document.getElementById("board").addEventListener("click", function (e) {
			var node = e.target.closest(".tile");
			if (!node) return;
			var t = Editor.tileOf(node);
			if (!t) return;
			if (selecting) {
				e.stopPropagation();
				e.preventDefault();
				if (L().tiles.indexOf(t) < 0) return U.toast("Tiles on every page can't be picked here");
				if (selected[t.id]) delete selected[t.id]; else selected[t.id] = true;
				return paintSelection();
			}
			if (App.editing || !t.cfg || !t.cfg.dbl) return;
			var now = Date.now();
			if (lastTap.id === t.id && now - lastTap.at < 320) {
				e.stopPropagation();
				e.preventDefault();
				lastTap = { id: null, at: 0 };
				return runDbl(t);
			}
			lastTap = { id: t.id, at: now };
		}, true);

		document.addEventListener("pointerdown", idleReset, true);
		idleReset();
	}

	return {
		THEMES: THEMES,
		applyLook: applyLook,
		afterRender: afterRender,
		offerUndo: offerUndo,
		tileSheet: tileSheet,
		selecting: function () { return selecting; },
		stopSelect: stopSelect,
		locked: locked,
		lockedAll: lockedAll,
		setLocked: setLocked,
		openQuick: openQuick,
		drawSaver: drawSaver,
		countTo: countTo,
		lookWindow: lookWindow,
		wire: wire,
	};
})();
