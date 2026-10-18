/* Control Panel — grid, layout storage and on-screen editing
 * (drag to move, drag the corner to resize, ✕ / ✏ / ⧉, Add-a-tile panel, folders).
 */

var Editor = (function () {
	var el = U.el, svg = U.svg, esc = U.esc;
	/* Layout: several pages, each with its own tiles. L.tiles always points at the page on screen. */
	var L = { pages: [], current: 0, tiles: [], next: 1, sig: "", pinned: [], templates: [], opts: {} };
	var grid = { cols: 8, rows: 3, cellW: 100, cellH: 100, gap: 8, padX: 12, padTop: 12 };
	var hidden = [];
	var nodes = {}; // tile id -> node

	/* ------------------------------------------------------------------ storage */
	function storeKey() {
		var id = U.getProp("uniqueId", "");
		return id ? String(id) : "control-panel-preview";
	}

	function save() {
		try {
			var raw = localStorage.getItem(storeKey());
			var store = raw ? JSON.parse(raw) || {} : {};
			L.savedAt = Date.now();
			store.cp = { v: 2, pages: L.pages, current: L.current, next: L.next, sig: L.sig, savedAt: L.savedAt, pinned: L.pinned, templates: L.templates, opts: L.opts };
			localStorage.setItem(storeKey(), JSON.stringify(store));
		} catch (e) {}
		if (typeof Pages !== "undefined") Pages.afterSave();
	}

	function storeGet(key) {
		try {
			var raw = localStorage.getItem(storeKey());
			return ((raw && JSON.parse(raw)) || {})[key];
		} catch (e) { return null; }
	}

	function storeSet(key, val) {
		try {
			var raw = localStorage.getItem(storeKey());
			var store = (raw && JSON.parse(raw)) || {};
			store[key] = val;
			localStorage.setItem(storeKey(), JSON.stringify(store));
		} catch (e) {}
	}

	function usePage(i) {
		if (!L.pages.length) L.pages.push({ id: "p" + L.next++, name: "Home", auto: null, tiles: [] });
		L.current = U.clamp(i | 0, 0, L.pages.length - 1);
		L.tiles = L.pages[L.current].tiles;
		// A page can have its own tile size (Pages → page → Tile size), so the grid follows the page.
		if (grid) grid = calcGrid(pageSize());
	}

	/* Read a stored layout (also used by restore). Old single-page layouts become page "Home". */
	function adopt(cp) {
		if (!cp) return false;
		var pages = null;
		if (Array.isArray(cp.pages)) pages = cp.pages;
		else if (Array.isArray(cp.tiles)) pages = [{ id: "p0", name: "Home", tiles: cp.tiles }];
		if (!pages) return false;
		pages = pages.filter(function (p) { return p && Array.isArray(p.tiles); }).map(function (p, i) {
			return {
				id: String(p.id || "p" + i),
				name: String(p.name || "Page " + (i + 1)).slice(0, 24),
				auto: p.auto && p.auto.exe ? { exe: String(p.auto.exe).toLowerCase(), name: String(p.auto.name || p.auto.exe), back: p.auto.back !== false }
					: p.auto && p.auto.phase ? { phase: String(p.auto.phase), name: String(p.auto.name || p.auto.phase) } : null,
				theme: p.theme ? String(p.theme) : "",
				size: PAGE_SCALE[p.size] ? String(p.size) : "",
				sig: p.size && p.sig ? String(p.sig) : "",
				tiles: p.tiles.filter(function (t) { return t && T.types[t.type]; }),
			};
		});
		if (!pages.length) return false;
		var count = 0;
		pages.forEach(function (p) { count += p.tiles.length; });
		var pinned = Array.isArray(cp.pinned) ? cp.pinned.filter(function (t) { return t && T.types[t.type]; }) : [];
		L = { pages: pages, current: 0, tiles: [], next: Math.max(cp.next || 0, count + pinned.length + pages.length + 1), sig: cp.sig || "", savedAt: +cp.savedAt || 0,
			pinned: pinned, templates: Array.isArray(cp.templates) ? cp.templates : [], opts: cp.opts && typeof cp.opts === "object" ? cp.opts : {} };
		usePage(cp.current || 0);
		return true;
	}

	function load() {
		try {
			var raw = localStorage.getItem(storeKey());
			var store = raw ? JSON.parse(raw) || {} : {};
			if (adopt(store.cp)) return true;
		} catch (e) {}
		return false;
	}

	function newId() {
		return "t" + L.next++;
	}

	function makeTile(type, w, h, cfg) {
		var def = T.types[type];
		return {
			id: newId(), type: type, x: 0, y: 0,
			w: w || def.w, h: h || def.h,
			cfg: cfg || (def.defaults ? def.defaults() : {}),
		};
	}

	/* ------------------------------------------------------------------ grid geometry */
	/* Tile size for a single page: same names as iCUE's tile size setting. "" = like all pages. */
	var PAGE_SCALE = { small: 1.0, medium: 1.3, large: 1.6, huge: 2.0 };
	function pageSize(p) {
		p = p || (L && L.pages && L.pages[L.current]);
		return p && PAGE_SCALE[p.size] ? p.size : "";
	}
	function scaleFor(size) { return PAGE_SCALE[size] || uiScale(); }

	function computeGrid() {
		var s = scaleFor(pageSize());
		document.documentElement.style.setProperty("--ui", String(s));
		grid = calcGrid(pageSize());
		var r = document.documentElement.style;
		r.setProperty("--cell", Math.min(grid.cellW, grid.cellH).toFixed(1) + "px");
		r.setProperty("--gap", grid.gap + "px");
		r.setProperty("--pad", grid.padX + "px");
	}

	/* The grid a page of this size gets on this screen (nothing is changed). */
	function calcGrid(size) {
		var W = window.innerWidth || 840, H = window.innerHeight || 344;
		var s = scaleFor(size);
		var space = { tight: 0.55, airy: 1.6 }[L.opts.spacing] || 1;
		var pad = Math.round(U.clamp(Math.min(W, H) * 0.03, 8, 16) * Math.min(s, 1.6));
		var gap = Math.round(U.clamp(Math.min(W, H) * 0.012, 6, 10) * Math.min(s, 1.6) * space);
		var reserve = Cfg.showEditButton ? Math.round(26 * s) : 0;
		var availH = H - 2 * pad - reserve;
		var rows = U.clamp(Math.round((availH + gap) / (100 * s + gap)), availH >= 220 ? 2 : 1, 24);
		var cellH = (availH - (rows - 1) * gap) / rows;
		var cols = U.clamp(Math.floor((W - 2 * pad + gap) / (cellH + gap)), 1, 40);
		var cellW = (W - 2 * pad - (cols - 1) * gap) / cols;
		return { cols: cols, rows: rows, cellW: cellW, cellH: cellH, gap: gap, padX: pad, padTop: pad + reserve };
	}

	/* The size the layout was last arranged for: the page's own (if it has a tile size), else the panel's. */
	function sigOf(p) { return pageSize(p) ? p.sig || "" : L.sig; }
	function setSig(p, sig) { if (pageSize(p)) p.sig = sig; else L.sig = sig; }

	/* Size of everything: the iCUE setting, unless Look → Size says otherwise. */
	function uiScale() {
		var o = { compact: 1.15, comfortable: 1.6, large: 2.0 }[L.opts.size];
		return o || Cfg.scale || 2;
	}

	function rectOf(x, y, w, h) {
		return {
			left: grid.padX + x * (grid.cellW + grid.gap),
			top: grid.padTop + y * (grid.cellH + grid.gap),
			width: w * grid.cellW + (w - 1) * grid.gap,
			height: h * grid.cellH + (h - 1) * grid.gap,
		};
	}

	function fits(x, y, w, h) {
		return x >= 0 && y >= 0 && x + w <= grid.cols && y + h <= grid.rows;
	}

	function overlaps(x, y, w, h, ignoreId) {
		var all = L.pinned && L.pinned.length ? L.tiles.concat(L.pinned) : L.tiles;
		for (var i = 0; i < all.length; i++) {
			var t = all[i];
			if (t.id === ignoreId || !fits(t.x, t.y, t.w, t.h)) continue;
			if (x < t.x + t.w && x + w > t.x && y < t.y + t.h && y + h > t.y) return true;
		}
		return false;
	}

	function findSpot(w, h, ignoreId) {
		for (var y = 0; y + h <= grid.rows; y++)
			for (var x = 0; x + w <= grid.cols; x++)
				if (!overlaps(x, y, w, h, ignoreId)) return { x: x, y: y };
		return null;
	}

	/* Place a tile at its preferred size, or smaller if the screen is full. */
	function place(tile) {
		var def = T.types[tile.type];
		var sizes = [[tile.w, tile.h], [Math.min(tile.w, 2), Math.min(tile.h, 2)], [def.minW, def.minH]];
		for (var i = 0; i < sizes.length; i++) {
			var w = Math.min(sizes[i][0], grid.cols), h = Math.min(sizes[i][1], grid.rows);
			if (w < def.minW || h < def.minH) continue;
			var spot = findSpot(w, h, tile.id);
			if (spot) {
				tile.x = spot.x; tile.y = spot.y; tile.w = w; tile.h = h;
				return true;
			}
		}
		return false;
	}

	/* ------------------------------------------------------------------ default layout */
	function defaultLayout() {
		L = { pages: [], current: 0, tiles: [], next: 1, sig: "", pinned: [], templates: [], opts: {} };
		usePage(0);
		var plan = [
			["media", 3, 2],
			["speakers", 2, 1],
			["mic", 2, 1],
			["folder", 1, 1, { name: "Desk tools", children: [
				{ type: "shortcut", w: 1, h: 1, cfg: { kind: "quick", what: "desktop", name: "Desktop" } },
				{ type: "shortcut", w: 1, h: 1, cfg: { kind: "quick", what: "screenshot", name: "Screenshot" } },
				{ type: "shortcut", w: 1, h: 1, cfg: { kind: "quick", what: "taskmanager", name: "Task Manager" } },
				{ type: "shortcut", w: 1, h: 1, cfg: { kind: "quick", what: "settings", name: "Settings" } },
			] }],
			["mixer", 3, 3],
			["gauge", 2, 1],
			["power", 2, 2],
			["network", 2, 1],
			["clock", 2, 1],
			["keepawake", 1, 1],
			["shortcut", 1, 1, { kind: "quick", what: "explorer", name: "File Explorer" }],
			["storage", 3, 2],
			["battery", 2, 1],
			["sensors", 2, 2],
			["fps", 1, 1],
		];
		plan.forEach(function (p) {
			var t = makeTile(p[0], p[1], p[2], p[3]);
			if (t.cfg && t.cfg.children) t.cfg.children.forEach(function (c) { c.id = newId(); });
			if (place(t)) L.tiles.push(t);
		});
		L.sig = grid.cols + "x" + grid.rows;
		save();
	}

	/* ------------------------------------------------------------------ rendering */
	var board, updaters = [];

	/* When the grid changes (tile size or widget size changed), lay the tiles out again in the same order. */
	function repack() {
		var keep = L.current;
		L.pages.forEach(function (p, i) {
			usePage(i);
			var order = L.tiles.slice().sort(function (a, b) { return a.y - b.y || a.x - b.x; });
			L.tiles.forEach(function (t) { t.x = 9999; t.y = 9999; });
			order.forEach(function (t) {
				if (!place(t)) { t.x = 9999; t.y = 9999; }
			});
		});
		usePage(keep);
	}

	/* When the screen has another grid size than the one the layout was made for (L.sig), the tiles are only SHOWN
	   moved (view), never saved that way. So a short odd size while Windows starts can't scramble the layout:
	   when the size is back, everything is exactly where you put it. The new size is only taken over when you edit. */
	var view = null;
	function pos(t) { return (view && view[t.id]) || t; }

	/* Where each tile goes in the current grid: its own spot if that still fits, else the nearest free one. */
	function arrange(tiles, pinned) {
		var out = {}, occ = [];
		function free(x, y, w, h) {
			if (x < 0 || y < 0 || x + w > grid.cols || y + h > grid.rows) return false;
			for (var yy = y; yy < y + h; yy++) for (var xx = x; xx < x + w; xx++) if (occ[yy * 100 + xx]) return false;
			return true;
		}
		function take(id, x, y, w, h) {
			for (var yy = y; yy < y + h; yy++) for (var xx = x; xx < x + w; xx++) occ[yy * 100 + xx] = true;
			out[id] = { x: x, y: y, w: w, h: h };
		}
		var all = (pinned || []).concat(tiles.slice().sort(function (a, b) { return a.y - b.y || a.x - b.x; }));
		var later = [];
		all.forEach(function (t) {
			if (t.x < 9999 && free(t.x, t.y, t.w, t.h)) take(t.id, t.x, t.y, t.w, t.h);
			else later.push(t);
		});
		later.forEach(function (t) {
			var def = T.types[t.type] || { minW: 1, minH: 1 };
			if (t.x >= 9999) { out[t.id] = { x: 9999, y: 9999, w: t.w, h: t.h }; return; }
			var sizes = [[t.w, t.h], [Math.min(t.w, grid.cols), Math.min(t.h, grid.rows)], [Math.min(t.w, 2), Math.min(t.h, 2)], [def.minW, def.minH]];
			for (var i = 0; i < sizes.length; i++) {
				var w = Math.max(def.minW || 1, sizes[i][0]), h = Math.max(def.minH || 1, sizes[i][1]);
				// The free spot closest to where the tile was.
				var best = null, bestD = 1e9;
				for (var y = 0; y + h <= grid.rows; y++)
					for (var x = 0; x + w <= grid.cols; x++)
						if (free(x, y, w, h)) { var d = Math.abs(x - t.x) + Math.abs(y - t.y) * 2; if (d < bestD) { bestD = d; best = { x: x, y: y }; } }
				if (best) { take(t.id, best.x, best.y, w, h); return; }
			}
			out[t.id] = { x: 9999, y: 9999, w: t.w, h: t.h };
		});
		return out;
	}

	/* Take over the current grid size for good (when you start editing at that size). */
	function adoptGrid() {
		var sig = grid.cols + "x" + grid.rows, cur = L.pages[L.current], own = pageSize(cur), old = sigOf(cur);
		if (!old || old === sig) { setSig(cur, sig); return false; }
		var keep = L.current;
		// Only pages that use this same grid: a page with its own tile size only changes itself.
		L.pages.forEach(function (p, i) {
			if (own ? i !== keep : pageSize(p)) return;
			usePage(i);
			var a = arrange(L.tiles, !own && i === keep ? L.pinned : null);
			L.tiles.forEach(function (t) { var q = a[t.id]; if (q) { t.x = q.x; t.y = q.y; t.w = q.w; t.h = q.h; } });
		});
		usePage(keep);
		if (!own) {
			var ap = arrange([], L.pinned);
			(L.pinned || []).forEach(function (t) { var q = ap[t.id]; if (q) { t.x = q.x; t.y = q.y; t.w = q.w; t.h = q.h; } });
		}
		setSig(cur, sig);
		view = null;
		save();
		return true;
	}

	function render() {
		board = board || document.getElementById("board");
		computeGrid();
		var sig = grid.cols + "x" + grid.rows, cur = L.pages[L.current], own = pageSize(cur);
		if (!sigOf(cur)) { setSig(cur, sig); save(); }
		if (sigOf(cur) !== sig) {
			if (App.editing) { adoptGrid(); view = null; }
			else view = arrange(L.tiles, own ? null : L.pinned);
		} else view = null;
		board.innerHTML = "";
		nodes = {};
		updaters = [];
		hidden = [];
		L.tiles.forEach(function (t) {
			var q = pos(t);
			if (!fits(q.x, q.y, q.w, q.h)) {
				hidden.push(t);
				return;
			}
			var node = buildTile(t, rectOf(q.x, q.y, q.w, q.h), board, q);
			nodes[t.id] = node;
			if (App.editing) addChrome(node, t);
		});
		// Tiles shown on every page. On a page with its own tile size they only show where there's room.
		var taken = null;
		if (own) {
			taken = {};
			L.tiles.forEach(function (t) { var q = pos(t); for (var yy = q.y; yy < q.y + q.h; yy++) for (var xx = q.x; xx < q.x + q.w; xx++) taken[xx + "," + yy] = 1; });
		}
		(L.pinned || []).forEach(function (t) {
			var q = pos(t);
			if (!fits(q.x, q.y, q.w, q.h)) return;
			if (taken) { for (var yy = q.y; yy < q.y + q.h; yy++) for (var xx = q.x; xx < q.x + q.w; xx++) if (taken[xx + "," + yy]) return; }
			var node = buildTile(t, rectOf(q.x, q.y, q.w, q.h), board, q);
			node.classList.add("pinned");
			nodes[t.id] = node;
			if (App.editing) addPinnedChrome(node, t);
		});
		if (typeof Round8 !== "undefined") Round8.afterRender(nodes);
		var hb = document.getElementById("hiddenBtn");
		hb.hidden = !App.editing || !hidden.length;
		hb.textContent = "Hidden (" + hidden.length + ")";
		if (folderOpen) renderFolder();
		renderDots();
	}

	/* ------------------------------------------------------------------ pages: dots + swipe */
	function renderDots() {
		var box = document.getElementById("dots");
		if (!box) return;
		box.innerHTML = "";
		box.hidden = L.pages.length < 2 && !App.editing;
		function fill(named) {
			box.innerHTML = "";
			box.classList.toggle("named", named);
			L.pages.forEach(function (p, i) {
				var d = el("button", "dot" + (i === L.current ? " on" : ""));
				d.dataset.page = i;
				d.setAttribute("aria-label", p.name);
				if (named) d.appendChild(el("span", "dot-name", esc(p.name)));
				box.appendChild(d);
			});
		}
		fill(App.editing);
		// While editing, page names go top left, unless they would run into the buttons on the right.
		if (App.editing) {
			var tools = document.getElementById("editTools").getBoundingClientRect();
			if (box.getBoundingClientRect().right > tools.left - 8) fill(false);
		}
	}

	/* Show another page. how: "user" (swipe/dot), "auto" (an app started/stopped). */
	function goPage(i, how) {
		i = U.clamp(i | 0, 0, L.pages.length - 1);
		if (i === L.current) return;
		var dir = i > L.current ? 1 : -1;
		usePage(i);
		save();
		App.render();
		var b = document.getElementById("board");
		b.classList.remove("slide-l", "slide-r");
		void b.offsetWidth;
		b.classList.add(dir > 0 ? "slide-l" : "slide-r");
		if (typeof Pages !== "undefined") Pages.onPageShown(how);
	}

	function pageAtPoint(cx, cy) {
		var dots = document.querySelectorAll("#dots .dot");
		for (var i = 0; i < dots.length; i++) {
			var r = dots[i].getBoundingClientRect();
			var pad = 14;
			if (cx > r.left - pad && cx < r.right + pad && cy > r.top - pad && cy < r.bottom + pad) return +dots[i].dataset.page;
		}
		return -1;
	}

	function moveToPage(t, i) {
		if (i === L.current) return;
		var from = L.current;
		L.tiles.splice(L.tiles.indexOf(t), 1);
		usePage(i);
		var ok = place(t);
		if (!ok) { t.x = 9999; t.y = 9999; }
		L.tiles.push(t);
		usePage(from);
		save();
		render();
		App.refreshNeeds();
		U.toast("Moved to " + L.pages[i].name + (ok ? "" : " (under Hidden, no free space there)"));
	}

	function buildTile(t, rect, parent, size) {
		var def = T.types[t.type];
		var node = el("div", "tile t-" + t.type);
		node.style.left = rect.left + "px";
		node.style.top = rect.top + "px";
		node.style.width = rect.width + "px";
		node.style.height = rect.height + "px";
		node.style.setProperty("--u", Math.min(rect.width, rect.height).toFixed(1) + "px");
		var sw = size ? size.w : t.w, shh = size ? size.h : t.h;
		node.dataset.w = sw;
		node.dataset.h = shh;
		var body = el("div", "tile-in");
		node.appendChild(body);
		parent.appendChild(node);
		var ctx = { node: node, body: body, tile: t, w: sw, h: shh };
		try {
			var upd = def.build(ctx);
			if (typeof upd === "function") {
				updaters.push(upd);
				upd();
			}
		} catch (e) {
			body.innerHTML = '<div class="notice"><b>Tile error</b><span>' + esc(e.message) + "</span></div>";
		}
		return node;
	}

	function updateAll() {
		// Screensaver on, or iCUE has the panel hidden: nothing to draw (and nothing to ask the helper for).
		if ((typeof Look !== "undefined" && Look.sleeping) || document.hidden) return;
		for (var i = 0; i < updaters.length; i++) {
			try { updaters[i](); } catch (e) {}
		}
	}

	/* Tiles currently on screen (for deciding what to ask the helper / iCUE for). */
	function visibleTiles() {
		var list = L.tiles.concat(L.pinned || []).filter(function (t) { var q = pos(t); return fits(q.x, q.y, q.w, q.h); });
		if (folderOpen) list = list.concat(folderOpen.cfg.children || []);
		return list;
	}

	/* ------------------------------------------------------------------ edit chrome */
	function addChrome(node, t) {
		var def = T.types[t.type];
		node.classList.add("editable");
		var bar = el("div", "chrome");
		bar.innerHTML =
			'<button class="ch ch-x" data-a="del" aria-label="Remove">' + svg("x") + "</button>" +
			((def.editable || def.options || def.edit) ? '<button class="ch ch-edit" data-a="edit" aria-label="Edit">' + svg("pencil") + "</button>" : "") +
			'<button class="ch ch-copy" data-a="copy" aria-label="Duplicate">' + svg("copy") + "</button>" +
			'<span class="ch ch-size" data-a="resize" aria-label="Resize">' + svg("resize") + "</span>";
		node.appendChild(bar);
		bar.addEventListener("click", function (e) {
			var b = e.target.closest("[data-a]");
			if (!b) return;
			e.stopPropagation();
			var a = b.dataset.a;
			if (a === "del") removeTile(t);
			else if (a === "edit") editTile(t);
			else if (a === "copy") duplicate(t);
		});
		bar.querySelector(".ch-size").addEventListener("pointerdown", function (e) {
			startResize(e, node, t);
		});
		node.addEventListener("pointerdown", function (e) {
			if (e.target.closest(".chrome")) return;
			startDrag(e, node, t);
		});
	}

	/* Tiles on every page: remove, or put back on this page only. */
	function addPinnedChrome(node, t) {
		node.classList.add("editable");
		var bar = el("div", "chrome");
		bar.innerHTML = '<button class="ch ch-x" data-a="del" aria-label="Remove">' + svg("x") + '</button><button class="ch ch-copy" data-a="unpin" aria-label="Only on this page">' + svg("pages") + "</button>";
		node.appendChild(bar);
		bar.addEventListener("click", function (e) {
			var b = e.target.closest("[data-a]");
			if (!b) return;
			e.stopPropagation();
			pushUndo("Removed " + titleOf(t));
			L.pinned.splice(L.pinned.indexOf(t), 1);
			if (b.dataset.a === "unpin") { L.tiles.push(t); U.toast(titleOf(t) + " is now only on this page"); }
			save();
			render();
			App.refreshNeeds();
		});
	}

	/* Show a tile on every page (needs the same free spot on every page). */
	function pinTile(t) {
		var i = L.tiles.indexOf(t);
		if (i < 0) return false;
		var keep = L.current, ok = true;
		L.tiles.splice(i, 1);
		function freeEverywhere(x, y) {
			for (var p = 0; p < L.pages.length; p++) {
				usePage(p);
				if (overlaps(x, y, t.w, t.h, t.id)) return false;
			}
			return true;
		}
		var spot = freeEverywhere(t.x, t.y) ? { x: t.x, y: t.y } : null;
		for (var y = 0; !spot && y + t.h <= grid.rows; y++)
			for (var x = 0; !spot && x + t.w <= grid.cols; x++) if (freeEverywhere(x, y)) spot = { x: x, y: y };
		usePage(keep);
		if (!spot) { L.tiles.splice(i, 0, t); ok = false; }
		else { pushUndo("Pinned " + titleOf(t)); t.x = spot.x; t.y = spot.y; L.pinned.push(t); }
		save();
		render();
		return ok;
	}

	/* ------------------------------------------------------------------ undo */
	var undoStack = [];
	function pushUndo(label) {
		undoStack.push({ label: label, cp: JSON.stringify({ v: 2, pages: L.pages, current: L.current, next: L.next, sig: L.sig, pinned: L.pinned, templates: L.templates, opts: L.opts }) });
		if (undoStack.length > 15) undoStack.shift();
		if (typeof Round8 !== "undefined") Round8.offerUndo(label);
	}
	function undo() {
		var u = undoStack.pop();
		if (!u) return false;
		var cur = L.current;
		if (!adopt(JSON.parse(u.cp))) return false;
		usePage(Math.min(cur, L.pages.length - 1));
		save();
		render();
		App.refreshNeeds();
		return true;
	}

	function removeTile(t) {
		var i = L.tiles.indexOf(t);
		if (i < 0) return;
		pushUndo("Removed " + titleOf(t));
		L.tiles.splice(i, 1);
		lastRemoved = { tile: t, index: i };
		save();
		render();
		App.refreshNeeds();
		if (typeof Round8 === "undefined") U.toast("Removed " + titleOf(t) + "");
	}
	var lastRemoved = null;

	function titleOf(t) {
		if (t.type === "shortcut" && t.cfg && t.cfg.name) return t.cfg.name;
		if (t.type === "folder" && t.cfg && t.cfg.name) return t.cfg.name;
		return T.types[t.type].name;
	}

	function cloneTile(t) {
		var c = JSON.parse(JSON.stringify(t));
		c.id = newId();
		if (c.cfg && c.cfg.children) c.cfg.children.forEach(function (k) { k.id = newId(); });
		return c;
	}

	function duplicate(t) {
		var c = cloneTile(t);
		if (!place(c)) return U.toast("No free space for a copy");
		L.tiles.push(c);
		save();
		render();
	}

	/* ------------------------------------------------------------------ drag to move */
	var ghost = null;

	function showGhost(x, y, w, h, ok) {
		if (!ghost) {
			ghost = el("div", "ghost");
			board.appendChild(ghost);
		}
		var r = rectOf(x, y, w, h);
		ghost.style.left = r.left + "px";
		ghost.style.top = r.top + "px";
		ghost.style.width = r.width + "px";
		ghost.style.height = r.height + "px";
		ghost.classList.toggle("bad", !ok);
	}

	function hideGhost() {
		if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
		ghost = null;
	}

	function startDrag(e, node, t) {
		if (!App.editing || (typeof Round8 !== "undefined" && Round8.selecting())) return;
		var sx = e.clientX, sy = e.clientY, moved = false, target = null, folderTarget = null, pageTarget = -1;
		var base = rectOf(t.x, t.y, t.w, t.h);
		node.setPointerCapture(e.pointerId);
		function move(ev) {
			var dx = ev.clientX - sx, dy = ev.clientY - sy;
			if (!moved && Math.abs(dx) + Math.abs(dy) < 8) return;
			moved = true;
			node.classList.add("dragging");
			node.style.transform = "translate(" + dx + "px," + dy + "px)";
			var nx = Math.round((base.left + dx - grid.padX) / (grid.cellW + grid.gap));
			var ny = Math.round((base.top + dy - grid.padTop) / (grid.cellH + grid.gap));
			nx = U.clamp(nx, 0, grid.cols - t.w);
			ny = U.clamp(ny, 0, grid.rows - t.h);
			// Dropping onto a folder puts the tile inside it.
			folderTarget = null;
			if (t.type !== "folder") {
				var hit = folderAt(ev.clientX, ev.clientY, t.id);
				if (hit) folderTarget = hit;
			}
			Object.keys(nodes).forEach(function (id) { nodes[id].classList.toggle("drop-into", folderTarget && folderTarget.id === id); });
			pageTarget = pageAtPoint(ev.clientX, ev.clientY);
			if (pageTarget === L.current) pageTarget = -1;
			document.querySelectorAll("#dots .dot").forEach(function (d) { d.classList.toggle("drop-into", +d.dataset.page === pageTarget); });
			var ok = !overlaps(nx, ny, t.w, t.h, t.id);
			target = { x: nx, y: ny, ok: ok };
			if (folderTarget || pageTarget >= 0) hideGhost();
			else showGhost(nx, ny, t.w, t.h, ok);
		}
		function up() {
			node.removeEventListener("pointermove", move);
			node.removeEventListener("pointerup", up);
			node.removeEventListener("pointercancel", up);
			hideGhost();
			if (!moved) return;
			if (pageTarget >= 0) {
				node.style.transform = "";
				return moveToPage(t, pageTarget);
			}
			if (folderTarget) {
				folderTarget.cfg = folderTarget.cfg || {};
				folderTarget.cfg.children = folderTarget.cfg.children || [];
				L.tiles.splice(L.tiles.indexOf(t), 1);
				folderTarget.cfg.children.push({ id: t.id, type: t.type, w: Math.min(t.w, 4), h: t.h, cfg: t.cfg });
				U.toast("Moved into " + (folderTarget.cfg.name || "folder"));
			} else if (target && target.ok) {
				t.x = target.x;
				t.y = target.y;
			}
			save();
			render();
		}
		node.addEventListener("pointermove", move);
		node.addEventListener("pointerup", up);
		node.addEventListener("pointercancel", up);
	}

	function tileOf(node) {
		for (var id in nodes) if (nodes[id] === node) {
			var all = L.tiles.concat(L.pinned || []);
			for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
		}
		return null;
	}

	function folderAt(cx, cy, exceptId) {
		for (var i = 0; i < L.tiles.length; i++) {
			var t = L.tiles[i];
			if (t.type !== "folder" || t.id === exceptId || !nodes[t.id]) continue;
			var r = nodes[t.id].getBoundingClientRect();
			if (cx > r.left && cx < r.right && cy > r.top && cy < r.bottom) return t;
		}
		return null;
	}

	/* ------------------------------------------------------------------ drag the corner to resize */
	function startResize(e, node, t) {
		if (!App.editing) return;
		e.stopPropagation();
		e.preventDefault();
		var def = T.types[t.type];
		var handle = e.currentTarget;
		var base = rectOf(t.x, t.y, t.w, t.h);
		var sx = e.clientX, sy = e.clientY, result = null;
		handle.setPointerCapture(e.pointerId);
		node.classList.add("resizing");
		function move(ev) {
			var w = Math.round((base.width + ev.clientX - sx + grid.gap) / (grid.cellW + grid.gap));
			var h = Math.round((base.height + ev.clientY - sy + grid.gap) / (grid.cellH + grid.gap));
			w = U.clamp(w, def.minW, Math.min(def.maxW, grid.cols - t.x));
			h = U.clamp(h, def.minH, Math.min(def.maxH, grid.rows - t.y));
			var ok = !overlaps(t.x, t.y, w, h, t.id);
			result = { w: w, h: h, ok: ok };
			showGhost(t.x, t.y, w, h, ok);
		}
		function up() {
			handle.removeEventListener("pointermove", move);
			handle.removeEventListener("pointerup", up);
			handle.removeEventListener("pointercancel", up);
			node.classList.remove("resizing");
			hideGhost();
			if (result && result.ok && (result.w !== t.w || result.h !== t.h)) {
				t.w = result.w;
				t.h = result.h;
				save();
				render();
			} else if (result && !result.ok) U.toast("Something is in the way");
		}
		handle.addEventListener("pointermove", move);
		handle.addEventListener("pointerup", up);
		handle.addEventListener("pointercancel", up);
	}

	/* ------------------------------------------------------------------ Add-a-tile drawer */
	function openDrawer() {
		var body = document.getElementById("drawerBody");
		body.innerHTML = "";
		// Search box: type a few letters to find a tile.
		var search = el("input", "search dr-search");
		search.type = "search";
		search.placeholder = "Search tiles, e.g. volume, CS2, weather";
		body.appendChild(search);
		var results = el("div", "dr-grid dr-results");
		results.hidden = true;
		body.appendChild(results);
		search.addEventListener("input", function () {
			var q = search.value.trim().toLowerCase();
			body.querySelectorAll(".dr-group").forEach(function (g) { g.hidden = !!q; });
			results.hidden = !q;
			results.innerHTML = "";
			if (!q) return;
			Object.keys(T.types).filter(function (k) {
				var d = T.types[k];
				return (d.name + " " + d.desc + " " + k).toLowerCase().indexOf(q) >= 0;
			}).forEach(function (k) { results.appendChild(item(k)); });
			if (!results.children.length) results.appendChild(el("p", "hint", "No tile matches “" + esc(q) + "”."));
		});
		function item(key) {
			var def = T.types[key];
			var b = el("button", "dr-item", svg(def.icon) + "<span><b>" + esc(def.name) + "</b><em>" + esc(def.desc) + (def.helper ? " · helper" : "") + "</em></span>");
			b.addEventListener("click", function () { addTile(key); });
			return b;
		}
		var recent = (storeGet("cpRecent") || []).filter(function (k) { return T.types[k]; }).slice(0, 4);
		var groups = (recent.length ? [["__recent", "Recently added"]] : []).concat(T.GROUPS);
		groups.forEach(function (g) {
			var sec = el("div", "dr-group", "<h4>" + esc(g[1]) + "</h4>");
			var list = el("div", "dr-grid");
			if (g[0] === "__recent") recent.forEach(function (k) { list.appendChild(item(k)); });
			else Object.keys(T.types).forEach(function (key) { if (T.types[key].group === g[0]) list.appendChild(item(key)); });
			sec.appendChild(list);
			body.appendChild(sec);
		});
		document.getElementById("drawer").hidden = false;
		document.body.classList.add("drawer-open");
	}

	function closeDrawer() {
		document.getElementById("drawer").hidden = true;
		document.body.classList.remove("drawer-open");
	}

	function addTile(type) {
		var t = makeTile(type);
		if (!place(t)) return U.toast("No free space. Remove or shrink a tile first");
		storeSet("cpRecent", [type].concat((storeGet("cpRecent") || []).filter(function (k) { return k !== type; })).slice(0, 8));
		L.tiles.push(t);
		save();
		render();
		App.refreshNeeds();
		closeDrawer();
		U.toast(T.types[type].name + " added");
		if (type === "shortcut" || T.types[type].edit) editTile(t);
	}

	/* ------------------------------------------------------------------ modal */
	var modalBack = null;

	function openModal(title, content, back) {
		document.getElementById("modalTitle").textContent = title;
		var body = document.getElementById("modalBody");
		body.innerHTML = "";
		if (typeof content === "string") body.innerHTML = content;
		else if (content) body.appendChild(content);
		var bb = document.getElementById("modalBack");
		modalBack = back || null;
		bb.hidden = !back;
		bb.innerHTML = svg("back");
		document.getElementById("modal").hidden = false;
		return body;
	}

	function closeModal() {
		document.getElementById("modal").hidden = true;
		folderOpen = null;
		App.refreshNeeds();
	}

	/* ------------------------------------------------------------------ folders */
	var folderOpen = null, folderBox = null;

	function openFolder(t) {
		folderOpen = t;
		folderBox = el("div", "folder-board");
		openModal((t.cfg && t.cfg.name) || "Folder", folderBox);
		renderFolder();
		App.refreshNeeds();
	}

	function renderFolder() {
		if (!folderOpen || !folderBox) return;
		var kids = (folderOpen.cfg && folderOpen.cfg.children) || [];
		folderBox.innerHTML = "";
		var cols = 4, occ = [];
		function free(x, y, w, h) {
			for (var yy = y; yy < y + h; yy++) for (var xx = x; xx < x + w; xx++) if (occ[yy] && occ[yy][xx]) return false;
			return true;
		}
		var maxY = 0;
		kids.forEach(function (k) {
			var w = Math.min(k.w || 1, cols), h = k.h || 1, spot = null;
			for (var y = 0; !spot; y++) for (var x = 0; x + w <= cols && !spot; x++) if (free(x, y, w, h)) spot = { x: x, y: y };
			for (var yy = spot.y; yy < spot.y + h; yy++) { occ[yy] = occ[yy] || []; for (var xx = spot.x; xx < spot.x + w; xx++) occ[yy][xx] = true; }
			var cell = Math.min(grid.cellW, grid.cellH);
			var rect = { left: spot.x * (cell + grid.gap), top: spot.y * (cell + grid.gap), width: w * cell + (w - 1) * grid.gap, height: h * cell + (h - 1) * grid.gap };
			maxY = Math.max(maxY, rect.top + rect.height);
			var node = buildTile(k, rect, folderBox);
			if (App.editing) addFolderChrome(node, k);
		});
		folderBox.style.height = maxY + "px";
		folderBox.style.width = 4 * Math.min(grid.cellW, grid.cellH) + 3 * grid.gap + "px";
		var oldAdd = folderBox.parentNode && folderBox.parentNode.querySelector(".folder-add");
		if (oldAdd) oldAdd.parentNode.removeChild(oldAdd);
		if (App.editing) {
			var add = el("button", "pill accent folder-add", "+ Add shortcut");
			add.addEventListener("click", function () {
				var k = { id: newId(), type: "shortcut", w: 1, h: 1, cfg: {} };
				folderOpen.cfg.children.push(k);
				save();
				editTile(k, true);
			});
			folderBox.parentNode.appendChild(add);
		}
		if (!kids.length) folderBox.innerHTML = '<div class="notice small"><span>Empty. Drag tiles onto the folder while editing, or tap + Add shortcut.</span></div>';
	}

	function addFolderChrome(node, k) {
		node.classList.add("editable");
		var def = T.types[k.type];
		var bar = el("div", "chrome");
		bar.innerHTML =
			'<button class="ch ch-x" data-a="del" aria-label="Remove">' + svg("x") + "</button>" +
			((def.editable || def.options || def.edit) ? '<button class="ch ch-edit" data-a="edit" aria-label="Edit">' + svg("pencil") + "</button>" : "") +
			'<button class="ch ch-copy" data-a="out" aria-label="Move out of folder">' + svg("out") + "</button>";
		node.appendChild(bar);
		bar.addEventListener("click", function (e) {
			var b = e.target.closest("[data-a]");
			if (!b) return;
			e.stopPropagation();
			var kids = folderOpen.cfg.children, i = kids.indexOf(k);
			if (b.dataset.a === "del") kids.splice(i, 1);
			else if (b.dataset.a === "edit") return editTile(k, true);
			else if (b.dataset.a === "out") {
				var t = { id: k.id, type: k.type, x: 0, y: 0, w: k.w, h: k.h, cfg: k.cfg };
				if (!place(t)) return U.toast("No free space on the screen");
				kids.splice(i, 1);
				L.tiles.push(t);
				render();
			}
			save();
			var fo = folderOpen;
			openFolder(fo);
		});
	}

	/* ------------------------------------------------------------------ tile settings (✏) */
	function editTile(t, inFolder) {
		var back = inFolder && folderOpen ? (function (f) { return function () { openFolder(f); }; })(folderOpen) : null;
		var def = T.types[t.type];
		if (def.edit) return def.edit(t, back);
		if (def.options) return optionsModal(t, back);
		if (t.type === "shortcut") return pickShortcut(t, back);
		if (t.type === "folder") return editFolder(t);
		if (def.sourcesOf) return pickSources(t, def.maxSources || (t.type === "gauge" ? 2 : 8));
	}

	function done(t, back) {
		save();
		if (back) back();
		else closeModal();
		render();
		App.refreshNeeds();
	}

	/* Shortcut picker: Apps (from the helper, real icons) / Websites / Quick actions. */
	function pickShortcut(t, back) {
		var wrap = el("div", "picker");
		wrap.innerHTML = '<div class="tabs"><button data-tab="apps" class="on">Apps</button><button data-tab="web">Websites</button><button data-tab="quick">Quick actions</button></div><div class="tab-body"></div>';
		var tb = wrap.querySelector(".tab-body");
		openModal("Choose what this button opens", wrap, back);
		function choose(cfg) {
			t.cfg = cfg;
			done(t, back);
		}
		function itemBtn(cfg, sub) {
			var b = el("button", "pick");
			b.appendChild(T.shortcutLogo(cfg, "pick-logo"));
			var tx = el("span", "pick-tx", "<b></b><em></em>");
			tx.querySelector("b").textContent = cfg.name;
			tx.querySelector("em").textContent = sub || "";
			b.appendChild(tx);
			b.addEventListener("click", function () { choose(cfg); });
			return b;
		}
		function showApps() {
			if (!Helper.online) {
				tb.innerHTML = '<div class="notice"><b>Control Hub isn\'t running</b><span>Start it on your PC to pick from your installed apps with their real icons. Websites and quick actions work without it.</span></div>';
				return;
			}
			tb.innerHTML = '<div class="notice small"><span>Loading your apps…</span></div>';
			Helper.loadApps(false).then(function (apps) {
				var list = el("div", "pick-grid");
				var search = el("input", "search");
				search.type = "search";
				search.placeholder = "Search apps";
				var refresh = el("button", "pill", "Refresh list");
				refresh.addEventListener("click", function () { Helper.loadApps(true).then(showApps); });
				var bar = el("div", "pick-bar");
				bar.appendChild(search);
				bar.appendChild(refresh);
				tb.innerHTML = "";
				tb.appendChild(bar);
				tb.appendChild(list);
				function fill(q) {
					list.innerHTML = "";
					q = (q || "").toLowerCase();
					apps.filter(function (a) { return a.kind !== "url" && (!q || a.name.toLowerCase().indexOf(q) >= 0); }).forEach(function (a) {
						list.appendChild(itemBtn({ kind: a.kind === "file" ? "file" : "app", id: a.id, name: a.name, icon: a.icon }, a.kind === "file" ? "Added by you" : ""));
					});
					if (!list.children.length) list.innerHTML = '<div class="notice small"><span>No apps found</span></div>';
				}
				search.addEventListener("input", function () { fill(search.value); });
				fill("");
			}, function () {
				tb.innerHTML = '<div class="notice"><b>Couldn\'t load your apps</b><span>Is Control Hub still running?</span></div>';
			});
		}
		function showWeb() {
			var list = el("div", "pick-grid");
			tb.innerHTML = "";
			var custom = (Helper.apps || []).filter(function (a) { return a.kind === "url"; });
			custom.forEach(function (a) {
				list.appendChild(itemBtn({ kind: "url", url: "", id: a.id, name: a.name, domain: a.domain }, "Added by you"));
			});
			T.SITES.forEach(function (s) {
				list.appendChild(itemBtn({ kind: "url", url: s.url, name: s.name, domain: s.domain }, s.domain));
			});
			tb.appendChild(list);
			tb.appendChild(el("p", "hint", "Add your own websites and programs in Control Hub → Panel → <b>Add a website</b>"));
			if (Helper.online && !Helper.apps) Helper.loadApps(false).then(function () { if (wrap.querySelector('[data-tab="web"].on')) showWeb(); });
		}
		function showQuick() {
			var list = el("div", "pick-grid");
			tb.innerHTML = "";
			Object.keys(T.QUICK).forEach(function (k) {
				list.appendChild(itemBtn({ kind: "quick", what: k, name: T.QUICK[k].name }, T.QUICK[k].uri ? "" : "needs Control Hub"));
			});
			tb.appendChild(list);
		}
		var tabs = { apps: showApps, web: showWeb, quick: showQuick };
		wrap.querySelectorAll("[data-tab]").forEach(function (b) {
			b.addEventListener("click", function () {
				wrap.querySelectorAll("[data-tab]").forEach(function (x) { x.classList.toggle("on", x === b); });
				tabs[b.dataset.tab]();
			});
		});
		var start = t.cfg && (t.cfg.kind === "url" ? "web" : t.cfg.kind === "quick" ? "quick" : "apps");
		if (!Helper.online && !start) start = "quick";
		wrap.querySelector('[data-tab="' + (start || "apps") + '"]').click();
	}

	/* Generic settings for a tile: a list of choices and switches from def.options(tile). */
	function optionsModal(t, back) {
		var def = T.types[t.type];
		var work = JSON.parse(JSON.stringify(t.cfg || {}));
		var wrap = el("div", "opts");
		openModal(def.name + " settings", wrap, back);
		function draw() {
			wrap.innerHTML = "";
			def.options(t, work).forEach(function (f) {
				var sec = el("div", "opt");
				sec.appendChild(el("h4", "", esc(f.label)));
				if (f.hint) sec.appendChild(el("p", "hint", esc(f.hint)));
				var cur = work[f.key] === undefined ? f["default"] : work[f.key];
				if (f.type === "toggle") {
					var b = el("button", "opt-toggle" + (cur ? " on" : ""), '<span class="switch"><i></i></span><span>' + esc(cur ? f.on || "On" : f.off || "Off") + "</span>");
					b.addEventListener("click", function () { work[f.key] = !cur; draw(); });
					sec.appendChild(b);
				} else {
					var list = el("div", f.layout === "list" ? "opt-list" : "chips");
					(f.choices || []).forEach(function (c) {
						var sel = f.type === "multi" ? (cur || []).indexOf(c.value) >= 0 : cur === c.value;
						var b = el("button", (f.layout === "list" ? "opt-row" : "chip") + (sel ? " on" : ""));
						b.innerHTML = (f.layout === "list" ? '<span class="src-check">' + svg("check") + "</span>" : "") + "<span><b></b>" + (c.sub ? "<em></em>" : "") + "</span>";
						b.querySelector("b").textContent = c.label;
						if (c.sub) b.querySelector("em").textContent = c.sub;
						b.addEventListener("click", function () {
							if (f.type === "multi") {
								var arr = (cur || []).slice(), i = arr.indexOf(c.value);
								if (i >= 0) arr.splice(i, 1); else arr.push(c.value);
								work[f.key] = arr;
							} else work[f.key] = c.value;
							draw();
						});
						list.appendChild(b);
					});
					if (!(f.choices || []).length) list.appendChild(el("p", "hint", esc(f.empty || "Nothing to choose from yet.")));
					sec.appendChild(list);
				}
				wrap.appendChild(sec);
			});
			var save = el("button", "pill accent save-btn", "Save");
			save.addEventListener("click", function () {
				t.cfg = work;
				done(t, back);
			});
			wrap.appendChild(save);
		}
		draw();
	}

	/* "Are you sure?" dialog. */
	function confirmBox(opts, onYes) {
		var wrap = el("div", "confirm");
		wrap.innerHTML = '<div class="confirm-ic' + (opts.danger ? " danger" : "") + '">' + svg(opts.icon || "power") + '</div><p class="confirm-tx"></p><div class="confirm-btns"><button class="pill big no">Cancel</button><button class="pill big yes' + (opts.danger ? " danger" : " accent") + '"></button></div>';
		wrap.querySelector(".confirm-tx").textContent = opts.text || "";
		wrap.querySelector(".yes").textContent = opts.ok || "Yes";
		openModal(opts.title || "Are you sure?", wrap);
		wrap.querySelector(".no").addEventListener("click", function () { closeModal(); });
		wrap.querySelector(".yes").addEventListener("click", function () {
			closeModal();
			onYes();
		});
	}

	function editFolder(t) {
		var names = ["Desk tools", "Games", "Apps", "Streaming", "Flight sim", "Media", "Work", "Tools", "Websites"];
		var wrap = el("div", "folder-edit");
		wrap.innerHTML = '<label>Name</label><input class="search" maxlength="24" /><div class="chips"></div><button class="pill accent save">Save</button>';
		var input = wrap.querySelector("input");
		input.value = (t.cfg && t.cfg.name) || "Folder";
		var chips = wrap.querySelector(".chips");
		names.forEach(function (n) {
			var c = el("button", "chip", esc(n));
			c.addEventListener("click", function () { input.value = n; });
			chips.appendChild(c);
		});
		wrap.querySelector(".save").addEventListener("click", function () {
			t.cfg = t.cfg || {};
			t.cfg.name = input.value.trim() || "Folder";
			done(t);
		});
		openModal("Folder", wrap);
	}

	/* Pick sensors for a Gauges or Sensors tile. */
	function pickSources(t, max) {
		var chosen = (T.types[t.type].sourcesOf(t) || []).slice();
		var wrap = el("div", "sources");
		openModal(max <= 2 ? "Choose up to " + max : "Choose sensors", wrap);
		function row(key, name, sub) {
			var b = el("button", "src" + (chosen.indexOf(key) >= 0 ? " on" : ""));
			b.innerHTML = '<span class="src-check">' + svg("check") + '</span><span class="src-tx"><b></b><em></em></span><span class="src-val"></span>';
			b.querySelector("b").textContent = name;
			b.querySelector("em").textContent = sub || "";
			var r = T.readSource(key);
			b.querySelector(".src-val").textContent = r.value == null ? "" : T.fmtValue(r.value, r.units) + " " + r.units;
			b.addEventListener("click", function () {
				var i = chosen.indexOf(key);
				if (i >= 0) chosen.splice(i, 1);
				else {
					if (chosen.length >= max) chosen.shift();
					chosen.push(key);
				}
				draw();
			});
			return b;
		}
		function draw() {
			wrap.innerHTML = "";
			var top = el("div", "src-actions");
			var saveBtn = el("button", "pill accent", "Save (" + chosen.length + ")");
			saveBtn.addEventListener("click", function () {
				if (!chosen.length) return U.toast("Pick at least one");
				t.cfg = t.cfg || {};
				t.cfg.sources = chosen.slice();
				done(t);
			});
			top.appendChild(saveBtn);
			wrap.appendChild(top);
			wrap.appendChild(el("h4", "", "Automatic"));
			Object.keys(T.AUTO).forEach(function (k) { wrap.appendChild(row(k, T.AUTO[k].label, "picks the right sensor for you")); });
			var list = Icue.sensorList || [];
			var byDevice = {};
			list.forEach(function (s) { (byDevice[s.device || "Other"] = byDevice[s.device || "Other"] || []).push(s); });
			Object.keys(byDevice).forEach(function (dev) {
				wrap.appendChild(el("h4", "", esc(dev)));
				byDevice[dev].forEach(function (s) { wrap.appendChild(row(s.id, s.name, s.type)); });
			});
			if (!list.length) wrap.appendChild(el("p", "hint", "iCUE hasn't shared any sensors yet."));
		}
		draw();
		if (!Icue.sensorList) Icue.loadSensors().then(draw);
	}

	/* ------------------------------------------------------------------ hidden tiles */
	function openHidden() {
		var wrap = el("div", "hidden-list");
		hidden.forEach(function (t) {
			var r = el("div", "hid-row", "<b>" + esc(titleOf(t)) + '</b><span class="hid-size">' + t.w + "×" + t.h + "</span>");
			var put = el("button", "pill accent", "Place");
			var del = el("button", "pill danger", "Remove");
			put.addEventListener("click", function () {
				if (!place(t)) return U.toast("No free space. Remove or shrink a tile first");
				save(); render(); openHidden();
			});
			del.addEventListener("click", function () {
				L.tiles.splice(L.tiles.indexOf(t), 1);
				save(); render(); hidden.length ? openHidden() : closeModal();
			});
			r.appendChild(put);
			r.appendChild(del);
			wrap.appendChild(r);
		});
		openModal("Tiles that don't fit this screen size", wrap);
	}

	/* ------------------------------------------------------------------ edit mode on/off */
	function setEditing(on) {
		if (on && typeof Round8 !== "undefined" && Round8.locked()) return U.toast("The panel is locked");
		if (!on && typeof Round8 !== "undefined") Round8.stopSelect();
		App.editing = !!on;
		// Editing at another size than the layout was made for: take that size over now (with Undo).
		if (App.editing && sigOf(L.pages[L.current]) && sigOf(L.pages[L.current]) !== grid.cols + "x" + grid.rows && adoptGrid()) U.toast("Tiles fitted to this screen size");
		document.body.classList.toggle("editing", App.editing);
		document.getElementById("editTools").hidden = !App.editing;
		document.getElementById("editBtn").hidden = App.editing;
		if (!App.editing) closeDrawer();
		render();
	}

	function wire() {
		document.getElementById("editBtn").addEventListener("click", function () { setEditing(true); });
		document.getElementById("doneBtn").addEventListener("click", function () { setEditing(false); });
		document.getElementById("addBtn").addEventListener("click", openDrawer);
		document.getElementById("hiddenBtn").addEventListener("click", openHidden);
		document.getElementById("pagesBtn").addEventListener("click", function () { Pages.manage(); });
		document.getElementById("dots").addEventListener("click", function (e) {
			var d = e.target.closest(".dot");
			if (d) goPage(+d.dataset.page, "user");
		});

		// Swipe left/right to change page (not while editing, and not when the finger started on a slider).
		var sw = null, swallow = false;
		document.getElementById("board").addEventListener("pointerdown", function (e) {
			sw = App.editing || L.pages.length < 2 || e.target.closest(".slider, .no-swipe") ? null : { x: e.clientX, y: e.clientY };
		});
		document.addEventListener("pointerup", function (e) {
			if (!sw) return;
			var dx = e.clientX - sw.x, dy = e.clientY - sw.y;
			if (typeof Round8 !== "undefined" && Round8.lockedAll()) { sw = null; return; }
			sw = null;
			if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
				swallow = true;
				setTimeout(function () { swallow = false; }, 400);
				var n = L.pages.length;
				// Swipes that start at the very edge jump to the first / last page (Look → Pages, if on).
				if (L.opts.edgeSwipe && sw.x < 34) return goPage(0, "user");
				if (L.opts.edgeSwipe && sw.x > window.innerWidth - 34) return goPage(n - 1, "user");
				goPage((L.current + (dx < 0 ? 1 : -1) + n) % n, "user");
			}
		});
		document.addEventListener("pointercancel", function () { sw = null; });
		document.addEventListener("click", function (e) {
			if (swallow) { swallow = false; e.stopPropagation(); e.preventDefault(); }
		}, true);
		document.querySelectorAll('[data-close="drawer"]').forEach(function (b) { b.addEventListener("click", closeDrawer); });
		document.querySelectorAll('[data-close="modal"]').forEach(function (b) { b.addEventListener("click", function () { closeModal(); render(); }); });
		document.getElementById("modalBack").addEventListener("click", function () { if (modalBack) modalBack(); });
		document.getElementById("modal").addEventListener("click", function (e) {
			if (e.target.id === "modal") { closeModal(); render(); }
		});

		// Hold anywhere for about a second to start editing (works with the Edit button hidden).
		var hold = null, start = null, suppress = false;
		document.getElementById("board").addEventListener("pointerdown", function (e) {
			if (App.editing) return;
			start = { x: e.clientX, y: e.clientY };
			clearTimeout(hold);
			// Holding a tile opens its quick settings; holding the empty background starts editing.
			// (Tiles and lists that use holding for something of their own are left alone.)
			var tileNode = e.target.closest("#board .tile");
			if (tileNode && (e.target.closest(".slider, [data-own-hold]") || (tileOf(tileNode) && T.types[tileOf(tileNode).type].ownHold))) return;
			hold = setTimeout(function () {
				suppress = true;
				setTimeout(function () { suppress = false; }, 700);
				if (typeof Round8 !== "undefined" && Round8.locked()) return;
				var t = tileNode && tileOf(tileNode);
				if (t && typeof Round8 !== "undefined") Round8.tileSheet(t, tileNode);
				else setEditing(true);
			}, 800);
		});
		document.addEventListener("pointermove", function (e) {
			if (start && Math.abs(e.clientX - start.x) + Math.abs(e.clientY - start.y) > 12) clearTimeout(hold);
		});
		["pointerup", "pointercancel"].forEach(function (n) {
			document.addEventListener(n, function () { clearTimeout(hold); start = null; });
		});
		document.addEventListener("click", function (e) {
			if (suppress) { suppress = false; e.stopPropagation(); e.preventDefault(); }
		}, true);
		document.addEventListener("contextmenu", function (e) { e.preventDefault(); });
	}

	return {
		load: function () {
			computeGrid();
			// Nothing stored (new widget, or iCUE lost it): start with the default, and let the helper's copy replace it.
			if (!load()) { Editor.fresh = true; defaultLayout(); }
			else Editor.loadedAt = L.savedAt || 0; // when this copy was last changed (before anything on this start)
		},
		fresh: false,
		loadedAt: 0,
		makeTile: makeTile,
		cloneTile: cloneTile,
		pinTile: pinTile,
		pushUndo: pushUndo,
		undo: undo,
		canUndo: function () { return undoStack.length > 0; },
		tileOf: tileOf,
		nodes: function () { return nodes; },
		uiScale: uiScale,
		titleOf: titleOf,
		removeTile: removeTile,
		moveToPage: moveToPage,
		computeGrid: computeGrid,
		reset: defaultLayout,
		render: render,
		updateAll: updateAll,
		visibleTiles: visibleTiles,
		openFolder: openFolder,
		wire: wire,
		setEditing: setEditing,
		gridInfo: function () { return grid; },
		layout: function () { return L; },
		adopt: adopt,
		storeGet: storeGet,
		storeSet: storeSet,
		goPage: goPage,
		usePage: usePage,
		renderDots: renderDots,
		repack: repack,
		pageSize: pageSize,
		calcGrid: calcGrid,
		/* Run fn with the grid of a page of this size (e.g. "" = the panel's own size), then put it back. */
		withGrid: function (size, fn) { var keep = grid; grid = calcGrid(size); try { return fn(); } finally { grid = keep; } },
		/* Give a page its own tile size; its tiles are stretched or shrunk to fill the new grid. */
		setPageSize: function (p, size) {
			size = PAGE_SCALE[size] ? size : "";
			if ((p.size || "") === size) return;
			var from = calcGrid(pageSize(p)), keep = L.current, idx = L.pages.indexOf(p);
			p.size = size;
			p.sig = "";
			usePage(idx);
			if (typeof Round10 !== "undefined") {
				var shown = p.tiles.filter(function (t) { return t.x < 9999; }), out = Round10.fit(shown, from.cols, from.rows);
				shown.forEach(function (t, i) { t.x = out[i].x; t.y = out[i].y; t.w = out[i].w; t.h = out[i].h; });
				var a = arrange(p.tiles, null);
				p.tiles.forEach(function (t) { var q = a[t.id]; if (q) { t.x = q.x; t.y = q.y; t.w = q.w; t.h = q.h; } });
			}
			p.sig = size ? grid.cols + "x" + grid.rows : "";
			usePage(keep);
			save();
		},
		addPage: function (name) {
			var p = { id: "p" + L.next++, name: name, auto: null, tiles: [] };
			L.pages.push(p);
			return p;
		},
		edit: editTile,
		pickSources: pickSources,
		modal: openModal,
		closeModal: closeModal,
		saveTile: done,
		save: save,
		confirm: confirmBox,
		place: place,
		free: function (t) { return fits(t.x, t.y, t.w, t.h) && !overlaps(t.x, t.y, t.w, t.h, t.id); },
	};
})();
