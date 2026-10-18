/* Control Panel — Round 8C: flight sim and PC.
 * Flight: next-waypoint strip, fuel check, weather along the route, scenery check, flight replay, Pre-flight button.
 * PC: game-mode clean-up, hardware dashboard, Steam downloads, "what's using my PC".
 * Needs Control Hub 2.3.0 for the replay, scenery, clean-up and Steam parts. */

var Round8c = (function () {
	var el = U.el, svg = U.svg, esc = U.esc, setText = U.setText, setHtml = U.setHtml;
	var types = T.types, helperGate = T.helperGate;

	function L() { return Editor.layout(); }
	function O() { var l = L(); return l.opts || (l.opts = {}); }
	function sim() { var s = Helper.state && Helper.state.sim; return s && s.connected ? s : null; }
	function planData() { return Flight.plan().data; }
	function two(n) { return ("0" + n).slice(-2); }
	function num(n) { return n == null || isNaN(n) ? "--" : Math.round(n).toLocaleString("en-GB"); }
	function kg(n) { return n == null || isNaN(n) ? "--" : n >= 10000 ? (n / 1000).toFixed(1) + " t" : num(n) + " kg"; }
	var distNm = Flight.distNm;

	/* ------------------------------------------------------------------ helper version */
	function verNum(v) { var p = String(v || "0").split("."); return (+p[0] || 0) * 10000 + (+p[1] || 0) * 100 + (+p[2] || 0); }
	function helperNew() { var v = Helper.state.version; return !v || v === "mock" || verNum(v) >= verNum("2.3.0"); }
	var OLD = '<div class="notice small"><b>Update the helper</b><span>Run Build Helper.bat once (helper 2.3.0) for this.</span></div>';
	function gate(ctx, st) {
		if (helperGate(ctx) === true) { st.built = false; return true; }
		if (!helperNew()) { if (st.built !== "old") { ctx.body.innerHTML = OLD; st.built = "old"; } return true; }
		if (st.built === "old") st.built = false;
		return false;
	}

	/* Asks the helper for something while a tile shows it, at most every `every` ms. */
	var poller = Round6.poller;

	/* ================================================================== route progress (shared) */
	/* The route as points: origin, the SimBrief fixes, destination. */
	function routeOf(p) {
		if (!p) return [];
		var pts = [];
		if (p.from_lat != null) pts.push({ id: p.from, lat: p.from_lat, lon: p.from_lon, apt: true });
		(p.fixes || []).forEach(function (f) {
			var last = pts[pts.length - 1];
			if (last && last.id === f.id && Math.abs(last.lat - f.lat) < 0.01) return;
			pts.push(f);
		});
		var end = pts[pts.length - 1];
		if (p.to_lat != null && !(end && end.id === p.to)) pts.push({ id: p.to, lat: p.to_lat, lon: p.to_lon, apt: true });
		return pts;
	}

	/* Where along a leg a position is: t = 0 at a, 1 at b; x = nm off the line. Flat-earth around the leg (fine for legs this short). */
	function onLeg(a, b, lat, lon) {
		var k = Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
		var bx = (b.lon - a.lon) * k, by = b.lat - a.lat, px = (lon - a.lon) * k, py = lat - a.lat;
		var len2 = bx * bx + by * by;
		var t = len2 ? (px * bx + py * by) / len2 : 0;
		var cx = px - t * bx, cy = py - t * by;
		return { t: t, x: Math.sqrt(cx * cx + cy * cy) * 60 };
	}

	var prog = { key: "", idx: 0 };
	/* Next fix, distance to it and what's left to the destination. */
	function progress(p, s) {
		var pts = routeOf(p);
		if (pts.length < 2 || !s) return null;
		var key = p.from + p.to + p.flight + pts.length;
		if (prog.key !== key) { prog.key = key; prog.idx = 0; }
		var best = -1, bestScore = 1e9;
		var from = Math.max(0, prog.idx - 1), to = Math.min(pts.length - 2, prog.idx + 8);
		if (s.ground && s.gs < 40 && !(s.landed > 0)) { from = 0; to = Math.min(pts.length - 2, 1); }
		for (var j = from; j <= to; j++) {
			var o = onLeg(pts[j], pts[j + 1], s.lat, s.lon);
			var score = o.x + (o.t < -0.05 ? -o.t * 200 : o.t > 1.02 ? (o.t - 1) * 200 : 0);
			if (score < bestScore) { bestScore = score; best = j; }
		}
		if (best < 0) best = 0;
		// Far off every leg (e.g. after a direct-to): fall back to the closest fix ahead.
		if (bestScore > 60) {
			var cl = 1e9;
			for (var i = prog.idx; i < pts.length; i++) {
				var d0 = distNm(s.lat, s.lon, pts[i].lat, pts[i].lon);
				if (d0 < cl) { cl = d0; best = Math.max(0, i - 1); }
			}
		}
		if (s.landed > 0 && s.ground) best = pts.length - 2;
		prog.idx = best;
		var next = best + 1;
		var toNext = distNm(s.lat, s.lon, pts[next].lat, pts[next].lon);
		var cum = [toNext];
		for (var k = next + 1; k < pts.length; k++) cum.push(cum[cum.length - 1] + distNm(pts[k - 1].lat, pts[k - 1].lon, pts[k].lat, pts[k].lon));
		var t = onLeg(pts[best], pts[next], s.lat, s.lon).t;
		return { pts: pts, leg: best, next: next, t: U.clamp(t, 0, 1), toNext: toNext, cum: cum, remaining: cum[cum.length - 1] };
	}

	/* Hours of flying for a distance at the current ground speed (or the planned one before takeoff). */
	function hoursFor(nm, s, p) {
		var gs = s && !s.ground && s.gs > 80 ? s.gs : p && p.dist && p.ete ? p.dist / (p.ete / 3600) : 420;
		return nm / gs;
	}
	function zuluIn(hours, s) {
		var base = s && s.zulu != null ? s.zulu : (Date.now() / 1000) % 86400;
		var t = (base + hours * 3600) % 86400;
		return two(Math.floor(t / 3600)) + two(Math.floor((t % 3600) / 60)) + "Z";
	}
	function minutesText(h) { var m = Math.round(h * 60); return m >= 60 ? Math.floor(m / 60) + " h " + two(m % 60) : m + " min"; }

	function noPlan(box, c) {
		setHtml(box, '<div class="notice small"><span>' + (c && c.err ? "Couldn't get your SimBrief plan" : "Loading your SimBrief plan…") + "</span></div>");
	}

	/* ================================================================== next-waypoint strip */
	types.nextwpt = {
		name: "Next waypoint", desc: "Next fixes with distance and time, and what's left to the destination", icon: "flag", group: "flight", helper: true, parts: ["sim"],
		w: 6, h: 1, minW: 3, minH: 1, maxW: 16, maxH: 2, tickMs: 2000,
		defaults: function () { return { count: 4, time: "eta" }; },
		options: function () {
			return [
				{ key: "count", label: "Fixes after the next one", type: "choice", "default": 4, choices: [{ value: 0, label: "None" }, { value: 2, label: "2" }, { value: 4, label: "4" }, { value: 6, label: "6" }, { value: 10, label: "10" }] },
				{ key: "time", label: "Time", type: "choice", "default": "eta", choices: [{ value: "eta", label: "Arrival time (Zulu)" }, { value: "left", label: "Minutes from now" }] },
				{ key: "toc", label: "Top of climb / descent", type: "toggle", "default": true, on: "Show TOC and TOD", off: "Hide them" },
			];
		},
		build: function (ctx) {
			ctx.body.innerHTML = '<div class="nw"></div>';
			var box = ctx.body.querySelector(".nw");
			return function () {
				if (helperGate(ctx) === true) return;
				var c = Flight.plan(), p = c.data, cfg = ctx.tile.cfg || {};
				if (!p) return noPlan(box, c);
				var s = sim();
				if (Flight.simGate(ctx, box)) return;
				var pr = progress(p, s);
				if (!pr) return setHtml(box, '<div class="notice small"><span>No route in the plan</span></div>');
				function when(nm) { var h = hoursFor(nm, s, p); return cfg.time === "left" ? minutesText(h) : zuluIn(h, s); }
				var hideToc = cfg.toc === false;
				var list = [];
				for (var i = pr.next; i < pr.pts.length; i++) {
					var f = pr.pts[i];
					if (hideToc && /^TO[CD]$/.test(f.id) && i !== pr.next) continue;
					list.push({ f: f, d: pr.cum[i - pr.next] });
				}
				var first = list[0], more = list.slice(1, 1 + (cfg.count == null ? 4 : cfg.count));
				var dest = pr.pts[pr.pts.length - 1];
				var html = '<div class="nw-next"><span class="nw-lbl">Next</span><b class="nw-id">' + esc(first.f.id) + '</b><span class="nw-d">' + num(first.d) + " NM · " + esc(when(first.d)) + "</span>" +
					(first.f.alt ? '<span class="nw-alt">' + (first.f.alt >= 18000 ? "FL" + Math.round(first.f.alt / 100) : num(first.f.alt) + " ft") + "</span>" : "") + "</div>";
				html += '<div class="nw-more">' + more.filter(function (x) { return x.f !== dest; }).map(function (x) {
					return '<div class="nw-f' + (/^TO[CD]$/.test(x.f.id) ? " toc" : "") + '"><b>' + esc(x.f.id) + "</b><span>" + num(x.d) + " NM</span><em>" + esc(when(x.d)) + "</em></div>";
				}).join("") + "</div>";
				html += '<div class="nw-dest"><span class="nw-lbl">' + esc(p.to) + '</span><b>' + num(pr.remaining) + ' NM</b><span>' + esc(when(pr.remaining)) + "</span></div>";
				setHtml(box, html);
			};
		},
	};

	/* ================================================================== fuel check */
	var fuelWarned = { key: "", level: 0 };
	types.fuelchk = {
		name: "Fuel check", desc: "Fuel at landing vs. your limit, and vs. the plan · warns you in time", icon: "gauge", group: "flight", helper: true, parts: ["sim"],
		w: 3, h: 2, minW: 2, minH: 1, maxW: 6, maxH: 4, tickMs: 3000,
		defaults: function () { return { limit: "reserve", warn: true }; },
		options: function () {
			return [
				{ key: "limit", label: "Warn me when the fuel at landing will be below", type: "choice", layout: "list", "default": "reserve", choices: [
					{ value: "reserve", label: "Final reserve + alternate", sub: "From your SimBrief plan" },
					{ value: "final", label: "Final reserve", sub: "From your SimBrief plan (about 30 min)" },
					{ value: "plan", label: "Planned landing fuel minus 10 %", sub: "Early warning" },
					{ value: 1500, label: "1 500 kg" }, { value: 2000, label: "2 000 kg" }, { value: 2500, label: "2 500 kg" }, { value: 3000, label: "3 000 kg" },
					{ value: 4000, label: "4 000 kg" }, { value: 5000, label: "5 000 kg" }, { value: 8000, label: "8 000 kg" },
				] },
				{ key: "warn", label: "Banner", type: "toggle", "default": true, on: "Show a banner when it gets low", off: "Only colour the tile" },
			];
		},
		build: function (ctx) {
			ctx.body.innerHTML = '<div class="fc"></div>';
			var box = ctx.body.querySelector(".fc"), lowSince = 0;
			return function () {
				if (helperGate(ctx) === true) return;
				var c = Flight.plan(), p = c.data, cfg = ctx.tile.cfg || {};
				if (Flight.simGate(ctx, box)) return;
				var s = sim();
				var limit = null, limitName = "";
				var mode = cfg.limit || "reserve";
				if (p && mode === "reserve" && p.reserve != null) { limit = p.reserve + (p.altBurn || 0); limitName = "Reserve + alternate"; }
				else if (p && mode === "final" && p.reserve != null) { limit = p.reserve; limitName = "Final reserve"; }
				else if (p && mode === "plan" && p.x && p.x.planLdg) { limit = p.x.planLdg * 0.9; limitName = "Plan −10 %"; }
				else if (typeof mode === "number") { limit = mode; limitName = "Your limit"; }
				var pr = p ? progress(p, s) : null;
				var flying = !s.ground && s.gs > 100 && s.ffKgH > 0;
				var predicted = null, how = "";
				if (flying && pr) { predicted = s.fuelKg - s.ffKgH * hoursFor(pr.remaining, s, p); how = "at the current burn"; }
				else if (p && p.x && p.x.planLdg) { predicted = p.x.planLdg - ((p.block || 0) - s.fuelKg > 0 && s.ground ? (p.block - s.fuelKg) : 0); how = s.ground ? "planned (" + (p.block && s.fuelKg < p.block - 200 ? "less fuel than planned on board" : "fuel on board OK") + ")" : "planned"; }
				// Planned fuel right here (between the two fixes) vs what you have.
				var vsPlan = null;
				if (pr && flying) {
					var a = pr.pts[pr.leg], b = pr.pts[pr.next];
					if (a.fuel != null && b.fuel != null) vsPlan = s.fuelKg - (a.fuel + (b.fuel - a.fuel) * pr.t);
				}
				var state = limit == null || predicted == null ? "" : predicted < limit ? "low" : predicted < limit * 1.15 ? "tight" : "ok";
				ctx.node.dataset.fuel = state;
				// Banner once per flight when it turns low (and again if it drops below the limit by another 10 %).
				var fk = (p ? p.from + p.to : "") + (s.blockOut || "");
				if (fuelWarned.key !== fk) { fuelWarned.key = fk; fuelWarned.level = 0; }
				if (state === "low" && flying) {
					if (!lowSince) lowSince = Date.now();
					var level = Math.floor((limit - predicted) / Math.max(1, limit * 0.1)) + 1;
					if (Date.now() - lowSince > 20000 && level > fuelWarned.level && cfg.warn !== false && window.Round7 && Round7._onNotif) {
						fuelWarned.level = level;
						Round7._onNotif({ id: "fuel" + Date.now(), app: "Fuel check", appKey: "cp-fuel", title: "Fuel at landing: " + kg(predicted), text: "Below your limit (" + limitName + " " + kg(limit) + "). Check the burn, the route or a diversion.", time: Date.now(), test: true });
					}
				} else lowSince = 0;
				var html = '<div class="fc-top"><span class="fc-lbl">At landing</span><b class="fc-pred">' + kg(predicted) + '</b><em>' + esc(how) + "</em></div>" +
					'<div class="fc-bar"><i style="width:' + (limit && predicted != null ? U.clamp((predicted / (limit * 2)) * 100, 2, 100) : 0) + '%"></i><s style="left:50%"></s></div>' +
					'<div class="fc-grid"><div><span>On board</span><b>' + kg(s.fuelKg) + "</b></div><div><span>Burn</span><b>" + (s.ffKgH ? kg(s.ffKgH) + "/h" : "--") + "</b></div>" +
					"<div><span>" + esc(limitName || "Limit") + "</span><b>" + kg(limit) + "</b></div><div><span>Vs plan here</span><b class=\"" + (vsPlan != null && vsPlan < -300 ? "neg" : "") + '">' + (vsPlan == null ? "--" : (vsPlan >= 0 ? "+" : "−") + kg(Math.abs(vsPlan))) + "</b></div></div>";
				setHtml(box, html);
			};
		},
	};

	/* ================================================================== weather along the route */
	var wxStore = {};
	function fetchJson(url, ms) {
		if (!Helper.online) return fetch(url).then(function (r) { return r.json(); });
		return Helper.fetch("/api/fetch?url=" + encodeURIComponent(url), { cache: "no-store" }, ms || 12000);
	}
	/* METARs for the airports of the plan and stations near the route (in a few small boxes along it). */
	function routeWx(p) {
		var key = p.from + p.to + p.alt + p.fixes.length;
		var c = wxStore[key] || (wxStore[key] = { at: 0, busy: false, data: null });
		if (c.busy || Date.now() - c.at < 15 * 60000) return c;
		c.busy = true;
		var pts = routeOf(p);
		var total = 0, along = [0];
		for (var i = 1; i < pts.length; i++) { total += distNm(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon); along.push(total); }
		// Sample points every ~200 NM (at most 8 boxes).
		var step = Math.max(200, total / 8), samples = [];
		for (var d = step / 2; d < total; d += step) {
			for (var j = 1; j < along.length; j++) if (along[j] >= d) {
				var f = (d - along[j - 1]) / Math.max(1, along[j] - along[j - 1]);
				samples.push({ lat: pts[j - 1].lat + (pts[j].lat - pts[j - 1].lat) * f, lon: pts[j - 1].lon + (pts[j].lon - pts[j - 1].lon) * f });
				break;
			}
		}
		var ids = [p.from, p.to, p.alt].filter(Boolean).join(",");
		var reqs = [fetchJson("https://aviationweather.gov/api/data/metar?format=json&ids=" + encodeURIComponent(ids)).then(null, function () { return []; })];
		samples.forEach(function (sp) {
			var bb = [(sp.lat - 0.8).toFixed(2), (sp.lon - 1.2).toFixed(2), (sp.lat + 0.8).toFixed(2), (sp.lon + 1.2).toFixed(2)].join(",");
			reqs.push(fetchJson("https://aviationweather.gov/api/data/metar?format=json&bbox=" + bb).then(null, function () { return []; }));
		});
		Promise.all(reqs).then(function (res) {
			var byId = {};
			res.forEach(function (arr) { (Array.isArray(arr) ? arr : []).forEach(function (m) { if (m && m.icaoId && !byId[m.icaoId]) byId[m.icaoId] = m; }); });
			var main = [p.from, p.to, p.alt].filter(Boolean);
			var list = [];
			Object.keys(byId).forEach(function (id) {
				var m = byId[id];
				if (m.lat == null) return;
				// Where along the route (and how far off it) this station is.
				var bestX = 1e9, bestD = 0;
				for (var k = 1; k < pts.length; k++) {
					var o = onLeg(pts[k - 1], pts[k], m.lat, m.lon);
					if (o.t < -0.1 || o.t > 1.1) continue;
					if (o.x < bestX) { bestX = o.x; bestD = along[k - 1] + U.clamp(o.t, 0, 1) * (along[k] - along[k - 1]); }
				}
				var isMain = main.indexOf(id) >= 0;
				if (!isMain && bestX > 40) return;
				list.push({ id: id, m: m, at: id === p.from ? 0 : id === p.to ? total : id === p.alt ? total + 1 : bestD, main: isMain, role: id === p.from ? "Departure" : id === p.to ? "Arrival" : id === p.alt ? "Alternate" : "" });
			});
			list.sort(function (a, b) { return a.at - b.at; });
			// Keep it readable: the plan's airports plus up to 14 along the way, spread out.
			var mids = list.filter(function (x) { return !x.main; }), keep = [];
			var gap = total / 15;
			mids.forEach(function (x) { if (!keep.length || x.at - keep[keep.length - 1].at >= gap) keep.push(x); });
			c.data = { total: total, stations: list.filter(function (x) { return x.main; }).concat(keep.slice(0, 14)).sort(function (a, b) { return a.at - b.at; }) };
		}).then(function () { c.at = Date.now(); c.busy = false; App.dirty(); });
		return c;
	}

	var CAT_COLOR = { VFR: "#22c55e", MVFR: "#3b82f6", IFR: "#ef4444", LIFR: "#d946ef" };
	function ceilingOf(m) {
		var c = (m.clouds || []).filter(function (x) { return /BKN|OVC|OVX/.test(x.cover || ""); })[0];
		return c && c.base != null ? num(c.base) + " ft" : "";
	}
	function wxLine(m) {
		var d = Flight._decodeMetar(m);
		return [d.wind, d.vis, ceilingOf(m) ? "ceiling " + ceilingOf(m) : ""].filter(Boolean).join(" · ");
	}
	function metarModal(st) {
		var d = Flight._decodeMetar(st.m);
		var w = el("div", "opts wx-one");
		w.innerHTML = '<div class="wx-cat" style="background:' + (CAT_COLOR[d.cat] || "#64748b") + '">' + esc(d.cat || "?") + "</div>" +
			'<div class="fc-grid"><div><span>Wind</span><b>' + esc(d.wind || "--") + "</b></div><div><span>Visibility</span><b>" + esc(d.vis || "--") + "</b></div><div><span>Clouds</span><b>" + esc(d.clouds) + "</b></div><div><span>Temp / dew</span><b>" + esc(d.temp || "--") + "</b></div><div><span>QNH</span><b>" + esc(d.qnh || "--") + '</b></div></div><p class="wx-raw"></p>';
		w.querySelector(".wx-raw").textContent = d.raw;
		Editor.modal(st.id + (st.m.name ? " · " + st.m.name : "") + (st.role ? " (" + st.role + ")" : ""), w);
	}

	types.routewx = {
		name: "Weather on the route", desc: "METARs for departure, arrival, alternate and airports along the way", icon: "cloud", group: "flight",
		w: 5, h: 2, minW: 3, minH: 1, maxW: 12, maxH: 5, tickMs: 30000,
		build: function (ctx) {
			ctx.body.innerHTML = '<div class="rw"><div class="rw-line"><i></i></div><div class="rw-list"></div></div>';
			var line = ctx.body.querySelector(".rw-line"), list = ctx.body.querySelector(".rw-list"), shown = "", data = null;
			U.dragScroll(list);
			ctx.body.addEventListener("click", function (e) {
				var b = e.target.closest("[data-st]");
				if (!b || App.editing || !data) return;
				e.stopPropagation();
				var st = data.stations[+b.dataset.st];
				if (st) metarModal(st);
			});
			return function () {
				var c = Flight.plan(), p = c.data;
				if (!p) { shown = ""; line.innerHTML = ""; return noPlan(list, c); }
				var w = routeWx(p);
				data = w.data;
				if (!data) { shown = ""; return setHtml(list, '<div class="notice small"><span>Getting the weather…</span></div>'); }
				var key = JSON.stringify(data.stations.map(function (x) { return [x.id, x.m.rawOb]; })) + ctx.w + ctx.h;
				if (key === shown) return;
				shown = key;
				var tot = Math.max(1, data.total + 1);
				setHtml(line, "<i></i>" + data.stations.map(function (x, i) {
					var cat = x.m.fltCat || "";
					return '<button class="rw-dot' + (x.main ? " main" : "") + '" data-st="' + i + '" style="left:' + U.clamp((x.at / tot) * 100, 0, 100).toFixed(1) + "%;background:" + (CAT_COLOR[cat] || "#64748b") + '"' + (x.main ? ' data-id="' + esc(x.id) + '"' : "") + "></button>";
				}).join(""));
				setHtml(list, data.stations.map(function (x, i) {
					var cat = x.m.fltCat || "?";
					return '<button class="rw-row" data-st="' + i + '"><span class="rw-cat" style="background:' + (CAT_COLOR[cat] || "#64748b") + '">' + esc(cat) + "</span><b>" + esc(x.id) + "</b><em>" + esc(x.role || num(x.at) + " NM") + "</em><span class=\"rw-w\">" + esc(wxLine(x.m)) + "</span></button>";
				}).join("") || '<div class="notice small"><span>No weather reports found</span></div>');
			};
		},
	};

	/* ================================================================== scenery check */
	var scP = poller("/api/scenery", 600000, 30000);
	function sceneryFor(icao) {
		var d = scP.data;
		return d && d.airports ? d.airports.filter(function (a) { return a.icao === icao; }) : [];
	}
	types.scenery = {
		name: "Scenery check", desc: "Which airports of your flight have add-on scenery, and all your add-on airports", icon: "globe", group: "flight", helper: true,
		w: 3, h: 2, minW: 2, minH: 1, maxW: 6, maxH: 6, tickMs: 30000,
		build: function (ctx) {
			var st = { built: false }, box, shown = "";
			return function () {
				if (gate(ctx, st)) return;
				if (!st.built) {
					ctx.body.innerHTML = T.head("globe", "Scenery") + '<div class="scn"></div>';
					box = ctx.body.querySelector(".scn");
					U.dragScroll(box);
					box.addEventListener("click", function (e) {
						if (App.editing || !e.target.closest(".scn-re")) return;
						e.stopPropagation();
						scP.at = 0;
						Helper.fetch("/api/scenery?fresh=1", { cache: "no-store" }, 60000).then(function (r) { scP.data = r; App.dirty(); });
						U.toast("Looking through your sim folders…");
					});
					st.built = true;
					shown = "";
				}
				var d = scP.get(), p = planData();
				if (!d) return setHtml(box, '<div class="notice small"><span>Looking through your sim folders…</span></div>');
				var key = JSON.stringify([d.airports && d.airports.length, d.found, p && p.from + p.to + p.alt, ctx.h]);
				if (key === shown) return;
				shown = key;
				if (!d.found) return setHtml(box, '<div class="notice small"><b>MSFS folder not found</b><span>Control Hub looks for UserCfg.opt to find your Community folder.</span></div>');
				var html = "";
				if (p) {
					html += '<div class="scn-plan">' + [[p.from, "Departure"], [p.to, "Arrival"], [p.alt, "Alternate"]].filter(function (x) { return x[0]; }).map(function (x) {
						var s = sceneryFor(x[0]);
						return '<div class="scn-ap' + (s.length ? " add" : "") + '"><b>' + esc(x[0]) + "</b><em>" + esc(x[1]) + "</em><span>" + (s.length ? esc(s[0].title || s[0].folder) : "Default scenery") + "</span></div>";
					}).join("") + "</div>";
				}
				var all = d.airports || [];
				html += '<h5 class="scn-h">' + all.length + " add-on airport" + (all.length === 1 ? "" : "s") + ' <button class="pill scn-re">Look again</button></h5>';
				html += all.map(function (a) { return '<div class="scn-row"><b>' + esc(a.icao) + "</b><span>" + esc(a.title || a.folder) + "</span><em>" + esc(a.source) + "</em></div>"; }).join("");
				setHtml(box, html);
			};
		},
	};

	/* ================================================================== flight replay */
	var trP = poller("/api/tracks", 60000, 15000);
	var trackCache = {};
	function loadTrack(id) {
		var c = trackCache[id] || (trackCache[id] = { at: 0, data: null, busy: false });
		var maxAge = id === "live" ? 20000 : 1e12;
		if (!c.busy && Date.now() - c.at > maxAge) {
			c.busy = true;
			Helper.fetch("/api/track?id=" + encodeURIComponent(id), { cache: "no-store" }, 15000).then(function (r) { c.data = r && r.ok ? r.points : []; }, function () {}).then(function () { c.at = Date.now(); c.busy = false; App.dirty(); });
		}
		return c.data;
	}
	function flightLabel(f) {
		var d = new Date(f.date || 0);
		return (f.from || "?") + " → " + (f.to || "?") + (f.live ? " · flying now" : " · " + d.getDate() + "/" + (d.getMonth() + 1));
	}

	/* A map fitted around some points: CARTO map pictures + a projection. */
	function fitMap(points, W, H) {
		var proj = Flight.project, z, a, b;
		var minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
		points.forEach(function (q) { minLat = Math.min(minLat, q[1]); maxLat = Math.max(maxLat, q[1]); minLon = Math.min(minLon, q[2]); maxLon = Math.max(maxLon, q[2]); });
		for (z = 12; z > 2; z--) {
			a = proj(maxLat, minLon, z); b = proj(minLat, maxLon, z);
			if (b.x - a.x < W * 0.86 && b.y - a.y < H * 0.86) break;
		}
		a = proj(maxLat, minLon, z); b = proj(minLat, maxLon, z);
		var ox = (a.x + b.x) / 2 - W / 2, oy = (a.y + b.y) / 2 - H / 2;
		return { z: z, ox: ox, oy: oy, xy: function (lat, lon) { var q = proj(lat, lon, z); return { x: q.x - ox, y: q.y - oy }; } };
	}
	function mapTiles(m, W, H) {
		var T0 = 256, n = Math.pow(2, m.z), html = "";
		var dark = !document.body.classList.contains("theme-light");
		for (var ty = Math.floor(m.oy / T0); ty <= Math.floor((m.oy + H) / T0); ty++)
			for (var tx = Math.floor(m.ox / T0); tx <= Math.floor((m.ox + W) / T0); tx++) {
				if (ty < 0 || ty >= n) continue;
				var wx = ((tx % n) + n) % n;
				html += '<img alt="" onerror="this.remove()" style="left:' + (tx * T0 - m.ox).toFixed(0) + "px;top:" + (ty * T0 - m.oy).toFixed(0) + 'px" src="https://' + "abcd"[(wx + ty) % 4] + ".basemaps.cartocdn.com/" + (dark ? "dark_all" : "light_all") + "/" + m.z + "/" + wx + "/" + ty + '.png" />';
			}
		return html;
	}
	function altColor(alt, max) {
		var f = U.clamp(alt / Math.max(10000, max), 0, 1);
		return "hsl(" + Math.round(190 - f * 150) + ",85%,55%)";
	}

	types.freplay = {
		name: "Flight replay", desc: "Where you flew, on a map with the height profile · scrub or play it back", icon: "plane", group: "flight", helper: true,
		w: 5, h: 3, minW: 3, minH: 2, maxW: 16, maxH: 8, tickMs: 15000,
		build: function (ctx) {
			var st = { built: false }, cfg = ctx.tile.cfg || (ctx.tile.cfg = {});
			var q = {}, shown = "", pos = 1, playT = null, pts = null, map = null;
			ctx.node.classList.add("no-swipe");
			function build() {
				ctx.body.innerHTML = '<div class="fr"><div class="fr-map"><div class="fr-tiles"></div><svg class="fr-svg"></svg><div class="fr-plane">' + svg("plane") + '</div><span class="fm-copy">© OpenStreetMap © CARTO</span></div>' +
					'<div class="fr-bar"><button class="fr-pick pill"></button><button class="fr-play">' + svg("play") + '</button><span class="fr-info"></span></div>' +
					'<div class="fr-prof"><svg class="fr-psvg" preserveAspectRatio="none"></svg><i class="fr-cur"></i></div></div>';
				["fr-map", "fr-tiles", "fr-svg", "fr-plane", "fr-pick", "fr-play", "fr-info", "fr-prof", "fr-psvg", "fr-cur"].forEach(function (c) { q[c] = ctx.body.querySelector("." + c); });
				q["fr-pick"].addEventListener("click", function (e) { e.stopPropagation(); if (!App.editing) pickFlight(); });
				q["fr-play"].addEventListener("click", function (e) {
					e.stopPropagation();
					if (App.editing || !pts) return;
					if (playT) return stop();
					if (pos >= 0.999) pos = 0;
					playT = setInterval(function () {
						if (!ctx.node.isConnected) return stop();
						pos = Math.min(1, pos + 1 / 300); // about 20 seconds for the whole flight
						showPos();
						if (pos >= 1) stop();
					}, 66);
					setHtml(q["fr-play"], svg("pause"));
				});
				var prof = q["fr-prof"], drag = false;
				function at(e) { var r = prof.getBoundingClientRect(); pos = U.clamp((e.clientX - r.left) / Math.max(1, r.width), 0, 1); showPos(); }
				prof.addEventListener("pointerdown", function (e) { if (App.editing || !pts) return; e.stopPropagation(); stop(); drag = true; try { prof.setPointerCapture(e.pointerId); } catch (x) {} at(e); });
				prof.addEventListener("pointermove", function (e) { if (drag) at(e); });
				prof.addEventListener("pointerup", function () { drag = false; });
				prof.addEventListener("pointercancel", function () { drag = false; });
				prof.addEventListener("click", function (e) { e.stopPropagation(); });
				st.built = true;
				shown = "";
			}
			function stop() { clearInterval(playT); playT = null; if (q["fr-play"]) setHtml(q["fr-play"], svg("play")); }
			function pickFlight() {
				var list = (trP.data && trP.data.items) || [];
				var w = el("div", "opt-list");
				list.forEach(function (f) {
					var b = el("button", "opt-row" + (String(f.id) === String(cfg.id || "") ? " on" : ""), '<span class="src-check">' + svg("plane") + "</span><span><b></b><em></em></span>");
					b.querySelector("b").textContent = flightLabel(f);
					b.querySelector("em").textContent = [f.flight, f.aircraft, f.airMin ? f.airMin + " min in the air" : "", f.grade ? "landing " + f.grade : ""].filter(Boolean).join(" · ");
					b.addEventListener("click", function () { cfg.id = String(f.id); Editor.save(); Editor.closeModal(); pos = 1; shown = ""; App.dirty(); });
					w.appendChild(b);
				});
				if (!list.length) w.appendChild(el("p", "hint", "No recorded flights yet. Control Hub records each flight from now on (where you flew and how high)."));
				Editor.modal("Pick a flight", w);
			}
			function idx() { return pts ? Math.round(pos * (pts.length - 1)) : 0; }
			function showPos() {
				if (!pts || !map) return;
				var p = pts[idx()], prev = pts[Math.max(0, idx() - 1)];
				var xy = map.xy(p[1], p[2]);
				var hdg = Math.atan2((p[2] - prev[2]) * Math.cos(p[1] * Math.PI / 180), p[1] - prev[1]) * 180 / Math.PI;
				q["fr-plane"].style.left = xy.x + "px";
				q["fr-plane"].style.top = xy.y + "px";
				q["fr-plane"].style.transform = "translate(-50%,-50%) rotate(" + (isFinite(hdg) ? hdg : 0) + "deg)";
				q["fr-cur"].style.left = pos * 100 + "%";
				var t = p[0];
				setText(q["fr-info"], Math.floor(t / 3600) + ":" + two(Math.floor((t % 3600) / 60)) + " · " + num(p[3]) + " ft · " + num(p[4]) + " kt" + (Math.abs(p[5]) > 200 ? " · " + (p[5] > 0 ? "+" : "") + num(p[5]) + " fpm" : ""));
			}
			return function () {
				if (gate(ctx, st)) return;
				if (!st.built) build();
				var tl = trP.get(), items = (tl && tl.items) || [];
				var chosen = items.filter(function (f) { return String(f.id) === String(cfg.id || ""); })[0] || items[0];
				setText(q["fr-pick"], chosen ? flightLabel(chosen) : "No flights yet");
				if (!chosen) {
					pts = null;
					setText(q["fr-info"], tl ? "Control Hub records your flights from now on" : "Loading…");
					q["fr-svg"].innerHTML = q["fr-psvg"].innerHTML = q["fr-tiles"].innerHTML = "";
					return;
				}
				var data = loadTrack(String(chosen.id));
				if (!data || data.length < 2) { setText(q["fr-info"], data ? "Not enough points yet" : "Loading the flight…"); return; }
				var W = q["fr-map"].clientWidth, H = q["fr-map"].clientHeight;
				var key = chosen.id + ":" + data.length + ":" + W + "x" + H + document.body.classList.contains("theme-light");
				if (key === shown) return;
				shown = key;
				pts = data;
				map = fitMap(pts, W, H);
				q["fr-tiles"].innerHTML = mapTiles(map, W, H);
				var maxAlt = Math.max.apply(null, pts.map(function (x) { return x[3]; }));
				// The track, coloured by height.
				var seg = "";
				for (var i = 1; i < pts.length; i++) {
					var a = map.xy(pts[i - 1][1], pts[i - 1][2]), b = map.xy(pts[i][1], pts[i][2]);
					seg += '<line x1="' + a.x.toFixed(1) + '" y1="' + a.y.toFixed(1) + '" x2="' + b.x.toFixed(1) + '" y2="' + b.y.toFixed(1) + '" stroke="' + altColor(pts[i][3], maxAlt) + '"/>';
				}
				q["fr-svg"].setAttribute("viewBox", "0 0 " + W + " " + H);
				q["fr-svg"].innerHTML = seg;
				// Height profile.
				var tMax = pts[pts.length - 1][0] || 1, PH = 100;
				var path = pts.map(function (x, i2) { return (i2 ? "L" : "M") + ((x[0] / tMax) * 1000).toFixed(1) + " " + (PH - (x[3] / Math.max(1000, maxAlt)) * (PH - 6)).toFixed(1); }).join(" ");
				q["fr-psvg"].setAttribute("viewBox", "0 0 1000 " + PH);
				q["fr-psvg"].innerHTML = '<path class="fr-area" d="' + path + " L1000 " + PH + " L0 " + PH + ' Z"/><path class="fr-pl" d="' + path + '"/>';
				if (chosen.live) pos = 1;
				showPos();
			};
		},
	};

	/* ================================================================== game-mode clean-up */
	var progP = poller("/api/programs", 4000, 15000);
	/* Pick programs to close: from what's running now. */
	function pickPrograms(chosen, onDone, back) {
		chosen = (chosen || []).map(function (a) { return { exe: a.exe, name: a.name, icon: a.icon, force: !!a.force }; });
		var wrap = el("div", "opts gc-pick");
		Editor.modal("Programs to close", wrap, back);
		function has(exe) { return chosen.filter(function (a) { return a.exe === exe; })[0]; }
		function draw() {
			var r = progP.data, items = (r && r.items) || [];
			wrap.innerHTML = "";
			wrap.appendChild(el("p", "hint", "Tap the programs to close before you play. Programs with a window close like clicking X (they may ask to save). Background programs are ended."));
			var list = el("div", "opt-list");
			// Chosen ones first (also when they aren't running right now).
			var rows = chosen.slice();
			items.forEach(function (it) { if (!has(it.exe)) rows.push(it); });
			rows.forEach(function (it) {
				var on = !!has(it.exe), live = items.filter(function (x) { return x.exe === it.exe; })[0];
				var b = el("button", "opt-row gc-row" + (on ? " on" : ""), '<span class="src-check">' + svg("check") + '</span><span class="gc-ic"></span><span><b></b><em></em></span>');
				b.querySelector("b").textContent = it.name || it.exe;
				b.querySelector("em").textContent = (live ? (live.window ? "Window" : "Background") + " · " + num(live.memMB) + " MB" : "Not running now");
				Round6.iconInto(b.querySelector(".gc-ic"), it.icon, "apps");
				b.addEventListener("click", function () {
					if (on) chosen = chosen.filter(function (a) { return a.exe !== it.exe; });
					else chosen.push({ exe: it.exe, name: it.name, icon: it.icon, force: false });
					draw();
				});
				list.appendChild(b);
			});
			if (!r) list.appendChild(el("p", "hint", "Loading your programs…"));
			wrap.appendChild(list);
			var ok = el("button", "pill accent save-btn", "Save (" + chosen.length + ")");
			ok.addEventListener("click", function () { onDone(chosen); });
			wrap.appendChild(ok);
		}
		progP.get(true);
		draw();
		var t = setInterval(function () { if (!wrap.isConnected) return clearInterval(t); if (progP.data && !wrap.__drawn) { wrap.__drawn = true; draw(); } }, 300);
	}
	function closeSet(apps) {
		if (!apps || !apps.length) return Promise.resolve(false);
		return Helper.act({ action: "gameClose", apps: apps.map(function (a) { return { exe: a.exe, force: !!a.force }; }) }, true);
	}
	function reopen() { return Helper.act({ action: "gameReopen" }, true); }
	function cleanList() { return O().cleanApps || []; }

	types.gameclean = {
		name: "Game clean-up", desc: "Close the programs you chose before playing, open them again after", icon: "wand", group: "pc", helper: true,
		w: 2, h: 1, minW: 1, minH: 1, maxW: 4, maxH: 3,
		edit: function (t, back) { pickPrograms(cleanList(), function (list) { O().cleanApps = list; Editor.saveTile(t, back); }, back); },
		build: function (ctx) {
			var st = { built: false };
			ctx.node.classList.add("press");
			ctx.node.addEventListener("click", function () {
				if (App.editing || !Helper.online || !helperNew()) return;
				var list = cleanList();
				if (!list.length) return Editor.edit(ctx.tile);
				if (O().cleanOn) {
					reopen().then(function () { U.toast("Opening your programs again"); });
					O().cleanOn = false;
				} else {
					closeSet(list).then(function () { U.toast("Closed " + list.length + " program" + (list.length === 1 ? "" : "s") + " · tap again to open them"); });
					O().cleanOn = true;
				}
				Editor.save();
				App.dirty();
			});
			return function () {
				if (gate(ctx, st)) return;
				if (!st.built) {
					ctx.body.innerHTML = '<div class="gc"><span class="gc-big">' + svg("wand") + '</span><span class="gc-tx"><b></b><em></em></span></div>';
					st.built = true;
				}
				var list = cleanList(), on = !!O().cleanOn;
				ctx.node.classList.toggle("on", on);
				setText(ctx.body.querySelector(".gc-tx b"), on ? "Cleaned up" : "Clean up");
				setText(ctx.body.querySelector(".gc-tx em"), !list.length ? "Tap to pick programs" : on ? "Tap to open them again" : "Closes " + list.map(function (a) { return a.name; }).slice(0, 3).join(", ") + (list.length > 3 ? " +" + (list.length - 3) : ""));
			};
		},
	};

	// Button steps: close programs / open them again / load the SimBrief plan.
	Buttons.addStepType("closeApps", {
		label: "Close programs", icon: "wand",
		describe: function (st) { return "Close " + ((st.apps || []).map(function (a) { return a.name; }).join(", ") || "programs"); },
		run: function (st) { O().cleanOn = true; Editor.save(); return closeSet(st.apps || []); },
		edit: function (cur, finish, w, back) { pickPrograms(cur.apps || cleanList(), function (list) { cur.apps = list; finish(); }, back); return false; },
	});
	Buttons.addStepType("reopenApps", {
		label: "Open closed programs again", icon: "restart",
		describe: function () { return "Open the closed programs again"; },
		run: function () { O().cleanOn = false; Editor.save(); return reopen(); },
		edit: function (cur, finish, w, back, okBar) { w.appendChild(el("p", "hint", "Opens what “Close programs” closed. Put it in the Off steps.")); okBar(true); },
	});
	Buttons.addStepType("simbrief", {
		label: "Load my latest SimBrief plan", icon: "plane", local: true,
		describe: function () { return "Load the latest SimBrief plan into the panel"; },
		run: function () { Flight.reloadPlan(); U.toast("Loading your SimBrief plan"); },
		edit: function (cur, finish, w, back, okBar) { w.appendChild(el("p", "hint", "Gets your newest plan from SimBrief, for the flight tiles (use it after you made a new plan).")); okBar(true); },
	});

	/* Button templates: Pre-flight and Game clean-up, with steps you switch on and off. */
	function appsList() { return Helper.online ? Helper.loadApps(false).then(null, function () { return []; }) : Promise.resolve([]); }
	Buttons.TEMPLATES.push({
		name: "Pre-flight", desc: "Pick the steps: start MSFS and your flight apps, load SimBrief, headset, clean-up, Do Not Disturb…", look: { kind: "glyph", name: "plane" }, color: "#0EA5E9", mode: "toggle",
		make: function () {
			return Buttons.withOutputs().then(appsList).then(function (apps) {
				function app(re) { return (apps || []).filter(function (a) { return a.kind !== "url" && re.test(a.name); })[0]; }
				var c = [{ label: "Remember sound and page", sub: "So “off” can go back to them", on: true, steps: [{ type: "remember" }], offSteps: [{ type: "restore" }] }];
				var msfs = app(/flight simulator 2024/i) || app(/flight simulator/i);
				if (msfs) c.push({ label: "Start " + msfs.name, on: true, steps: [{ type: "launch", id: msfs.id, name: msfs.name, icon: msfs.icon }] });
				c.push({ label: "Load my latest SimBrief plan", sub: "For the flight tiles", on: true, steps: [{ type: "simbrief" }] });
				c.push({ label: "Open SimBrief Dispatch", sub: "In your browser", on: false, steps: [{ type: "url", url: "https://dispatch.simbrief.com/home", name: "SimBrief", id: "" }] });
				[[/sayintentions/i, true], [/navigraph/i, false], [/little ?navmap/i, false], [/volanta/i, false], [/fenix/i, false], [/inibuilds/i, false], [/beyond ?atc/i, false]].forEach(function (x) {
					var a = app(x[0]);
					if (a) c.push({ label: "Start " + a.name, on: x[1], steps: [{ type: "launch", id: a.id, name: a.name, icon: a.icon }] });
				});
				var hs = Buttons.headsetOut();
				if (hs) c.push({ label: "Sound to " + hs.name, on: true, steps: [{ type: "output", mic: false, device: hs.id, name: hs.name }] });
				var prof = (window.Round8b ? Round8b.profiles() : []).filter(function (x) { return /fly|flight|sim/i.test(x.name); })[0];
				if (prof) c.push({ label: "Sound profile: " + prof.name, on: true, steps: [{ type: "sound", id: prof.id, name: prof.name }] });
				if (cleanList().length) c.push({ label: "Close " + cleanList().map(function (a) { return a.name; }).join(", "), sub: "Your clean-up list · opened again when off", on: false, steps: [{ type: "closeApps", apps: cleanList() }], offSteps: [{ type: "reopenApps" }] });
				c.push({ label: "Do Not Disturb", sub: "No Windows notifications while flying", on: true, steps: [{ type: "dnd", value: true }], offSteps: [{ type: "dnd", value: false }] });
				c.push({ label: "High performance power plan", on: false, steps: [{ type: "powerPlan", plan: "high" }], offSteps: [{ type: "powerPlan", plan: "balanced" }] });
				c.push({ label: "Keep the PC awake", on: false, steps: [{ type: "keepAwake", value: true }], offSteps: [{ type: "keepAwake", value: false }] });
				var fp = Buttons.pageFor(/^flightsimulator/, /flight/i);
				if (fp) c.push({ label: "Show the page " + fp.name, on: true, steps: [{ type: "page", id: fp.id, name: fp.name }] });
				return { choose: c };
			});
		},
	});
	Buttons.TEMPLATES.push({
		name: "Game clean-up", desc: "On: close the programs you pick, Do Not Disturb, high performance. Off: open them again", look: { kind: "glyph", name: "wand" }, color: "#F97316", mode: "toggle",
		make: function () {
			return Promise.resolve({ choose: [
				{ label: "Close programs", sub: "You pick them next (tap the step)", on: true, steps: [{ type: "closeApps", apps: cleanList() }], offSteps: [{ type: "reopenApps" }] },
				{ label: "Do Not Disturb", on: true, steps: [{ type: "dnd", value: true }], offSteps: [{ type: "dnd", value: false }] },
				{ label: "High performance power plan", on: true, steps: [{ type: "powerPlan", plan: "high" }], offSteps: [{ type: "powerPlan", plan: "balanced" }] },
				{ label: "Keep the PC awake", on: false, steps: [{ type: "keepAwake", value: true }], offSteps: [{ type: "keepAwake", value: false }] },
			] });
		},
	});

	/* ================================================================== hardware dashboard */
	var hist = {};
	function remember(src, v) {
		if (v == null) return hist[src] || [];
		var h = hist[src] || (hist[src] = []);
		var now = Date.now();
		if (!h.at || now - h.at > 1900) { h.push(v); h.at = now; if (h.length > 90) h.shift(); }
		return h;
	}
	types.hwdash = {
		name: "Hardware dashboard", desc: "Any sensors you choose: big gauges, bars or numbers, with history", icon: "gauge", group: "pc", editable: true,
		w: 4, h: 2, minW: 2, minH: 1, maxW: 16, maxH: 6, maxSources: 12, tickMs: 2000,
		defaults: function () { return { sources: ["auto:cpu", "auto:gpu", "auto:cputemp", "auto:gputemp", "auto:ram"], style: "rings", spark: true, minmax: true }; },
		sourcesOf: function (tile) { return ((tile.cfg || {}).sources || ["auto:cpu", "auto:gpu", "auto:cputemp", "auto:gputemp", "auto:ram"]).slice(0, 12); },
		edit: function (t, back) {
			var w = el("div", "opts");
			Editor.modal("Hardware dashboard", w, back);
			t.cfg = t.cfg || {};
			function draw() {
				w.innerHTML = "";
				var pick = el("button", "pill accent", svg("gauge") + "<span>Choose values (" + types.hwdash.sourcesOf(t).length + " of 12)</span>");
				pick.addEventListener("click", function () { Editor.pickSources(t, 12); });
				w.appendChild(pick);
				[["style", "Look", [["rings", "Rings"], ["bars", "Bars"], ["numbers", "Big numbers"]]], ["spark", "History line", [[true, "Show"], [false, "Hide"]]], ["minmax", "Lowest / highest", [[true, "Show"], [false, "Hide"]]]].forEach(function (o) {
					var sec = el("div", "opt", "<h4>" + esc(o[1]) + "</h4>");
					var ch = el("div", "chips");
					var cur = t.cfg[o[0]] == null ? types.hwdash.defaults()[o[0]] : t.cfg[o[0]];
					o[2].forEach(function (c) {
						var b = el("button", "chip" + (cur === c[0] ? " on" : ""), esc(c[1]));
						b.addEventListener("click", function () { t.cfg[o[0]] = c[0]; Editor.save(); App.render(); draw(); });
						ch.appendChild(b);
					});
					sec.appendChild(ch);
					w.appendChild(sec);
				});
				var ok = el("button", "pill save-btn", "Done");
				ok.addEventListener("click", function () { Editor.saveTile(t, back); });
				w.appendChild(ok);
			}
			draw();
		},
		build: function (ctx) {
			var cfg = ctx.tile.cfg || {};
			var srcs = types.hwdash.sourcesOf(ctx.tile), style = cfg.style || "rings";
			ctx.body.innerHTML = '<div class="hd hd-' + style + '"></div>';
			var box = ctx.body.querySelector(".hd"), cells = [];
			var lohi = {};
			srcs.forEach(function (src) {
				var c = el("div", "hd-c", (style === "rings" ? '<svg class="hd-ring" viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" class="hd-tr"/><circle cx="20" cy="20" r="16" class="hd-fl"/></svg>' : "") +
					'<span class="hd-l"></span><b class="hd-v"></b>' + (style === "bars" ? '<div class="bar"><i></i></div>' : "") + '<em class="hd-mm"></em><svg class="hd-sp" viewBox="0 0 100 30" preserveAspectRatio="none"><path/></svg>');
				box.appendChild(c);
				cells.push({ src: src, el: c, l: c.querySelector(".hd-l"), v: c.querySelector(".hd-v"), fl: c.querySelector(".hd-fl"), bar: c.querySelector(".bar i"), mm: c.querySelector(".hd-mm"), sp: c.querySelector(".hd-sp path") });
			});
			box.style.setProperty("--n", srcs.length);
			return function () {
				cells.forEach(function (c) {
					var r = T.readSource(c.src);
					setText(c.l, r.label.replace(/ load$/i, ""));
					var pct = /%/.test(r.units), unit = pct ? "%" : r.units;
					setHtml(c.v, r.value == null ? "--" : esc(T.fmtValue(r.value, r.units)) + "<small>" + esc(unit) + "</small>");
					var scale = U.clamp(pct ? r.value || 0 : T.scaleOf(r.value, r.units), 0, 100);
					if (c.fl) c.fl.style.strokeDasharray = (scale * 1.005).toFixed(1) + " 200";
					if (c.bar) c.bar.style.width = scale + "%";
					var hot = /°/.test(r.units) ? r.value >= 90 : pct && r.value >= 95;
					c.el.classList.toggle("hot", !!hot);
					var h = remember(c.src, r.value);
					if (r.value != null) {
						var m = lohi[c.src] || (lohi[c.src] = { lo: r.value, hi: r.value });
						m.lo = Math.min(m.lo, r.value); m.hi = Math.max(m.hi, r.value);
						setText(c.mm, cfg.minmax === false ? "" : "↓" + T.fmtValue(m.lo, r.units) + "  ↑" + T.fmtValue(m.hi, r.units));
					}
					c.sp.setAttribute("d", cfg.spark === false ? "" : Extra._spark(h, pct ? 0 : null, pct ? 100 : null));
				});
			};
		},
	};

	/* ================================================================== Steam downloads */
	var dlP = poller("/api/steamdl", 4000, 10000);
	function size(b) { var g = (b || 0) / 1073741824; return g >= 1 ? g.toFixed(1) + " GB" : Math.round((b || 0) / 1048576) + " MB"; }
	function speedText(b) { var m = (b || 0) * 8 / 1e6; return b > 0 ? (m >= 10 ? Math.round(m) : m.toFixed(1)) + " Mbit/s" : ""; }
	types.steamdl = {
		name: "Steam downloads", desc: "Games Steam is downloading or updating, with progress", icon: "down", group: "pc", helper: true,
		w: 3, h: 1, minW: 2, minH: 1, maxW: 8, maxH: 4, tickMs: 4000,
		build: function (ctx) {
			var st = { built: false }, box;
			ctx.node.classList.add("press");
			ctx.node.addEventListener("click", function () { if (!App.editing && Helper.online && helperNew()) Helper.act({ action: "steamDownloads" }, true); });
			return function () {
				if (gate(ctx, st)) return;
				if (!st.built) {
					ctx.body.innerHTML = '<div class="sd"></div>';
					box = ctx.body.querySelector(".sd");
					st.built = true;
				}
				var r = dlP.get(), items = (r && r.items) || [];
				ctx.node.classList.toggle("sd-busy", items.some(function (x) { return x.state === "downloading" || x.state === "installing" || x.state === "verifying"; }));
				if (!r) return setHtml(box, '<div class="notice small"><span>Looking at Steam…</span></div>');
				if (!items.length) return setHtml(box, '<div class="sd-none">' + svg("check") + "<span><b>Steam is up to date</b><em>Nothing downloading · tap to open Steam downloads</em></span></div>");
				var max = Math.max(1, ctx.h * (ctx.w >= 4 ? 2 : 1));
				setHtml(box, items.slice(0, max).map(function (g) {
					var total = g.total || g.stageTotal, done = g.total ? g.done : g.staged;
					var pc = total ? Math.round((done / total) * 100) : 0;
					var stateText = { downloading: "Downloading", installing: "Installing", verifying: "Verifying", paused: "Paused", queued: "Waiting" }[g.state] || g.state;
					return '<div class="sd-row sd-' + esc(g.state) + '"><span class="sd-art" style="background-image:url(&quot;https://cdn.cloudflare.steamstatic.com/steam/apps/' + esc(g.id) + '/capsule_184x69.jpg&quot;)"></span><div class="sd-tx"><div class="sd-top"><b>' + esc(g.name) + "</b><span>" + esc(stateText) + (total ? " · " + pc + "%" : "") + '</span></div><div class="bar"><i style="width:' + pc + '%"></i></div><em>' + (total ? size(done) + " of " + size(total) : "") + (g.speed ? " · " + speedText(g.speed) : "") + "</em></div></div>";
				}).join("") + (items.length > max ? '<em class="sd-more">+' + (items.length - max) + " more</em>" : ""));
			};
		},
	};

	/* ================================================================== what's using my PC */
	var useHist = { cpu: [], gpu: [], ram: [], at: 0 };
	types.pcusage = {
		name: "What's using my PC", desc: "CPU, GPU and RAM over time, and the programs using the most", icon: "chart", group: "pc", helper: true, parts: ["system", "top"],
		w: 5, h: 2, minW: 3, minH: 2, maxW: 12, maxH: 6, tickMs: 2000,
		defaults: function () { return { sort: "cpu", minutes: 3 }; },
		options: function () {
			return [
				{ key: "minutes", label: "Graph shows the last", type: "choice", "default": 3, choices: [{ value: 1, label: "1 minute" }, { value: 3, label: "3 minutes" }, { value: 10, label: "10 minutes" }] },
				{ key: "sort", label: "Programs by", type: "choice", "default": "cpu", choices: [{ value: "cpu", label: "CPU" }, { value: "memory", label: "Memory" }] },
			];
		},
		build: function (ctx) {
			var cfg = ctx.tile.cfg || (ctx.tile.cfg = {});
			ctx.body.innerHTML = '<div class="pu"><div class="pu-g"><div class="pu-leg"></div><svg viewBox="0 0 100 50" preserveAspectRatio="none"><path class="pu-cpu"/><path class="pu-gpu"/><path class="pu-ram"/></svg></div><div class="pu-list"></div></div>';
			var leg = ctx.body.querySelector(".pu-leg"), list = ctx.body.querySelector(".pu-list");
			var paths = { cpu: ctx.body.querySelector(".pu-cpu"), gpu: ctx.body.querySelector(".pu-gpu"), ram: ctx.body.querySelector(".pu-ram") };
			list.addEventListener("click", function (e) {
				var r = e.target.closest("[data-exe]");
				if (!r || App.editing) return;
				e.stopPropagation();
				if (r.dataset.close !== "1") return U.toast(r.dataset.name + " is part of Windows or iCUE");
				Editor.confirm({ title: "Close " + r.dataset.name + "?", text: "Like clicking its X. Unsaved work may ask to be saved.", ok: "Close", icon: "x", danger: true }, function () {
					Helper.act({ action: "closeApp", exe: r.dataset.exe, force: false });
				});
			});
			function line(arr, n) {
				if (arr.length < 2) return "";
				var a = arr.slice(-n), step = 100 / (n - 1), off = n - a.length;
				return a.map(function (v, i) { return (i ? "L" : "M") + ((i + off) * step).toFixed(1) + " " + (50 - U.clamp(v, 0, 100) * 0.48).toFixed(1); }).join(" ");
			}
			return function () {
				if (helperGate(ctx) === true) return;
				var now = Date.now();
				var cpu = Helper.state.cpu, ram = (Helper.state.memory || {}).percent, gpu = T.readSource("auto:gpu").value;
				if (now - useHist.at > 1800) {
					useHist.at = now;
					[["cpu", cpu], ["gpu", gpu], ["ram", ram]].forEach(function (x) { if (x[1] != null) { useHist[x[0]].push(x[1]); if (useHist[x[0]].length > 300) useHist[x[0]].shift(); } });
				}
				var n = Math.round((cfg.minutes || 3) * 30);
				Object.keys(paths).forEach(function (k) { paths[k].setAttribute("d", line(useHist[k], n)); });
				setHtml(leg, '<span class="c">CPU <b>' + (cpu == null ? "--" : Math.round(cpu) + "%") + '</b></span><span class="g">GPU <b>' + (gpu == null ? "--" : Math.round(gpu) + "%") + '</b></span><span class="r">RAM <b>' + (ram == null ? "--" : Math.round(ram) + "%") + "</b></span>");
				var top = Helper.state.top, sort = cfg.sort || "cpu";
				var rows = (top && top[sort]) || [];
				var max = Math.max(3, ctx.h * 3 - 1);
				setHtml(list, rows.slice(0, max).map(function (a) {
					var val = sort === "cpu" ? (a.cpu || 0).toFixed(a.cpu >= 10 ? 0 : 1) + "%" : (a.memMB >= 1024 ? (a.memMB / 1024).toFixed(1) + " GB" : Math.round(a.memMB) + " MB");
					var w = sort === "cpu" ? U.clamp(a.cpu || 0, 0, 100) : U.clamp((a.memMB || 0) / 80, 0, 100);
					return '<div class="pu-row" data-exe="' + esc(a.exe) + '" data-name="' + esc(a.name) + '" data-close="' + (a.canClose ? 1 : 0) + '"><span class="pu-n">' + esc(a.name) + "</span><b>" + esc(val) + '</b><div class="bar"><i style="width:' + w + '%"></i></div></div>';
				}).join("") || '<div class="notice small"><span>' + (top && top.ready === false ? "Measuring…" : "Loading…") + "</span></div>");
			};
		},
	};

	return {
		progress: progress,
		routeOf: routeOf,
		pickPrograms: pickPrograms,
		fitMap: fitMap,
		mapTiles: mapTiles,
	};
})();
