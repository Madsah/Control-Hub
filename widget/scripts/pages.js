/* Control Panel — pages (manage, automatic pages) and backup / restore of the layout. */

var Pages = (function () {
	var el = U.el, svg = U.svg, esc = U.esc;
	var NAMES = ["Home", "Gaming", "Flight sim", "Streaming", "Music", "Work", "Apps", "System"];
	var PRESETS = [
		{ exe: "flightsimulator2024.exe", name: "Microsoft Flight Simulator 2024" },
		{ exe: "flightsimulator.exe", name: "Microsoft Flight Simulator 2020" },
		{ exe: "cs2.exe", name: "Counter-Strike 2" },
		{ exe: "obs64.exe", name: "OBS Studio" },
		{ exe: "spotify.exe", name: "Spotify" },
		{ exe: "discord.exe", name: "Discord" },
	];

	function L() { return Editor.layout(); }
	function indexOfId(id) {
		var p = L().pages;
		for (var i = 0; i < p.length; i++) if (p[i].id === id) return i;
		return -1;
	}

	/* ------------------------------------------------------------------ automatic pages */
	var auto = { active: null, returnTo: null, seen: {}, goneSince: 0, last: [], recheck: null, lastRun: {}, savedAt: 0, first: true };
	var GRACE = 3000; // a game that restarts itself (launcher → game) doesn't make the page jump back and forth
	var autoLoaded = false;

	/* Which page a game opened, and where to go back to, survive the widget being reloaded
	   (iCUE can reload it while a game runs, e.g. when it switches profiles for the game). */
	function saveAuto() { Editor.storeSet("cpAuto", auto.active ? { active: auto.active, returnTo: auto.returnTo } : null); }
	function loadAuto() {
		if (autoLoaded) return;
		autoLoaded = true;
		var a = Editor.storeGet("cpAuto");
		if (a && indexOfId(a.active) >= 0) { auto.active = a.active; auto.returnTo = a.returnTo; }
		auto.lastRun = Editor.storeGet("cpLastRun") || {};
	}
	/* Where to go back to when nothing else is known: the first page that doesn't open by itself. */
	function homeId() {
		var pages = L().pages;
		for (var i = 0; i < pages.length; i++) if (!pages[i].auto) return pages[i].id;
		return pages[0] ? pages[0].id : null;
	}

	/* Program names the helper should look for (only asked when at least one page has a rule). */
	function watchList() {
		var out = [];
		L().pages.forEach(function (p) {
			if (p.auto && p.auto.exe && out.indexOf(p.auto.exe) < 0) out.push(p.auto.exe);
		});
		return out;
	}

	function onRunning(list) {
		loadAuto();
		auto.last = list || [];
		var running = {};
		(list || []).forEach(function (x) { running[String(x).toLowerCase()] = true; });
		var pages = L().pages, now = Date.now();
		// Only a real start counts: not a program that was already running when the panel started (or was
		// reloaded by iCUE while you play), and not a short hiccup in the list of running programs.
		var started = {};
		if (!auto.first)
			Object.keys(running).forEach(function (exe) {
				if (!auto.seen[exe] && !(auto.lastRun[exe] && now - auto.lastRun[exe] < 6000)) started[exe] = true;
			});
		auto.first = false;
		var changed = Object.keys(running).join() !== Object.keys(auto.seen).join();
		Object.keys(running).forEach(function (exe) { auto.lastRun[exe] = now; });
		if (changed || now - auto.savedAt > 20000) {
			auto.savedAt = now;
			Object.keys(auto.lastRun).forEach(function (exe) { if (now - auto.lastRun[exe] > 86400000) delete auto.lastRun[exe]; });
			Editor.storeSet("cpLastRun", auto.lastRun);
		}
		if (!App.editing) {
			// An app that just started: show its page.
			for (var i = 0; i < pages.length; i++) {
				var a = pages[i].auto;
				if (a && started[a.exe]) {
					if (auto.active !== pages[i].id) {
						// Already on the game's page (e.g. you left it there): still go back home when the game closes.
						if (!auto.active) auto.returnTo = L().current !== i ? pages[L().current].id : homeId();
						auto.active = pages[i].id;
						saveAuto();
						if (L().current !== i) {
							if (typeof Look !== "undefined") Look.wake();
							Editor.goPage(i, "auto");
						}
					}
					break;
				}
			}
			// The app closed: go back to where you were, unless you moved on yourself.
			if (auto.active) {
				var k = indexOfId(auto.active), p = pages[k];
				if (!p || !p.auto || !running[p.auto.exe]) {
					if (!auto.goneSince) auto.goneSince = Date.now();
					if (p && p.auto && Date.now() - auto.goneSince < GRACE) {
						clearTimeout(auto.recheck);
						auto.recheck = setTimeout(function () { onRunning(auto.last); }, GRACE - (Date.now() - auto.goneSince) + 50);
					} else {
						var back = indexOfId(auto.returnTo);
						if (back < 0) back = indexOfId(homeId());
						if (p && p.auto && p.auto.back !== false && L().current === k && back >= 0 && back !== k) Editor.goPage(back, "auto");
						auto.active = null;
						auto.returnTo = null;
						auto.goneSince = 0;
						saveAuto();
					}
				} else auto.goneSince = 0;
			}
		}
		auto.seen = running;
	}

	/* Ready-made tiles for a game page (you can change them afterwards). */
	var SUGGEST = {
		"cs2.exe": [["cs2score", 3, 1], ["cs2stats", 3, 2], ["cs2weapon", 2, 2], ["cs2bomb", 2, 1], ["cs2kills", 1, 1], ["discord", 3, 2], ["appvol", 1, 2, { app: "discord", vertical: true }]],
		"flightsimulator2024.exe": [["fdash", 4, 2], ["simbrief", 3, 2], ["metar", 3, 1], ["sayintentions", 3, 2], ["radio", 2, 1], ["ftimer", 2, 1], ["flightmap", 3, 2]],
	};
	SUGGEST["flightsimulator.exe"] = SUGGEST["flightsimulator2024.exe"];
	function fillPage(p, exe) {
		var plan = SUGGEST[exe];
		if (!plan) return 0;
		var keep = L().current, i = indexOfId(p.id), n = 0;
		Editor.usePage(i);
		plan.forEach(function (x) {
			if (!T.types[x[0]]) return;
			var t = Editor.makeTile(x[0], x[1], x[2], x[3] ? JSON.parse(JSON.stringify(x[3])) : null);
			if (Editor.place(t)) { L().tiles.push(t); n++; }
		});
		Editor.usePage(keep);
		return n;
	}

	function onPageShown(how) {
		if (typeof Round8 !== "undefined") Round8.applyLook();
		App.refreshNeeds();
	}

	/* ------------------------------------------------------------------ page manager */
	function manage() {
		var wrap = el("div", "opts pages-man");
		Editor.modal("Pages", wrap);
		var lay = L();
		var list = el("div", "page-list");
		lay.pages.forEach(function (p, i) {
			var row = el("div", "page-row" + (i === lay.current ? " on" : ""));
			row.innerHTML =
				'<button class="page-go"><b></b><em></em></button>' +
				'<button class="ch-mini" data-a="up" aria-label="Move up">' + svg("up") + "</button>" +
				'<button class="ch-mini" data-a="down" aria-label="Move down">' + svg("down") + "</button>" +
				'<button class="ch-mini" data-a="edit" aria-label="Edit">' + svg("pencil") + "</button>" +
				'<button class="ch-mini" data-a="dup" aria-label="Copy page">' + svg("copy") + "</button>" +
				'<button class="ch-mini danger" data-a="del" aria-label="Delete">' + svg("x") + "</button>";
			row.querySelector("b").textContent = p.name;
			row.querySelector("em").textContent = p.tiles.length + (p.tiles.length === 1 ? " tile" : " tiles") + (p.auto ? (p.auto.phase ? " · during " : " · opens with ") + p.auto.name : "") +
				({ small: " · Small tiles", medium: " · Medium tiles", large: " · Large tiles", huge: " · Extra large tiles" }[p.size] || "");
			row.querySelector('[data-a="up"]').disabled = i === 0;
			row.querySelector('[data-a="down"]').disabled = i === lay.pages.length - 1;
			row.querySelector('[data-a="del"]').disabled = lay.pages.length < 2;
			row.querySelector(".page-go").addEventListener("click", function () {
				Editor.goPage(i, "user");
				manage();
			});
			row.addEventListener("click", function (e) {
				var b = e.target.closest("[data-a]");
				if (!b || b.disabled) return;
				var a = b.dataset.a, cur = lay.pages[lay.current];
				if (a === "up" || a === "down") {
					var j = a === "up" ? i - 1 : i + 1;
					lay.pages.splice(j, 0, lay.pages.splice(i, 1)[0]);
					Editor.usePage(lay.pages.indexOf(cur));
					Editor.save();
					App.render();
					manage();
				} else if (a === "edit") editPage(p);
				else if (a === "dup") {
					copyPage(p);
					manage();
				}
				else if (a === "del") {
					var go = function () {
						Editor.pushUndo("Deleted the page " + p.name);
						lay.pages.splice(i, 1);
						Editor.usePage(Math.min(lay.pages.indexOf(cur) >= 0 ? lay.pages.indexOf(cur) : i, lay.pages.length - 1));
						Editor.save();
						App.render();
						manage();
					};
					if (!p.tiles.length) go();
					else Editor.confirm({ title: "Delete page?", text: "Delete “" + p.name + "” and its " + p.tiles.length + " tiles?", ok: "Delete", icon: "x", danger: true }, go);
				}
			});
			list.appendChild(row);
		});
		wrap.appendChild(list);

		var add = el("button", "pill accent page-add", svg("plus") + " Add page");
		add.addEventListener("click", function () {
			pickTemplate(); // empty page, ready-made pages, your templates, or a page from a file
		});
		wrap.appendChild(add);
		wrap.appendChild(el("p", "hint", "Swipe left or right on the screen to change page, or tap the dots at the bottom. While editing, drag a tile onto a dot to move it to that page."));

		// Backup
		var sec = el("div", "opt");
		sec.appendChild(el("h4", "", "Backup"));
		var info = el("p", "hint", "");
		var last = lastBackupAt();
		info.textContent = Helper.online
			? "Your layout is copied to your PC a few seconds after every change (and put back by itself if iCUE ever loses it). A dated backup is kept every few hours." + (last ? " Last backup: " + when(last) + "." : "")
			: "Backups need Control Hub running on your PC.";
		sec.appendChild(info);
		var btns = el("div", "chips");
		var now = el("button", "pill", "Back up now");
		var res = el("button", "pill", "Restore…");
		now.disabled = res.disabled = !Helper.online;
		now.addEventListener("click", function () {
			backup(false).then(function (ok) {
				U.toast(ok ? "Layout backed up" : "Backup didn't work");
				if (ok) manage();
			});
		});
		res.addEventListener("click", restoreList);
		btns.appendChild(now);
		btns.appendChild(res);
		sec.appendChild(btns);
		var files = el("div", "chips");
		var exp = el("button", "pill", svg("down") + " Save to a file…");
		var imp = el("button", "pill", svg("up") + " Open a file…");
		exp.disabled = imp.disabled = !Helper.online;
		exp.addEventListener("click", exportFile);
		imp.addEventListener("click", importFile);
		files.appendChild(exp);
		files.appendChild(imp);
		sec.appendChild(files);
		sec.appendChild(el("p", "hint", "A file you can keep anywhere (USB stick, cloud folder). The save window opens on your main screen."));
		wrap.appendChild(sec);
		var lk = el("p", "hint", "Themes, size, backgrounds, quick menu, lock and more: Edit → <b>Look</b>.");
		wrap.appendChild(lk);
		notifSettings(wrap);
	}

	/* A new page, empty or from one of your templates. */
	function newPage(tpl) {
		var lay = L();
		var used = lay.pages.map(function (p) { return p.name; });
		var name = tpl ? tpl.name : NAMES.filter(function (n) { return used.indexOf(n) < 0; })[0] || "Page " + (lay.pages.length + 1);
		var p = Editor.addPage(name);
		if (tpl) {
			var keep = lay.current;
			if (tpl.size) p.size = tpl.size;
			Editor.usePage(lay.pages.length - 1);
			var g = Editor.gridInfo();
			// Made for another grid (a page file): stretch to this page's grid.
			var src = tpl.grid && tpl.grid.cols && (tpl.grid.cols !== g.cols || tpl.grid.rows !== g.rows) && typeof Round10 !== "undefined"
				? Round10.fit(tpl.tiles || [], tpl.grid.cols, tpl.grid.rows) : tpl.tiles || [];
			if (p.size) p.sig = g.cols + "x" + g.rows;
			src.forEach(function (t) {
				var c = Editor.cloneTile(t);
				// Keep the template's arrangement where it fits this screen; otherwise the first free spot.
				if (!(c.x != null && c.x < 9999 && Editor.free(c)) && !Editor.place(c)) { c.x = 9999; c.y = 9999; }
				lay.tiles.push(c);
			});
			p.theme = tpl.theme || "";
			if (tpl.auto) p.auto = JSON.parse(JSON.stringify(tpl.auto));
			Editor.usePage(keep);
		}
		Editor.save();
		Editor.goPage(lay.pages.length - 1, "user");
		editPage(p, true);
	}

	function pickTemplate() {
		var lay = L();
		var wrap = el("div", "opts");
		Editor.modal("New page", wrap, manage);
		var rows = el("div", "opt-list");
		function row(label, sub, fn, del) {
			var b = el("div", "opt-row tpl-row", "<span><b></b><em></em></span>");
			b.querySelector("b").textContent = label;
			b.querySelector("em").textContent = sub;
			b.addEventListener("click", function (e) { if (!e.target.closest(".tpl-del")) fn(); });
			if (del) {
				var x = el("button", "ch-mini danger tpl-del", svg("x"));
				x.addEventListener("click", function (e) { e.stopPropagation(); del(); });
				b.appendChild(x);
			}
			rows.appendChild(b);
		}
		function heading(t) { rows.appendChild(el("h5", "tpl-h", esc(t))); }
		row("Empty page", "Start from nothing", function () { newPage(null); });
		row("Open a page from a file", "A page someone shared, or one you saved", function () { importPage(); });
		// Ready-made pages, by topic.
		var ready = [];
		if (window.Round9) Round9.presets().forEach(function (t) { ready.push({ group: "Start here", t: t }); });
		if (window.Round8b) Round8b.builtinTemplates().forEach(function (t) { ready.push({ group: "Music", t: t }); });
		if (window.Round10) Round10.presets().forEach(function (t) { ready.push({ group: t.group, t: t }); });
		var order = ["Start here", "Black", "My Home", "Flight sim", "Games", "Music", "Everyday", "PC"];
		order.forEach(function (g) {
			var items = ready.filter(function (r) { return r.group === g; });
			if (!items.length) return;
			heading(g);
			items.forEach(function (r) { row(r.t.name, r.t.sub, function () { newPage(Editor.withGrid("", function () { return r.t.make(); })); }); });
		});
		if ((lay.templates || []).length) heading("Your templates");
		(lay.templates || []).forEach(function (t, i) {
			row(t.name, (t.tiles || []).length + " tiles · your template", function () { newPage(t); }, function () {
				lay.templates.splice(i, 1);
				Editor.save();
				pickTemplate();
			});
		});
		wrap.appendChild(rows);
		wrap.appendChild(el("p", "hint", "Save any page as a template in its ✏ (Edit page)."));
	}

	/* An exact copy of a page, with new tiles (the copy doesn't open by itself for a program). */
	function copyPage(p) {
		var lay = L();
		var c = Editor.addPage((p.name + " copy").slice(0, 24));
		c.theme = p.theme || "";
		if (p.size) { c.size = p.size; c.sig = p.sig || ""; }
		var keep = lay.current;
		Editor.usePage(lay.pages.length - 1);
		p.tiles.forEach(function (t) { lay.tiles.push(Editor.cloneTile(t)); });
		Editor.usePage(keep);
		Editor.save();
		App.render();
		U.toast("Copied " + p.name);
	}

	/* Rename a page and choose the program that opens it automatically. */
	function editPage(p, isNew) {
		var work = { name: p.name, auto: p.auto ? JSON.parse(JSON.stringify(p.auto)) : null };
		var wrap = el("div", "opts page-edit");
		Editor.modal(isNew ? "New page" : "Edit page", wrap, manage);
		var running = null;

		function draw() {
			wrap.innerHTML = "";
			var s1 = el("div", "opt");
			s1.appendChild(el("h4", "", "Name"));
			var input = el("input", "search");
			input.maxLength = 24;
			input.value = work.name;
			input.addEventListener("input", function () { work.name = input.value; });
			s1.appendChild(input);
			var chips = el("div", "chips");
			NAMES.forEach(function (n) {
				var c = el("button", "chip" + (n === work.name ? " on" : ""), esc(n));
				c.addEventListener("click", function () { work.name = n; draw(); });
				chips.appendChild(c);
			});
			s1.appendChild(chips);
			wrap.appendChild(s1);

			var s2 = el("div", "opt");
			s2.appendChild(el("h4", "", "Show this page automatically"));
			s2.appendChild(el("p", "hint", Helper.online
				? "When the program starts, the panel jumps to this page."
				: "Needs Control Hub running on your PC."));
			var rows = el("div", "opt-list");
			function row(label, sub, value, iconId) {
				var on = value ? work.auto && work.auto.exe === value.exe : !work.auto;
				var b = el("button", "opt-row" + (on ? " on" : ""));
				b.innerHTML = '<span class="src-check">' + svg("check") + "</span>" + (iconId ? '<img class="row-ic" alt="" />' : "") + "<span><b></b><em></em></span>";
				b.querySelector("b").textContent = label;
				b.querySelector("em").textContent = sub || "";
				if (iconId) {
					var img = b.querySelector("img");
					img.onerror = function () { img.remove(); };
					img.src = Helper.iconUrl(iconId);
				}
				b.addEventListener("click", function () {
					work.auto = value ? { exe: value.exe, name: value.name, back: work.auto ? work.auto.back !== false : true } : null;
					draw();
				});
				rows.appendChild(b);
			}
			row("Off", "Only when I swipe to it", null);
			var shown = {};
			if (work.auto && work.auto.exe) shown[work.auto.exe] = true;
			if (work.auto && work.auto.exe && !PRESETS.some(function (x) { return x.exe === work.auto.exe; })) row(work.auto.name, work.auto.exe, work.auto);
			PRESETS.forEach(function (x) { shown[x.exe] = true; row(x.name, x.exe, x); });
			(running || []).forEach(function (w) {
				if (shown[w.exe]) return;
				shown[w.exe] = true;
				row(w.name, w.exe + " · running now", { exe: w.exe, name: w.name }, w.icon);
			});
			s2.appendChild(rows);
			if (running === null && Helper.online) s2.appendChild(el("p", "hint", "Looking for open programs…"));

			var own = el("div", "pick-bar");
			var exe = el("input", "search");
			exe.placeholder = "Or type the program, e.g. game.exe";
			var use = el("button", "pill", "Use");
			use.addEventListener("click", function () {
				var v = exe.value.trim().toLowerCase().replace(/^.*[\\\/]/, "");
				if (!v) return;
				if (!/\.exe$/.test(v)) v += ".exe";
				if (!/^[a-z0-9 _.\-()+]{1,80}$/.test(v)) return U.toast("That doesn't look like a program name");
				work.auto = { exe: v, name: v.replace(/\.exe$/, ""), back: true };
				draw();
			});
			own.appendChild(exe);
			own.appendChild(use);
			s2.appendChild(own);

			if (work.auto && work.auto.exe && SUGGEST[work.auto.exe] && !p.tiles.length) {
				var fill = work.fill !== false;
				var fg = el("button", "opt-toggle" + (fill ? " on" : ""), '<span class="switch"><i></i></span><span>Fill this page with suggested tiles (you can change them after)</span>');
				fg.addEventListener("click", function () { work.fill = !fill; draw(); });
				s2.appendChild(fg);
			}
			if (work.auto && work.auto.exe) {
				var back = work.auto.back !== false;
				var tg = el("button", "opt-toggle" + (back ? " on" : ""), '<span class="switch"><i></i></span><span>Go back to the page I was on when it closes</span>');
				tg.addEventListener("click", function () { work.auto.back = !back; draw(); });
				s2.appendChild(tg);
			}
			wrap.appendChild(s2);

			// MSFS: show this page in a flight phase (taxi, takeoff, cruise, approach).
			if (typeof Flight !== "undefined") {
				var s3 = el("div", "opt");
				s3.appendChild(el("h4", "", "Or during a flight phase (MSFS 2024)"));
				var ch = el("div", "chips");
				Flight.PHASE_CHOICES.forEach(function (pc) {
					var on = work.auto && work.auto.phase === pc[0];
					var c = el("button", "chip" + (on ? " on" : ""), esc(pc[1]));
					c.addEventListener("click", function () {
						work.auto = on ? null : { phase: pc[0], name: pc[1] };
						draw();
					});
					ch.appendChild(c);
				});
				s3.appendChild(ch);
				s3.appendChild(el("p", "hint", "The panel switches to this page when the flight gets to that phase."));
				wrap.appendChild(s3);
			}

			if (typeof Round8 !== "undefined") {
				var s4 = el("div", "opt");
				s4.appendChild(el("h4", "", "Look of this page"));
				var tch = el("div", "chips");
				Round8.THEMES.forEach(function (th) {
					var on = (work.theme === undefined ? p.theme || "" : work.theme) === th[0];
					var c = el("button", "chip" + (on ? " on" : ""), esc(th[1]));
					c.addEventListener("click", function () { work.theme = th[0]; draw(); });
					tch.appendChild(c);
				});
				s4.appendChild(tch);
				s4.appendChild(el("p", "hint", "“Same as all pages” uses the theme from Look. Pick one here to give just this page its own colors."));
				s4.appendChild(el("h4", "", "Tile size for this page"));
				var sch = el("div", "chips");
				var curSize = work.size === undefined ? p.size || "" : work.size;
				[["", "Same as all pages"], ["small", "Small"], ["medium", "Medium"], ["large", "Large"], ["huge", "Extra large"]].forEach(function (z) {
					var gz = Editor.calcGrid(z[0]);
					var c = el("button", "chip" + (curSize === z[0] ? " on" : ""), esc(z[1]) + (z[0] ? " <em>" + gz.cols + "×" + gz.rows + "</em>" : ""));
					c.addEventListener("click", function () { work.size = z[0]; draw(); });
					sch.appendChild(c);
				});
				s4.appendChild(sch);
				s4.appendChild(el("p", "hint", "Give just this page bigger or smaller tiles, e.g. a big Home page while the rest stay Medium. The tiles are stretched to fit; fine-tune in Edit."));
				var tpl = el("button", "pill", svg("star") + " Save this page as a template");
				tpl.addEventListener("click", function () {
					var lay = L();
					lay.templates = lay.templates || [];
					lay.templates.push({ name: (work.name || p.name || "Template").trim().slice(0, 24), theme: work.theme === undefined ? p.theme || "" : work.theme, size: p.size || "", tiles: JSON.parse(JSON.stringify(p.tiles)) });
					if (lay.templates.length > 20) lay.templates.shift();
					Editor.save();
					U.toast("Saved as a template. Add page → pick it");
				});
				s4.appendChild(tpl);
				var fill = el("button", "pill", svg("resize") + " Stretch tiles to fill the screen");
				fill.addEventListener("click", function () {
					var shown = p.tiles.filter(function (t) { return t.x < 9999; });
					var g = Editor.calcGrid(Editor.pageSize(p)), mx = 0, my = 0;
					shown.forEach(function (t) { mx = Math.max(mx, t.x + t.w); my = Math.max(my, t.y + t.h); });
					if (!shown.length || (mx >= g.cols && my >= g.rows)) return U.toast("This page already fills the screen");
					Editor.pushUndo && Editor.pushUndo("Stretched " + p.name);
					var out = Editor.withGrid(Editor.pageSize(p), function () { return Round10.fit(shown, mx, my); });
					shown.forEach(function (t, i) { t.x = out[i].x; t.y = out[i].y; t.w = out[i].w; t.h = out[i].h; });
					Editor.save();
					App.render();
					U.toast("Stretched " + p.name + " to fill the screen");
				});
				s4.appendChild(fill);
				var share = el("button", "pill", svg("copy") + " Save this page to a file");
				share.addEventListener("click", function () { exportPage(p); });
				s4.appendChild(share);
				s4.appendChild(el("p", "hint", "A page file can be opened on another panel: Pages → + → Open a page from a file."));
				wrap.appendChild(s4);
			}

			var save = el("button", "pill accent save-btn", "Save");
			save.addEventListener("click", function () {
				if (work.theme !== undefined) p.theme = work.theme;
				if (work.size !== undefined) Editor.setPageSize(p, work.size);
				p.name = (work.name || "").trim().slice(0, 24) || "Page";
				p.auto = work.auto;
				if (work.auto && work.auto.exe && work.fill !== false && !p.tiles.length) {
					var n = fillPage(p, work.auto.exe);
					if (n) U.toast("Added " + n + " tiles to " + p.name);
				}
				Editor.save();
				App.render();
				manage();
			});
			wrap.appendChild(save);
		}
		draw();
		if (Helper.online)
			Helper.fetch("/api/windows", { cache: "no-store" }, 6000).then(function (r) {
				running = r && r.windows ? r.windows : [];
				if (wrap.isConnected) draw();
			}, function () {
				running = [];
				if (wrap.isConnected) draw();
			});
	}

	/* ------------------------------------------------------------------ backup / restore */
	function storeGet(key) {
		try {
			var raw = localStorage.getItem(U.getProp("uniqueId", "") || "control-panel-preview");
			var store = raw ? JSON.parse(raw) || {} : {};
			return store[key];
		} catch (e) { return null; }
	}
	function storeSet(key, val) {
		try {
			var k = String(U.getProp("uniqueId", "") || "control-panel-preview");
			var raw = localStorage.getItem(k);
			var store = raw ? JSON.parse(raw) || {} : {};
			store[key] = val;
			localStorage.setItem(k, JSON.stringify(store));
		} catch (e) {}
	}
	function lastBackupAt() { return +storeGet("cpBackupAt") || 0; }

	function when(t) {
		var d = new Date(t), now = new Date();
		var hm = (d.getHours() < 10 ? "0" : "") + d.getHours() + ":" + (d.getMinutes() < 10 ? "0" : "") + d.getMinutes();
		if (d.toDateString() === now.toDateString()) return "today " + hm;
		var y = new Date(now.getTime() - 86400000);
		if (d.toDateString() === y.toDateString()) return "yesterday " + hm;
		return d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) + " " + hm;
	}

	function snapshot() {
		var lay = L();
		return { v: 2, pages: lay.pages, current: lay.current, next: lay.next, sig: lay.sig, savedAt: lay.savedAt || Date.now(), pinned: lay.pinned || [], templates: lay.templates || [], opts: lay.opts || {} };
	}

	function backup(isAuto, label) {
		var snap = snapshot(), count = 0;
		snap.pages.forEach(function (pg) { count += pg.tiles.length; });
		return Helper.fetch("/api/backup", {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-Control-Panel": "1" },
			body: JSON.stringify({ kind: isAuto ? "auto" : label || "manual", pages: snap.pages.length, tiles: count, layout: JSON.stringify(snap) }),
		}, 6000).then(function (r) {
			if (r && r.ok) {
				storeSet("cpBackupAt", Date.now());
				return true;
			}
			return false;
		}, function () { return false; });
	}

	/* After the layout is saved: a copy goes to the helper a few seconds later (restored by itself if iCUE
	   ever loses the layout), and a dated backup is kept every few hours of changes. */
	var autoTimer = null, liveTimer = null, liveReady = false, restoreAsked = false;
	function afterSave() {
		clearTimeout(autoTimer);
		clearTimeout(liveTimer);
		liveTimer = setTimeout(pushLive, 3000);
		autoTimer = setTimeout(function () {
			if (Helper.online && !App.editing && Date.now() - lastBackupAt() > 3 * 3600 * 1000) backup(true);
		}, 8000);
	}
	/* Helper 2.0 and newer keep the live copy (older ones would file it as a normal backup). */
	function liveSupported() {
		var v = String(Helper.state.version || "");
		var m = /^(\d+)\./.exec(v);
		return m ? +m[1] >= 2 : v === "mock";
	}
	var lastPushed = "";
	function pushLive() {
		if (!liveReady || !Helper.online || !liveSupported()) return;
		var snap = snapshot(), count = 0;
		// Only showing another page: nothing worth sending (the layout itself is the same).
		var key = JSON.stringify([snap.pages, snap.pinned, snap.templates, snap.opts, snap.next]);
		if (key === lastPushed) return;
		lastPushed = key;
		snap.pages.forEach(function (pg) { count += pg.tiles.length; });
		Helper.fetch("/api/backup", {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-Control-Panel": "1" },
			body: JSON.stringify({ kind: "live", pages: snap.pages.length, tiles: count, layout: JSON.stringify(snap) }),
		}, 6000).then(function () {}, function () { lastPushed = ""; });
	}
	/* Called when the helper answers. A new / emptied widget takes the layout the helper kept. */
	function onHelper() {
		if (restoreAsked) return;
		restoreAsked = true;
		if (!Editor.fresh) {
			// iCUE keeps a separate copy of the widget for each iCUE profile (games can switch profiles). If another
			// copy changed the layout more recently, use that one, so every profile shows the same pages.
			if (!liveSupported()) { liveReady = true; return; }
			Helper.fetch("/api/backup?name=live", { cache: "no-store" }, 6000).then(function (r) {
				var cp = null;
				try { cp = r && r.ok ? JSON.parse(r.layout) : null; } catch (e) {}
				var mine = Editor.loadedAt || 0;
				if (cp && Array.isArray(cp.pages) && cp.savedAt && cp.savedAt > mine + 2000 && Editor.adopt(cp)) {
					Editor.save();
					App.render();
				}
				liveReady = true;
				pushLive();
			}, function () { restoreAsked = false; });
			return;
		}
		Helper.fetch("/api/backup?name=live", { cache: "no-store" }, 6000).then(function (r) {
			var cp = null;
			try { cp = r && r.ok ? JSON.parse(r.layout) : null; } catch (e) {}
			var count = 0;
			if (cp && Array.isArray(cp.pages)) cp.pages.forEach(function (pg) { count += (pg.tiles || []).length; });
			Editor.fresh = false;
			liveReady = true;
			if (cp && count && Editor.adopt(cp)) {
				Editor.save();
				App.render();
				U.toast("Your layout is back (kept safe on your PC)");
			} else pushLive(); // nothing kept yet: start keeping this one
		}, function () {
			// Couldn't ask: try again on the next answer from the helper (never overwrite the kept copy blindly).
			restoreAsked = false;
		});
	}


	function exportFile() {
		var snap = snapshot();
		U.toast("Choose where to save it on your main screen");
		Helper.fetch("/api/layoutfile", {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-Control-Panel": "1" },
			body: JSON.stringify({ layout: JSON.stringify(snap) }),
		}, 300000).then(function (r) {
			if (r && r.ok && r.file) U.toast("Saved " + r.file);
			else if (!r || !r.ok) U.toast("Couldn't save the file");
		}, function () { U.toast("Couldn't save the file"); });
	}

	/* Share one page: save it to a file, open it on another panel. */
	function exportPage(p) {
		U.toast("Choose where to save it on your main screen");
		var gi = Editor.calcGrid(Editor.pageSize(p));
		var data = { controlPanelPage: 1, page: { name: p.name, theme: p.theme || "", size: p.size || "", grid: { cols: gi.cols, rows: gi.rows }, tiles: JSON.parse(JSON.stringify(p.tiles)) } };
		Helper.fetch("/api/layoutfile", {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-Control-Panel": "1" },
			body: JSON.stringify({ layout: JSON.stringify(data), pageName: p.name }),
		}, 300000).then(function (r) {
			if (r && r.ok && r.file) U.toast("Saved " + r.file);
			else if (!r || !r.ok) U.toast("Couldn't save the file");
		}, function () { U.toast(Helper.online ? "Couldn't save the file" : "Start Control Hub for this"); });
	}

	function importPage() {
		if (!Helper.online) return U.toast("Start Control Hub for this");
		U.toast("Pick the file on your main screen");
		Helper.fetch("/api/layoutfile", { cache: "no-store", headers: { "X-Control-Panel": "1" } }, 300000).then(function (r) {
			if (r && r.ok && !r.layout) return;
			var d = null;
			try { d = JSON.parse(r.layout); } catch (e) {}
			function known(t) { return t && T.types[t.type]; }
			if (d && d.controlPanelPage && d.page && Array.isArray(d.page.tiles)) {
				var tpl = { name: String(d.page.name || "Page").slice(0, 24), theme: d.page.theme || "", size: d.page.size || "", grid: d.page.grid || d.grid, tiles: d.page.tiles.filter(known) };
				newPage(tpl);
				return U.toast("Added the page " + tpl.name);
			}
			// A whole layout file: pick one of its pages.
			if (d && Array.isArray(d.pages)) {
				var w = el("div", "opt-list");
				d.pages.forEach(function (pg) {
					var b = el("button", "opt-row", "<span><b></b><em></em></span>");
					b.querySelector("b").textContent = pg.name || "Page";
					b.querySelector("em").textContent = (pg.tiles || []).length + " tiles";
					b.addEventListener("click", function () { newPage({ name: String(pg.name || "Page").slice(0, 24), theme: pg.theme || "", size: pg.size || "", grid: pg.grid || d.grid, tiles: (pg.tiles || []).filter(known) }); });
					w.appendChild(b);
				});
				Editor.modal("Which page do you want?", w, manage);
				return;
			}
			U.toast("That isn't a Control Panel page file");
		}, function () { U.toast("Couldn't open the file"); });
	}

	function importFile() {
		U.toast("Pick the file on your main screen");
		Helper.fetch("/api/layoutfile", { cache: "no-store", headers: { "X-Control-Panel": "1" } }, 300000).then(function (r) {
			if (r && r.ok && !r.layout) return; // closed without picking a file
			if (!r || !r.ok) return U.toast("That isn't a Control Panel layout file");
			var cp = null;
			try { cp = JSON.parse(r.layout); } catch (e) {}
			if (!cp || !Array.isArray(cp.pages)) return U.toast("That isn't a Control Panel layout file");
			if (cp.controlPanelPages) return U.toast("That's a file with ready-made pages. Use Pages → Add page → Open a page from a file");
			Editor.confirm({ title: "Use this layout?", text: "Your current layout is replaced with the one in " + r.file + ". A copy of the current one is kept, just in case.", ok: "Use it", icon: "back" }, function () {
				backup(false, "before-restore").then(function () {
					Editor.pushUndo("Opened a layout file");
					if (!Editor.adopt(cp)) return U.toast("That file didn't work");
					Editor.save();
					App.render();
					U.toast("Layout loaded");
				});
			});
		}, function () { U.toast("Couldn't open the file"); });
	}

	/* New look or Classic look (exactly how it looked before Round 7). */
	function lookSettings(wrap) {
		var sec = el("div", "opt");
		sec.appendChild(el("h4", "", "Look"));
		var cur = Editor.storeGet("cpLook") || "studio";
		var ch = el("div", "chips");
		[["studio", "Studio"], ["new", "Soft"], ["classic", "Classic"]].forEach(function (o) {
			var on = o[0] === cur;
			var c = el("button", "chip" + (on ? " on" : ""), esc(o[1]));
			c.addEventListener("click", function () {
				Editor.storeSet("cpLook", o[0]);
				Look.apply();
				manage();
			});
			ch.appendChild(c);
		});
		sec.appendChild(ch);
		sec.appendChild(el("p", "hint", "Studio: the newest look, with big album covers, thick sliders and true black on the Midnight theme. Soft: softer light and shadows. Classic: exactly like the very first panel. Your tiles and pages stay the same either way."));
		wrap.appendChild(sec);
	}

	/* Notification banners: on/off, quiet while taking off and landing, apps you blocked. */
	function notifSettings(wrap) {
		if (typeof Round7 === "undefined") return;
		var n = Round7.notifCfg();
		var sec = el("div", "opt");
		sec.appendChild(el("h4", "", "Notification banners"));
		sec.appendChild(el("p", "hint", Helper.online ? "New Windows notifications slide down from the top of the panel. Tap one to open the app, swipe it up to hide it, hold it to stop that app." : "Needs Control Hub running on your PC."));
		function toggle(key, label) {
			var on = !!n[key];
			var b = el("button", "opt-toggle" + (on ? " on" : ""), '<span class="switch"><i></i></span><span></span>');
			b.lastChild.textContent = label;
			b.addEventListener("click", function () { n[key] = !on; Round7.setNotifCfg(n); manage(); });
			sec.appendChild(b);
		}
		toggle("on", "Show banners");
		toggle("quietFlight", "Quiet during takeoff and landing (MSFS)");
		toggle("quietCs2", "Quiet during a CS2 round");
		var ch = el("div", "chips");
		[5, 8, 12].forEach(function (s) {
			var c = el("button", "chip" + ((n.secs || 8) === s ? " on" : ""), s + " seconds");
			c.addEventListener("click", function () { n.secs = s; Round7.setNotifCfg(n); manage(); });
			ch.appendChild(c);
		});
		sec.appendChild(ch);
		if ((n.blocked || []).length) {
			sec.appendChild(el("p", "hint", "Not shown (tap to allow again):"));
			var bl = el("div", "chips");
			n.blocked.forEach(function (b) {
				var c = el("button", "chip", esc(b.name) + " ✕");
				c.addEventListener("click", function () { n.blocked = n.blocked.filter(function (x) { return x.key !== b.key; }); Round7.setNotifCfg(n); manage(); });
				bl.appendChild(c);
			});
			sec.appendChild(bl);
		}
		var t = el("button", "pill", "Send a test banner");
		t.addEventListener("click", function () { Editor.closeModal(); Round7.testBanner(); });
		sec.appendChild(t);
		wrap.appendChild(sec);
	}

	function restoreList() {
		var wrap = el("div", "opts");
		Editor.modal("Restore a backup", wrap, manage);
		wrap.innerHTML = '<p class="hint">Loading backups…</p>';
		Helper.fetch("/api/backups", { cache: "no-store" }, 5000).then(function (r) {
			var list = (r && r.backups) || [];
			wrap.innerHTML = "";
			if (!list.length) return wrap.appendChild(el("p", "hint", "No backups yet."));
			var rows = el("div", "opt-list");
			list.forEach(function (b) {
				var row = el("button", "opt-row");
				row.innerHTML = "<span><b></b><em></em></span>";
				row.querySelector("b").textContent = when(b.time) + (b.kind === "auto" ? "" : b.kind === "before-restore" ? " · before a restore" : " · saved by you");
				row.querySelector("em").textContent = (b.pages ? b.pages + (b.pages === 1 ? " page, " : " pages, ") : "") + (b.tiles || 0) + " tiles";
				row.addEventListener("click", function () { restore(b); });
				rows.appendChild(row);
			});
			wrap.appendChild(rows);
			wrap.appendChild(el("p", "hint", "Backups are in Control Hub's backups folder (Control Hub → Panel → Open backups folder)."));
		}, function () {
			wrap.innerHTML = '<p class="hint">Couldn\'t reach Control Hub.</p>';
		});
	}

	function restore(b) {
		Editor.confirm({ title: "Restore this backup?", text: "Your current layout is replaced with the backup from " + when(b.time) + ". A copy of the current one is kept, just in case.", ok: "Restore", icon: "back" }, function () {
			Helper.fetch("/api/backup?name=" + encodeURIComponent(b.name), { cache: "no-store" }, 5000).then(function (r) {
				var cp = null;
				try { cp = JSON.parse(r.layout); } catch (e) {}
				if (!cp) throw new Error("bad");
				return backup(false, "before-restore").then(function () {
					Editor.pushUndo("Restored a backup");
					if (!Editor.adopt(cp)) throw new Error("bad");
					Editor.save();
					App.render();
					U.toast("Layout restored");
				});
			}).catch(function () { U.toast("Couldn't restore that backup"); });
		});
	}

	return {
		manage: manage,
		watchList: watchList,
		onRunning: onRunning,
		onPageShown: onPageShown,
		afterSave: afterSave,
		backup: backup,
		onHelper: onHelper,
		_auto: function () { return auto; },
		SUGGEST: SUGGEST,
	};
})();
