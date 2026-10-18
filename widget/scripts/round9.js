/* Control Panel — Round 9.
 * Ready-made pages (Home, Flight sim, CS2), descent planner, logbook + airports map, landing trend, day or night at arrival,
 * CS2 buy tip and form, tiles that pulse when they need you, and everyday tiles: electricity price, pollen and air,
 * currency, calculator, "on air" light, downloads, recent files, website check, device batteries, day overview, copy board.
 * Helper 2.4.0 is needed for: on air, downloads, recent files, website check, device batteries, copy board, airports map. */

var Round9 = (function () {
	var el = U.el, svg = U.svg, esc = U.esc, setText = U.setText, setHtml = U.setHtml;
	var types = T.types, helperGate = T.helperGate, poller = Round6.poller;

	function L() { return Editor.layout(); }
	function O() { var l = L(); return l.opts || (l.opts = {}); }
	function two(n) { return ("0" + n).slice(-2); }
	function num(n, d) { return n == null || isNaN(n) ? "--" : (+n).toLocaleString("en-GB", { maximumFractionDigits: d || 0, minimumFractionDigits: d || 0 }); }
	function sim() { var s = Helper.state && Helper.state.sim; return s && s.connected ? s : null; }

	/* ------------------------------------------------------------------ helper version */
	function verNum(v) { var p = String(v || "0").split("."); return (+p[0] || 0) * 10000 + (+p[1] || 0) * 100 + (+p[2] || 0); }
	function helperNew() { var v = Helper.state.version; return !v || v === "mock" || verNum(v) >= verNum("2.4.0"); }
	var OLD = '<div class="notice small"><b>Update the helper</b><span>Run Build Helper.bat once (helper 2.4.0) for this.</span></div>';
	function gate(ctx, st) {
		if (helperGate(ctx) === true) { st.built = false; return true; }
		if (!helperNew()) { if (st.built !== "old") { ctx.body.innerHTML = OLD; st.built = "old"; } return true; }
		if (st.built === "old") st.built = false;
		return false;
	}

	/* Web data through the helper (it keeps a short cache), or directly when the helper isn't there. */
	function getJson(url, ms) {
		if (Helper.online) return Helper.fetch("/api/fetch?url=" + encodeURIComponent(url), { cache: "no-store" }, ms || 15000);
		return fetch(url, { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("http"); return r.json(); });
	}
	var store = {};
	function cached(key, maxAge, load) {
		var c = store[key] || (store[key] = { at: 0, data: null, err: null, busy: false });
		if (!c.busy && Date.now() - c.at > (c.err ? 120000 : maxAge)) {
			c.busy = true;
			load().then(function (d) { c.data = d; c.err = null; }, function (e) { c.err = e || true; }).then(function () { c.at = Date.now(); c.busy = false; App.dirty(); });
		}
		return c;
	}

	/* Your place: the Weather tile's city (or Copenhagen). */
	function homePlace() {
		var w = null;
		L().pages.forEach(function (pg) { pg.tiles.forEach(function (t) { if (!w && t.type === "weather" && t.cfg && t.cfg.lat != null) w = t.cfg; }); });
		return w ? { lat: +w.lat, lon: +w.lon, name: w.name || "" } : { lat: 55.6759, lon: 12.5655, name: "Copenhagen" };
	}

	function ago(t) {
		var m = Math.round((Date.now() - t) / 60000);
		return m < 1 ? "now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : m < 2880 ? "yesterday" : Math.round(m / 1440) + " days ago";
	}
	function size(b) { if (b == null) return ""; var k = b / 1024; return k < 1024 ? Math.max(1, Math.round(k)) + " KB" : k < 1048576 ? (k / 1024).toFixed(1) + " MB" : (k / 1048576).toFixed(1) + " GB"; }

	/* Small helper for a tile that pulses when it needs you (Look → Motion can turn it off). */
	function attn(ctx, on) { ctx.node.classList.toggle("attn", !!on); }

	/* ================================================================== ready-made pages */
	/* Designed for the XENEON EDGE's usual grid (15 × 4). On other sizes tiles keep their order and find the nearest free spot. */
	function T9(type, x, y, w, h, cfg) {
		var t = Editor.makeTile(type, w, h, cfg);
		t.x = x; t.y = y;
		return t;
	}
	function fitToGrid(tiles) {
		var g = Editor.gridInfo() || { cols: 15, rows: 4 };
		if (g.cols === 15 && g.rows === 4) return tiles;
		var fx = g.cols / 15, fy = g.rows / 4;
		tiles.forEach(function (t) {
			var def = T.types[t.type];
			t.x = Math.floor(t.x * fx); t.y = Math.floor(t.y * fy);
			t.w = Math.max(def.minW, Math.round(t.w * fx)); t.h = Math.max(def.minH, Math.round(t.h * fy));
		});
		return tiles;
	}
	function presets() {
		return [
			{
				name: "Home", sub: "Clock, weather, your day, music, power price, sound and shortcuts · Nordic look",
				make: function () {
					return { name: "Home", theme: "nordic", tiles: fitToGrid([
						T9("clock", 0, 0, 3, 2, { style: "flip" }),
						T9("dayview", 3, 0, 4, 2),
						T9("weather", 7, 0, 4, 2, { name: homePlace().name || "Copenhagen", lat: homePlace().lat, lon: homePlace().lon }),
						T9("media", 11, 0, 4, 2),
						T9("calendar", 0, 2, 3, 2),
						T9("elprice", 3, 2, 4, 2),
						T9("speakers", 7, 2, 2, 1),
						T9("mic", 7, 3, 2, 1),
						T9("notes", 9, 2, 2, 2),
						T9("power", 11, 2, 2, 2),
						T9("dnd", 13, 2, 1, 1),
						T9("keepawake", 14, 2, 1, 1),
						T9("downloads", 13, 3, 2, 1),
					]) };
				},
			},
			{
				name: "Flight sim", sub: "Next waypoint, flight data, map, SayIntentions, descent, fuel and route weather · Cockpit look · shows when MSFS starts",
				make: function () {
					return { name: "Flight sim", theme: "cockpit", auto: { exe: "flightsimulator2024.exe", name: "Microsoft Flight Simulator 2024", back: true }, tiles: fitToGrid([
						T9("nextwpt", 0, 0, 7, 1),
						T9("fdash", 0, 1, 4, 2),
						T9("tod", 4, 1, 3, 1),
						T9("fuelchk", 4, 2, 3, 2),
						T9("radio", 0, 3, 2, 1),
						T9("ftimer", 2, 3, 2, 1),
						T9("flightmap", 7, 0, 4, 4),
						T9("sayintentions", 11, 0, 4, 2),
						T9("routewx", 11, 2, 4, 2),
					]) };
				},
			},
			{
				name: "CS2", sub: "Score, you, buy tip, bomb timer, weapon, form, history, Discord and push-to-talk · Neon look · shows when CS2 starts",
				make: function () {
					return { name: "CS2", theme: "neon", auto: { exe: "cs2.exe", name: "Counter-Strike 2", back: true }, tiles: fitToGrid([
						T9("cs2score", 0, 0, 5, 1),
						T9("cs2stats", 0, 1, 5, 2),
						T9("discord", 0, 3, 5, 1),
						T9("cs2buy", 5, 0, 4, 2),
						T9("cs2form", 5, 2, 4, 2),
						T9("cs2bomb", 9, 0, 3, 2),
						T9("cs2history", 9, 2, 3, 2),
						T9("cs2kills", 12, 0, 3, 1),
						T9("cs2weapon", 12, 1, 3, 2),
						T9("ptt", 12, 3, 3, 1, { combo: "", mode: "hold", label: "Team" }),
					]) };
				},
			},
		];
	}

	/* ================================================================== descent planner (replaces "Top of descent") */
	types.tod = {
		name: "Descent planner", desc: "Distance and time to your descent, the rate you'll need, and whether you're high or low", icon: "plane", group: "flight", helper: true, parts: ["sim"],
		w: 3, h: 1, minW: 2, minH: 1, maxW: 8, maxH: 3, tickMs: 2000,
		defaults: function () { return { angle: 3, finishNm: 10, finishFt: 1500 }; },
		options: function () {
			return [
				{ key: "angle", label: "Descent angle", type: "choice", "default": 3, choices: [{ value: 2.5, label: "2.5°" }, { value: 3, label: "3° (normal)" }, { value: 3.5, label: "3.5°" }] },
				{ key: "finishNm", label: "Be down by", type: "choice", "default": 10, choices: [{ value: 5, label: "5 NM out" }, { value: 10, label: "10 NM out" }, { value: 15, label: "15 NM out" }, { value: 20, label: "20 NM out" }] },
				{ key: "finishFt", label: "At this height above the airport", type: "choice", "default": 1500, choices: [{ value: 1500, label: "1,500 ft" }, { value: 3000, label: "3,000 ft" }, { value: 5000, label: "5,000 ft" }] },
			];
		},
		build: function (ctx) {
			ctx.body.innerHTML = '<div class="dp"></div>';
			var box = ctx.body.querySelector(".dp");
			return function () {
				if (Flight.simGate(ctx, box)) return attn(ctx, false);
				var s = sim(), c = Flight.plan(), p = c.data, cfg = ctx.tile.cfg || {};
				if (!p || p.to_lat == null) return setHtml(box, '<div class="notice small"><span>Needs your SimBrief plan</span></div>');
				var pr = Round8c.progress(p, s);
				var R = pr ? pr.remaining : Flight.distNm(s.lat, s.lon, p.to_lat, p.to_lon);
				var ang = +cfg.angle || 3, finNm = +cfg.finishNm || 10, finFt = +cfg.finishFt || 1500;
				var ftPerNm = Math.tan(ang * Math.PI / 180) * 6076;
				var target = (p.to_elev || 0) + finFt;
				var toLose = Math.max(0, s.alt - target);
				var needNm = toLose / ftPerNm + finNm;
				var toTod = R - needNm;
				var gs = s.gs > 60 ? s.gs : 420;
				var pathVs = Math.round((gs * ftPerNm / 60) / 50) * 50;
				var ideal = target + Math.max(0, R - finNm) * ftPerNm;
				var dev = s.alt - ideal; // + = high
				var descending = s.vs < -500 || s.phase === "descent" || s.phase === "approach";
				var big, sub, cls = "";
				if (s.ground) { big = "On the ground"; sub = num(R) + " NM route to " + esc(p.to); }
				else if (!descending && toTod > 0) {
					big = num(toTod) + "<small> NM</small>";
					sub = "to top of descent · " + Math.max(0, Math.round(toTod / gs * 60)) + " min · then " + num(pathVs) + " fpm";
					if (toTod < 5) cls = "now";
				} else if (!descending) {
					big = "Descend now";
					var needVs = R - finNm > 1 ? Math.round(toLose / ((R - finNm) / gs * 60) / 50) * 50 : 0;
					sub = num(Math.abs(dev)) + " ft high · need about " + num(needVs) + " fpm";
					cls = "now";
				} else {
					var hi = dev > 300, lo = dev < -300;
					big = hi ? num(dev) + "<small> ft high</small>" : lo ? num(-dev) + "<small> ft low</small>" : "On path";
					var need = R - finNm > 1 ? Math.round(Math.max(0, s.alt - target) / ((R - finNm) / gs * 60) / 50) * 50 : 0;
					sub = "Now " + num(-s.vs) + " fpm down · need " + num(need) + " fpm · " + num(R) + " NM to go";
					cls = hi ? "high" : lo ? "low" : "ok";
				}
				ctx.node.dataset.dp = cls;
				attn(ctx, cls === "now");
				var profile = "";
				if (ctx.h >= 2 && !s.ground) {
					// A little side view: the ideal path and where you are.
					var span = Math.max(R + 20, needNm + 30), W = 300, H = 80;
					var x = function (nm) { return W - (nm / span) * W; }, maxAlt = Math.max(s.alt, ideal, 10000);
					var y = function (ft) { return H - 6 - (ft / maxAlt) * (H - 14); };
					var path = "M" + x(finNm).toFixed(1) + " " + y(target).toFixed(1) + " L" + x(Math.min(span, needNm)).toFixed(1) + " " + y(s.alt).toFixed(1) + " L0 " + y(s.alt).toFixed(1);
					profile = '<svg class="dp-prof" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none"><path class="dp-gnd" d="M0 ' + (H - 6) + " L" + W + " " + (H - 6) + '"/><path class="dp-path" d="' + path + '"/><circle class="dp-me" cx="' + x(R).toFixed(1) + '" cy="' + y(s.alt).toFixed(1) + '" r="4"/></svg>';
				}
				setHtml(box, '<div class="dp-top"><b class="dp-big">' + big + '</b><span class="dp-sub">' + sub + "</span></div>" + profile);
			};
		},
	};

	/* ================================================================== logbook */
	var logP = poller("/api/flightlog", 120000, 8000);
	function flights() { var r = logP.get(); return r ? r.flights || [] : null; }
	function hours(min) { return min >= 60 ? Math.floor(min / 60) + " h " + two(Math.round(min % 60)) : Math.round(min) + " min"; }
	types.logbook = {
		name: "Logbook", desc: "Totals per aircraft and per airport from your flight log", icon: "list", group: "flight", helper: true,
		w: 5, h: 3, minW: 3, minH: 2, maxW: 12, maxH: 6, tickMs: 60000,
		build: function (ctx) {
			var cfg = ctx.tile.cfg || (ctx.tile.cfg = {});
			ctx.body.innerHTML = '<div class="lb-tabs no-swipe"><button data-t="sum">Totals</button><button data-t="ac">Aircraft</button><button data-t="ap">Airports</button></div><div class="lb"></div>';
			var box = ctx.body.querySelector(".lb");
			U.dragScroll(box);
			ctx.body.querySelector(".lb-tabs").addEventListener("click", function (e) {
				var b = e.target.closest("[data-t]");
				if (!b || App.editing) return;
				e.stopPropagation();
				cfg.tab = b.dataset.t;
				Editor.save();
				shown = "";
				App.dirty();
			});
			var shown = "";
			return function () {
				if (helperGate(ctx) === true) return;
				var fl = flights(), tab = cfg.tab || "sum";
				ctx.body.querySelectorAll(".lb-tabs button").forEach(function (b) { b.classList.toggle("on", b.dataset.t === tab); });
				if (!fl) return setHtml(box, '<div class="notice small"><span>Loading…</span></div>');
				var key = tab + fl.length + ctx.w + ctx.h;
				if (key === shown) return;
				shown = key;
				if (!fl.length) return setHtml(box, '<div class="notice small"><span>Your flights show up here after you land and park.</span></div>');
				var html = "";
				if (tab === "sum") {
					var air = 0, block = 0, fpm = [], best = null, longest = null, aps = {};
					fl.forEach(function (f) {
						air += f.airMin || 0; block += f.blockMin || 0;
						if (f.fpm) { fpm.push(f.fpm); if (!best || f.fpm < best.fpm) best = f; }
						if (!longest || (f.airMin || 0) > (longest.airMin || 0)) longest = f;
						if (f.from) aps[f.from] = 1; if (f.to) aps[f.to] = 1;
					});
					var avg = fpm.length ? fpm.reduce(function (a, b) { return a + b; }, 0) / fpm.length : null;
					function cell(k, v, sub) { return '<div class="lb-c"><span>' + esc(k) + "</span><b>" + v + "</b>" + (sub ? "<em>" + esc(sub) + "</em>" : "") + "</div>"; }
					html = '<div class="lb-grid">' + cell("Flights", num(fl.length)) + cell("In the air", esc(hours(air))) + cell("Block time", esc(hours(block))) + cell("Airports", num(Object.keys(aps).length)) +
						cell("Average landing", avg == null ? "--" : num(avg) + " fpm") + cell("Best landing", best ? num(best.fpm) + " fpm" : "--", best ? best.to + " · " + (best.aircraft || "") : "") +
						cell("Longest flight", longest ? esc(hours(longest.airMin || 0)) : "--", longest ? longest.from + " → " + longest.to : "") + cell("This month", num(fl.filter(function (f) { var d = new Date(f.date), n = new Date(); return d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear(); }).length) + " flights") + "</div>";
				} else if (tab === "ac") {
					var by = {};
					fl.forEach(function (f) {
						var k = String(f.aircraft || "Unknown").replace(/\s+(Airbus House|Livery).*$/i, "").slice(0, 40);
						var a = by[k] || (by[k] = { n: 0, min: 0, fpm: [] });
						a.n++; a.min += f.airMin || 0; if (f.fpm) a.fpm.push(f.fpm);
					});
					html = '<div class="lb-tbl"><div class="lb-h"><span>Aircraft</span><span>Flights</span><span>Hours</span><span>Avg landing</span></div>' + Object.keys(by).sort(function (a, b) { return by[b].min - by[a].min; }).map(function (k) {
						var a = by[k], av = a.fpm.length ? a.fpm.reduce(function (x, y) { return x + y; }, 0) / a.fpm.length : null;
						return '<div class="lb-r"><b>' + esc(k) + "</b><span>" + a.n + "</span><span>" + (a.min / 60).toFixed(1) + "</span><span>" + (av == null ? "--" : num(av) + " fpm") + "</span></div>";
					}).join("") + "</div>";
				} else {
					var ap = {};
					fl.forEach(function (f) {
						if (f.from) { var a = ap[f.from] || (ap[f.from] = { d: 0, a: 0 }); a.d++; }
						if (f.to) { var b = ap[f.to] || (ap[f.to] = { d: 0, a: 0 }); b.a++; }
					});
					html = '<div class="lb-tbl"><div class="lb-h"><span>Airport</span><span>Departures</span><span>Arrivals</span><span>Total</span></div>' + Object.keys(ap).sort(function (x, y) { return (ap[y].d + ap[y].a) - (ap[x].d + ap[x].a); }).map(function (k) {
						return '<div class="lb-r"><b>' + esc(k) + "</b><span>" + ap[k].d + "</span><span>" + ap[k].a + "</span><span>" + (ap[k].d + ap[k].a) + "</span></div>";
					}).join("") + "</div>";
				}
				setHtml(box, html);
			};
		},
	};

	/* ------------------------------------------------------------------ every airport you've flown to, on a map */
	var posStore = { ids: "", data: null, busy: false };
	function airportPositions(ids) {
		var key = ids.slice().sort().join(",");
		if (key && key !== posStore.ids && !posStore.busy) {
			posStore.busy = true;
			Helper.fetch("/api/airports?ids=" + encodeURIComponent(key), { cache: "no-store" }, 30000).then(function (r) { posStore.data = (r && r.airports) || {}; posStore.ids = key; }, function () {}).then(function () { posStore.busy = false; App.dirty(); });
		}
		return posStore.data;
	}
	types.logmap = {
		name: "My airports map", desc: "Every airport you've flown to and your routes, on a map", icon: "globe", group: "flight", helper: true,
		w: 5, h: 3, minW: 3, minH: 2, maxW: 16, maxH: 8, tickMs: 120000,
		build: function (ctx) {
			var st = { built: false }, q = {}, shown = "";
			ctx.node.classList.add("no-swipe");
			return function () {
				if (gate(ctx, st)) return;
				if (!st.built) {
					ctx.body.innerHTML = '<div class="lm"><div class="fr-tiles"></div><svg class="lm-svg"></svg><div class="lm-info"></div><span class="fm-copy">© OpenStreetMap © CARTO</span></div>';
					["lm", "fr-tiles", "lm-svg", "lm-info"].forEach(function (c) { q[c] = ctx.body.querySelector("." + c); });
					st.built = true;
					shown = "";
				}
				var fl = flights();
				if (!fl) return setText(q["lm-info"], "Loading…");
				var visits = {}, routes = {};
				fl.forEach(function (f) {
					if (f.from) visits[f.from] = (visits[f.from] || 0) + 1;
					if (f.to) visits[f.to] = (visits[f.to] || 0) + 1;
					if (f.from && f.to) { var k = [f.from, f.to].sort().join("-"); routes[k] = (routes[k] || 0) + 1; }
				});
				var ids = Object.keys(visits);
				if (!ids.length) return setText(q["lm-info"], "Your airports show up here after your first logged flight");
				var pos = airportPositions(ids);
				if (!pos) return setText(q["lm-info"], "Finding your airports…");
				var W = q.lm.clientWidth, H = q.lm.clientHeight;
				var key = JSON.stringify(visits) + W + "x" + H + document.body.classList.contains("theme-light");
				if (key === shown) return;
				shown = key;
				var pts = ids.filter(function (i) { return pos[i]; }).map(function (i) { return [0, pos[i][0], pos[i][1]]; });
				if (!pts.length) return setText(q["lm-info"], "Couldn't find the airports' positions");
				if (pts.length === 1) pts.push([0, pts[0][1] + 1, pts[0][2] + 1.5], [0, pts[0][1] - 1, pts[0][2] - 1.5]);
				var m = Round8c.fitMap(pts, W, H);
				q["fr-tiles"].innerHTML = Round8c.mapTiles(m, W, H);
				var maxV = Math.max.apply(null, ids.map(function (i) { return visits[i]; }));
				var svgHtml = Object.keys(routes).map(function (k) {
					var ab = k.split("-"), a = pos[ab[0]], b = pos[ab[1]];
					if (!a || !b) return "";
					var A = m.xy(a[0], a[1]), B = m.xy(b[0], b[1]);
					// A gentle curve, thicker for routes you fly often.
					var mx = (A.x + B.x) / 2 - (B.y - A.y) * 0.15, my = (A.y + B.y) / 2 + (B.x - A.x) * 0.15;
					return '<path d="M' + A.x.toFixed(1) + " " + A.y.toFixed(1) + " Q" + mx.toFixed(1) + " " + my.toFixed(1) + " " + B.x.toFixed(1) + " " + B.y.toFixed(1) + '" style="stroke-width:' + Math.min(5, 1.2 + routes[k] * 0.6).toFixed(1) + '"/>';
				}).join("") + ids.filter(function (i) { return pos[i]; }).map(function (i) {
					var P = m.xy(pos[i][0], pos[i][1]), r = 3 + (visits[i] / maxV) * 5;
					return '<circle cx="' + P.x.toFixed(1) + '" cy="' + P.y.toFixed(1) + '" r="' + r.toFixed(1) + '"/>' + (ctx.w >= 4 ? '<text x="' + (P.x + r + 3).toFixed(1) + '" y="' + (P.y + 4).toFixed(1) + '">' + esc(i) + "</text>" : "");
				}).join("");
				q["lm-svg"].setAttribute("viewBox", "0 0 " + W + " " + H);
				q["lm-svg"].innerHTML = svgHtml;
				setText(q["lm-info"], ids.length + " airports · " + fl.length + " flights");
			};
		},
	};

	/* ================================================================== landing trend */
	var GRADE_COLOR = { "A+": "#22c55e", A: "#4ade80", B: "#a3e635", C: "#facc15", D: "#fb923c", F: "#ef4444" };
	types.ldgtrend = {
		name: "Landing trend", desc: "Your landing rates and grades over your last flights", icon: "chart", group: "flight", helper: true,
		w: 4, h: 2, minW: 2, minH: 1, maxW: 12, maxH: 4, tickMs: 60000,
		defaults: function () { return { count: 20 }; },
		options: function () { return [{ key: "count", label: "Show the last", type: "choice", "default": 20, choices: [{ value: 10, label: "10 landings" }, { value: 20, label: "20 landings" }, { value: 40, label: "40 landings" }] }]; },
		build: function (ctx) {
			ctx.body.innerHTML = '<div class="lt"><div class="lt-top"><b class="lt-avg"></b><span class="lt-sub"></span></div><div class="lt-bars"></div></div>';
			var avgEl = ctx.body.querySelector(".lt-avg"), sub = ctx.body.querySelector(".lt-sub"), bars = ctx.body.querySelector(".lt-bars"), shown = "";
			return function () {
				if (helperGate(ctx) === true) return;
				var fl = flights(), n = (ctx.tile.cfg || {}).count || 20;
				if (!fl) return setText(sub, "Loading…");
				var ls = fl.filter(function (f) { return f.fpm; }).slice(0, n).reverse();
				var key = JSON.stringify(ls.map(function (f) { return [f.date, f.fpm]; })) + ctx.w;
				if (key === shown) return;
				shown = key;
				if (!ls.length) { setText(avgEl, "--"); setText(sub, "Your landings show up here"); setHtml(bars, ""); return; }
				var avg = ls.reduce(function (a, f) { return a + f.fpm; }, 0) / ls.length;
				var half = Math.floor(ls.length / 2), older = ls.slice(0, half), newer = ls.slice(half);
				var oa = older.length ? older.reduce(function (a, f) { return a + f.fpm; }, 0) / older.length : avg, na = newer.reduce(function (a, f) { return a + f.fpm; }, 0) / newer.length;
				var trend = ls.length < 4 ? "" : na < oa - 15 ? " · getting softer ↘" : na > oa + 15 ? " · getting firmer ↗" : " · steady";
				setHtml(avgEl, num(avg) + "<small> fpm avg</small>");
				setText(sub, "best " + num(Math.min.apply(null, ls.map(function (f) { return f.fpm; }))) + " fpm" + trend);
				var max = Math.max(300, Math.max.apply(null, ls.map(function (f) { return f.fpm; })));
				setHtml(bars, ls.map(function (f) {
					return '<i title="' + esc((f.to || "") + " " + f.fpm + " fpm") + '" style="height:' + Math.max(4, (f.fpm / max) * 100).toFixed(0) + "%;background:" + (GRADE_COLOR[f.grade] || "var(--accent)") + '"><s>' + esc(f.grade || "") + "</s></i>";
				}).join("") + '<b class="lt-line" style="bottom:' + ((avg / max) * 100).toFixed(1) + '%"></b>');
			};
		},
	};

	/* ================================================================== day or night at arrival */
	/* Sun height (degrees) at a place and time (UTC ms), close enough for "day, dusk or night". */
	function sunAltitude(lat, lon, ms) {
		var d = ms / 86400000 + 2440587.5 - 2451545.0;
		var g = (357.529 + 0.98560028 * d) % 360, q = (280.459 + 0.98564736 * d) % 360, r = Math.PI / 180;
		var Lm = q + 1.915 * Math.sin(g * r) + 0.020 * Math.sin(2 * g * r);
		var e = 23.439 - 0.00000036 * d;
		var dec = Math.asin(Math.sin(e * r) * Math.sin(Lm * r));
		var ra = Math.atan2(Math.cos(e * r) * Math.sin(Lm * r), Math.cos(Lm * r)) / r;
		var gmst = (18.697374558 + 24.06570982441908 * d) % 24;
		var ha = ((gmst * 15 + lon - ra) % 360 + 360) % 360;
		var alt = Math.asin(Math.sin(lat * r) * Math.sin(dec) + Math.cos(lat * r) * Math.cos(dec) * Math.cos(ha * r));
		return alt / r;
	}
	/* Sunrise and sunset (UTC ms) on the day of `ms`, found by stepping through the day. */
	function sunTimes(lat, lon, ms) {
		var day = Math.floor(ms / 86400000) * 86400000 - lon / 15 * 3600000;
		var rise = null, set = null, prev = sunAltitude(lat, lon, day);
		for (var t = day + 600000; t <= day + 86400000; t += 600000) {
			var a = sunAltitude(lat, lon, t);
			if (prev < -0.833 && a >= -0.833 && rise == null) rise = t - 600000 * (a + 0.833) / (a - prev);
			if (prev >= -0.833 && a < -0.833 && set == null) set = t - 600000 * (a + 0.833) / (a - prev);
			prev = a;
		}
		return { rise: rise, set: set };
	}
	function zulu(ms) { if (ms == null) return "--"; var d = new Date(ms); return two(d.getUTCHours()) + two(d.getUTCMinutes()) + "Z"; }
	function lightAt(alt) { return alt > 6 ? ["day", "Daylight"] : alt > -0.833 ? ["low", "Low sun"] : alt > -6 ? ["dusk", "Twilight"] : ["night", "Night"]; }
	types.daynight = {
		name: "Day or night", desc: "Daylight, twilight or night at departure and arrival, with sunrise and sunset", icon: "sun", group: "flight",
		w: 4, h: 1, minW: 2, minH: 1, maxW: 8, maxH: 2, tickMs: 60000,
		build: function (ctx) {
			ctx.body.innerHTML = '<div class="dn"></div>';
			var box = ctx.body.querySelector(".dn");
			return function () {
				var c = Flight.plan(), p = c.data;
				if (!p || p.to_lat == null) return setHtml(box, '<div class="notice small"><span>' + (c.err ? "Couldn't get your SimBrief plan" : "Needs your SimBrief plan") + "</span></div>");
				function side(code, lat, lon, when, label) {
					if (lat == null || !when) return "";
					var alt = sunAltitude(lat, lon, when), l = lightAt(alt), st = sunTimes(lat, lon, when);
					return '<div class="dn-s dn-' + l[0] + '"><span class="dn-ic">' + svg(l[0] === "night" || l[0] === "dusk" ? "moon" : "sun") + '</span><div class="dn-tx"><span>' + esc(label) + " " + esc(code) + " · " + zulu(when) + "</span><b>" + esc(l[1]) + "</b><em>Sunrise " + zulu(st.rise) + " · sunset " + zulu(st.set) + "</em></div></div>";
				}
				// Planned times; for a flight in progress the arrival is "now + time left".
				var s = sim(), arr = p.on, dep = p.off;
				if (s && !s.ground && s.gs > 80) {
					var pr = Round8c.progress(p, s);
					if (pr) arr = Date.now() + pr.remaining / s.gs * 3600000;
				}
				setHtml(box, (ctx.w >= 4 ? side(p.from, p.from_lat, p.from_lon, dep, "Takeoff") : "") + side(p.to, p.to_lat, p.to_lon, arr, "Landing"));
			};
		},
	};

	/* ================================================================== CS2: money and buy tip */
	var LOSS = [1400, 1900, 2400, 2900, 3400];
	if (Round7.csTile) types.cs2buy = Round7.csTile({
		name: "CS2 buy tip", desc: "Your money, the loss bonus and what to buy this round", icon: "coins",
		w: 4, h: 2, minW: 2, minH: 1, maxW: 6, maxH: 3,
		defaults: function () { return { fullT: 4300, fullCT: 5000, force: 2000 }; },
		options: function () {
			return [
				{ key: "fullT", label: "Full buy as T from", type: "choice", "default": 4300, choices: [3700, 4000, 4300, 4700, 5000].map(function (v) { return { value: v, label: "$" + v }; }) },
				{ key: "fullCT", label: "Full buy as CT from", type: "choice", "default": 5000, choices: [4400, 4700, 5000, 5400, 5800].map(function (v) { return { value: v, label: "$" + v }; }) },
				{ key: "force", label: "Force buy from", type: "choice", "default": 2000, choices: [1500, 2000, 2500, 3000].map(function (v) { return { value: v, label: "$" + v }; }) },
			];
		},
		build: function (ctx) {
			ctx.body.innerHTML = '<div class="cs-main cb"><div class="cb-top"><b class="cb-money"></b><span class="cb-eq"></span></div><b class="cb-tip"></b><span class="cb-why"></span></div>';
			var q = function (c) { return ctx.body.querySelector(c); };
			return function (s) {
				var cfg = ctx.tile.cfg || {}, p = s.player || {}, m = s.map || {}, r = s.round || {};
				var team = p.team === "CT" ? "CT" : "T";
				var money = p.money || 0;
				var full = team === "CT" ? +cfg.fullCT || 5000 : +cfg.fullT || 4300, force = +cfg.force || 2000;
				var losses = (team === "CT" ? m.ctLoss : m.tLoss) || 0;
				var bonus = LOSS[Math.min(LOSS.length - 1, losses)];
				var round = (m.round || 0) + (r.phase === "over" ? 1 : 0); // rounds played
				var pistol = round === 0 || round === 12;
				var lastOfHalf = round === 11 || round === 23;
				var tip, why, kind;
				if (!p.own) { tip = "—"; why = "You're watching someone else"; kind = ""; }
				else if (pistol) { tip = "Pistol round"; why = "Armor or utility with your $" + money; kind = "pistol"; }
				else if (money >= full) { tip = "Full buy"; why = "Rifle, armor and grenades"; kind = "full"; }
				else if (lastOfHalf) { tip = "Spend it all"; why = "Last round of the half: money resets"; kind = "force"; }
				else if (money + bonus >= full) { tip = "Save"; why = "Next round you'll have ~$" + num(money + bonus) + " for a full buy"; kind = "eco"; }
				else if (money >= force) { tip = "Force buy"; why = "SMG or cheap rifle and armor"; kind = "force"; }
				else { tip = "Eco"; why = "Save for next round (loss bonus $" + num(bonus) + ")"; kind = "eco"; }
				setText(q(".cb-money"), "$" + num(money));
				setText(q(".cb-eq"), p.equip_value ? "Gear $" + num(p.equip_value) + " · loss bonus $" + num(bonus) : "Loss bonus $" + num(bonus));
				setText(q(".cb-tip"), tip);
				setText(q(".cb-why"), why);
				ctx.node.dataset.buy = kind;
				ctx.node.classList.toggle("cb-buytime", r.phase === "freezetime");
			};
		},
	});

	/* ================================================================== CS2: your form */
	var histP = poller("/api/cs2history", 60000, 6000);
	types.cs2form = {
		name: "CS2 form", desc: "K/D and wins over your last matches, and whether you're getting better", icon: "chart", group: "cs2", helper: true,
		w: 4, h: 2, minW: 2, minH: 1, maxW: 10, maxH: 4, tickMs: 60000,
		defaults: function () { return { count: 20 }; },
		options: function () { return [{ key: "count", label: "Matches", type: "choice", "default": 20, choices: [{ value: 10, label: "Last 10" }, { value: 20, label: "Last 20" }, { value: 50, label: "Last 50" }] }]; },
		build: function (ctx) {
			ctx.body.innerHTML = '<div class="cf"><div class="cf-top"><b class="cf-kd"></b><span class="cf-sub"></span></div><svg class="cf-svg" viewBox="0 0 100 40" preserveAspectRatio="none"></svg><div class="cf-wl"></div></div>';
			var kd = ctx.body.querySelector(".cf-kd"), sub = ctx.body.querySelector(".cf-sub"), sv = ctx.body.querySelector(".cf-svg"), wl = ctx.body.querySelector(".cf-wl"), shown = "";
			return function () {
				if (helperGate(ctx) === true) return;
				var r = histP.get(), n = (ctx.tile.cfg || {}).count || 20;
				if (!r) return setText(sub, "Loading…");
				var ms = (r.matches || []).slice(0, n).reverse();
				var key = JSON.stringify(ms.map(function (m) { return m.time; })) + ctx.w;
				if (key === shown) return;
				shown = key;
				if (!ms.length) { setText(kd, "--"); setText(sub, "Finished matches show up here"); sv.innerHTML = ""; setHtml(wl, ""); return; }
				var K = 0, D = 0, W = 0;
				var kds = ms.map(function (m) { K += m.k || 0; D += m.d || 0; if (m.result === "win") W++; return (m.k || 0) / Math.max(1, m.d || 0); });
				var half = Math.floor(kds.length / 2);
				var avg = function (a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : 0; };
				var trend = kds.length < 4 ? "" : avg(kds.slice(half)) > avg(kds.slice(0, half)) + 0.08 ? " · getting better ↗" : avg(kds.slice(half)) < avg(kds.slice(0, half)) - 0.08 ? " · dipping ↘" : " · steady";
				setHtml(kd, (K / Math.max(1, D)).toFixed(2) + "<small> K/D</small>");
				setText(sub, Math.round((W / ms.length) * 100) + "% wins (" + W + " of " + ms.length + ")" + trend);
				var max = Math.max(2, Math.max.apply(null, kds));
				var step = kds.length > 1 ? 100 / (kds.length - 1) : 0;
				var d = kds.map(function (v, i) { return (i ? "L" : "M") + (i * step).toFixed(1) + " " + (38 - (v / max) * 34).toFixed(1); }).join(" ");
				sv.innerHTML = '<path class="cf-one" d="M0 ' + (38 - (1 / max) * 34).toFixed(1) + ' L100 ' + (38 - (1 / max) * 34).toFixed(1) + '"/><path class="cf-line" d="' + d + '"/>';
				setHtml(wl, ms.map(function (m) { return '<i class="' + esc(m.result) + '"></i>'; }).join(""));
			};
		},
	};

	/* ================================================================== electricity price (Energi Data Service) */
	function elUrl(area, dataset) {
		var filter = encodeURIComponent(JSON.stringify({ PriceArea: [area] }));
		var timeField = dataset === "Elspotprices" ? "HourDK" : "TimeDK";
		return "https://api.energidataservice.dk/dataset/" + dataset + "?start=StartOfDay-P1D&end=StartOfDay%2BP2D&filter=" + filter + "&sort=" + timeField + "%20asc&limit=1000";
	}
	/* Hourly prices in kr/kWh (spot), from yesterday to tomorrow. */
	function elPrices(area) {
		return cached("el:" + area, 30 * 60000, function () {
			function parse(r) {
				var recs = (r && r.records) || [];
				if (!recs.length) throw new Error("none");
				var by = {};
				recs.forEach(function (x) {
					var t = x.TimeDK || x.HourDK, v = x.DayAheadPriceDKK != null ? x.DayAheadPriceDKK : x.SpotPriceDKK;
					if (!t || v == null) return;
					var h = String(t).slice(0, 13);
					(by[h] || (by[h] = [])).push(v / 1000);
				});
				return Object.keys(by).sort().map(function (h) { var a = by[h]; return { h: h, p: a.reduce(function (s, v) { return s + v; }, 0) / a.length }; });
			}
			return getJson(elUrl(area, "DayAheadPrices")).then(parse).catch(function () { return getJson(elUrl(area, "Elspotprices")).then(parse); });
		});
	}
	function localHourKey(d) { return d.getFullYear() + "-" + two(d.getMonth() + 1) + "-" + two(d.getDate()) + "T" + two(d.getHours()); }
	function elCost(cfg, spot) {
		var v = spot + (+cfg.addon || 0);
		return cfg.vat !== false ? v * 1.25 : v;
	}
	types.elprice = {
		name: "Power price", desc: "Danish electricity price now, today and tomorrow, and the cheapest hours", icon: "bolt", group: "everyday",
		w: 4, h: 2, minW: 2, minH: 1, maxW: 12, maxH: 4, tickMs: 60000,
		defaults: function () { return { area: "DK2", addon: 0, vat: true }; },
		options: function () {
			return [
				{ key: "area", label: "Where", type: "choice", "default": "DK2", choices: [{ value: "DK2", label: "East Denmark (Zealand, Copenhagen)" }, { value: "DK1", label: "West Denmark (Jutland, Funen)" }] },
				{ key: "addon", label: "Add taxes and grid fees (kr/kWh, before VAT)", hint: "Spot price alone is the market price. Your bill also has electricity tax and your grid company's fees; pick roughly what you pay on top.", type: "choice", "default": 0, choices: [{ value: 0, label: "Spot price only" }, { value: 1, label: "+1.00" }, { value: 1.25, label: "+1.25" }, { value: 1.5, label: "+1.50" }, { value: 1.75, label: "+1.75" }, { value: 2, label: "+2.00" }] },
				{ key: "vat", label: "VAT (moms)", type: "toggle", "default": true, on: "With 25 % VAT", off: "Without VAT" },
			];
		},
		build: function (ctx) {
			ctx.body.innerHTML = '<div class="ep"><div class="ep-top"><div class="ep-now"><span>Now</span><b class="ep-v"></b></div><div class="ep-cheap"></div></div><div class="ep-bars"></div><div class="ep-axis"></div></div>';
			var v = ctx.body.querySelector(".ep-v"), cheap = ctx.body.querySelector(".ep-cheap"), bars = ctx.body.querySelector(".ep-bars"), axis = ctx.body.querySelector(".ep-axis");
			return function () {
				var cfg = ctx.tile.cfg || {}, c = elPrices(cfg.area || "DK2"), d = c.data;
				if (!d) { setText(v, c.err ? "--" : "…"); setText(cheap, c.err ? "Couldn't get prices" : ""); return; }
				var now = new Date(), nowKey = localHourKey(now);
				var from = new Date(now); from.setMinutes(0, 0, 0);
				var startKey = localHourKey(new Date(from.getTime() - (ctx.w >= 6 ? 2 : 1) * 3600000));
				var list = d.filter(function (x) { return x.h >= startKey; }).slice(0, ctx.w >= 6 ? 36 : 24);
				var cur = d.filter(function (x) { return x.h === nowKey; })[0];
				setHtml(v, cur ? elCost(cfg, cur.p).toFixed(2) + "<small> kr/kWh</small>" : "--");
				// Cheapest 3 hours in a row from now.
				var ahead = d.filter(function (x) { return x.h >= nowKey; }), best = null;
				for (var i = 0; i + 3 <= ahead.length; i++) {
					var sum = ahead[i].p + ahead[i + 1].p + ahead[i + 2].p;
					if (!best || sum < best.sum) best = { sum: sum, h: ahead[i].h };
				}
				setHtml(cheap, best ? "<span>Cheapest 3 hours</span><b>" + (best.h.slice(0, 10) === nowKey.slice(0, 10) ? "" : "tomorrow ") + best.h.slice(11, 13) + ":00–" + two((+best.h.slice(11, 13) + 3) % 24) + ":00</b>" : "");
				var vals = list.map(function (x) { return elCost(cfg, x.p); });
				var max = Math.max.apply(null, vals.concat([0.01])), min = Math.min.apply(null, vals);
				var sorted = vals.slice().sort(function (a, b) { return a - b; }), lo = sorted[Math.floor(sorted.length / 3)], hi = sorted[Math.floor(sorted.length * 2 / 3)];
				ctx.node.classList.toggle("ep-pricey", cur && elCost(cfg, cur.p) >= hi && elCost(cfg, cur.p) > lo);
				setHtml(bars, list.map(function (x, i) {
					var val = vals[i], lvl = val <= lo ? "lo" : val >= hi ? "hi" : "mid";
					return '<i class="' + lvl + (x.h === nowKey ? " now" : "") + '" style="height:' + Math.max(4, ((val - Math.min(0, min)) / (max - Math.min(0, min))) * 100).toFixed(0) + '%"></i>';
				}).join(""));
				setHtml(axis, list.map(function (x, i) { var hh = x.h.slice(11, 13); return "<span>" + (i % 6 === 0 ? (hh === "00" ? "00" : hh) : "") + "</span>"; }).join(""));
			};
		},
	};

	/* ================================================================== pollen and air quality (Open-Meteo) */
	var POLLEN = [["birch_pollen", "Birch"], ["grass_pollen", "Grass"], ["alder_pollen", "Alder"], ["mugwort_pollen", "Mugwort"], ["ragweed_pollen", "Ragweed"]];
	function pollenLevel(v) { return v == null ? [0, "--"] : v < 1 ? [0, "None"] : v < 20 ? [1, "Low"] : v < 80 ? [2, "Moderate"] : v < 200 ? [3, "High"] : [4, "Very high"]; }
	function aqiLevel(v) { return v == null ? [0, "--"] : v <= 20 ? [1, "Good"] : v <= 40 ? [1, "Fair"] : v <= 60 ? [2, "Moderate"] : v <= 80 ? [3, "Poor"] : v <= 100 ? [4, "Very poor"] : [4, "Extremely poor"]; }
	types.pollen = {
		name: "Pollen and air", desc: "Pollen and air quality where you live, today and the next days", icon: "cloud", group: "everyday",
		w: 3, h: 2, minW: 2, minH: 1, maxW: 6, maxH: 4, tickMs: 600000,
		build: function (ctx) {
			ctx.body.innerHTML = '<div class="pa"></div>';
			var box = ctx.body.querySelector(".pa");
			return function () {
				var pl = homePlace();
				var url = "https://air-quality-api.open-meteo.com/v1/air-quality?latitude=" + pl.lat.toFixed(3) + "&longitude=" + pl.lon.toFixed(3) + "&hourly=" + POLLEN.map(function (x) { return x[0]; }).join(",") + ",european_aqi&forecast_days=4&timezone=auto";
				var c = cached("pa:" + url, 60 * 60000, function () { return getJson(url); }), d = c.data;
				if (!d || !d.hourly) return setHtml(box, '<div class="notice small"><span>' + (c.err ? "Couldn't get pollen data" : "Loading…") + "</span></div>");
				var h = d.hourly, today = (h.time[0] || "").slice(0, 10);
				function dayMax(key, day) { var m = null; h.time.forEach(function (t, i) { if (t.slice(0, 10) === day && h[key] && h[key][i] != null) m = Math.max(m == null ? 0 : m, h[key][i]); }); return m; }
				var nowIdx = Math.max(0, h.time.indexOf(localHourKey(new Date()) + ":00"));
				var aqi = h.european_aqi ? h.european_aqi[nowIdx] : null, aq = aqiLevel(aqi);
				var active = POLLEN.map(function (p) { return { name: p[1], v: dayMax(p[0], today), key: p[0] }; }).filter(function (x) { return x.v != null && x.v >= 1; }).sort(function (a, b) { return b.v - a.v; });
				var html = '<div class="pa-aqi lvl' + aq[0] + '"><span>Air · ' + esc(pl.name) + "</span><b>" + esc(aq[1]) + "</b><em>AQI " + (aqi == null ? "--" : Math.round(aqi)) + "</em></div>";
				html += active.length ? '<div class="pa-list">' + active.slice(0, ctx.h >= 2 ? 4 : 1).map(function (x) { var l = pollenLevel(x.v); return '<div class="pa-p lvl' + l[0] + '"><b>' + esc(x.name) + "</b><span>" + esc(l[1]) + "</span><i style=\"width:" + Math.min(100, x.v / 2).toFixed(0) + '%"></i></div>'; }).join("") + "</div>" : '<div class="pa-none">No pollen in the air right now</div>';
				if (ctx.w >= 4 && ctx.h >= 2) {
					var days = [];
					h.time.forEach(function (t) { var dd = t.slice(0, 10); if (days.indexOf(dd) < 0) days.push(dd); });
					html += '<div class="pa-days">' + days.slice(1, 4).map(function (dd) {
						var top = POLLEN.map(function (p) { return dayMax(p[0], dd) || 0; }), mx = Math.max.apply(null, top), l = pollenLevel(mx);
						return '<div class="lvl' + l[0] + '"><span>' + new Date(dd + "T12:00").toLocaleDateString("en-GB", { weekday: "short" }) + "</span><b>" + esc(l[1]) + "</b></div>";
					}).join("") + "</div>";
				}
				ctx.node.classList.toggle("pa-alert", active.some(function (x) { return x.v >= 80; }));
				setHtml(box, html);
			};
		},
	};

	/* ================================================================== currency converter (Frankfurter, ECB rates) */
	var CUR_LIST = ["EUR", "USD", "GBP", "SEK", "NOK", "CHF", "PLN", "JPY", "THB", "TRY", "AUD", "CAD"];
	function rates(base) {
		return cached("fx:" + base, 6 * 3600000, function () { return getJson("https://api.frankfurter.dev/v1/latest?base=" + base); });
	}
	types.currency = {
		name: "Currency", desc: "Convert kroner to euro, dollar, pound… with big number keys", icon: "coins", group: "everyday",
		w: 3, h: 2, minW: 2, minH: 2, maxW: 6, maxH: 4,
		defaults: function () { return { base: "DKK", show: ["EUR", "USD", "GBP", "SEK"] }; },
		options: function () {
			return [
				{ key: "base", label: "From", type: "choice", "default": "DKK", choices: ["DKK"].concat(CUR_LIST).map(function (c) { return { value: c, label: c }; }) },
				{ key: "show", label: "Show", type: "multi", "default": ["EUR", "USD", "GBP", "SEK"], choices: ["DKK"].concat(CUR_LIST).map(function (c) { return { value: c, label: c }; }) },
			];
		},
		build: function (ctx) {
			var amount = "100";
			ctx.node.classList.add("no-swipe");
			ctx.body.innerHTML = '<div class="cc"><div class="cc-in"><b class="cc-amt"></b><span class="cc-base"></span></div><div class="cc-out"></div><div class="cc-keys"></div></div>';
			var amt = ctx.body.querySelector(".cc-amt"), base = ctx.body.querySelector(".cc-base"), out = ctx.body.querySelector(".cc-out"), keys = ctx.body.querySelector(".cc-keys");
			keys.innerHTML = ["7", "8", "9", "4", "5", "6", "1", "2", "3", ".", "0", "⌫"].map(function (k) { return '<button data-k="' + k + '">' + k + "</button>"; }).join("");
			keys.addEventListener("click", function (e) {
				var b = e.target.closest("[data-k]");
				if (!b || App.editing) return;
				e.stopPropagation();
				var k = b.dataset.k;
				if (k === "⌫") amount = amount.slice(0, -1) || "0";
				else if (k === ".") { if (amount.indexOf(".") < 0) amount += "."; }
				else amount = amount === "0" ? k : (amount + k).slice(0, 10);
				App.dirty();
			});
			keys.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
			return function () {
				var cfg = ctx.tile.cfg || {}, b = cfg.base || "DKK", show = (cfg.show || ["EUR", "USD", "GBP", "SEK"]).filter(function (x) { return x !== b; });
				var c = rates(b), r = c.data && c.data.rates;
				setText(amt, amount);
				setText(base, b);
				ctx.node.classList.toggle("cc-small", ctx.h < 3 && ctx.w < 4);
				if (!r) return setHtml(out, '<span class="cc-wait">' + (c.err ? "Couldn't get rates" : "Getting today's rates…") + "</span>");
				var a = parseFloat(amount) || 0;
				setHtml(out, show.slice(0, ctx.h >= 3 ? 6 : 4).map(function (x) {
					var v = r[x] == null ? null : a * r[x];
					return '<div><span>' + esc(x) + "</span><b>" + (v == null ? "--" : v.toLocaleString("en-GB", { maximumFractionDigits: v < 10 ? 2 : v < 1000 ? 1 : 0 })) + "</b></div>";
				}).join(""));
			};
		},
	};

	/* ================================================================== calculator */
	function calcEval(expr) {
		// Numbers, + − × ÷ and brackets, worked out in the right order (no eval).
		var toks = String(expr).replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-").match(/\d+\.?\d*|\.\d+|[-+*/()%]/g) || [];
		var i = 0;
		function peek() { return toks[i]; }
		function next() { return toks[i++]; }
		function factor() {
			var t = next();
			if (t === "-") return -factor();
			if (t === "+") return factor();
			if (t === "(") { var v = sum(); if (peek() === ")") next(); return v; }
			var n = parseFloat(t);
			if (isNaN(n)) throw new Error("bad");
			if (peek() === "%") { next(); n = n / 100; }
			return n;
		}
		function term() { var v = factor(); while (peek() === "*" || peek() === "/") { var op = next(), r = factor(); v = op === "*" ? v * r : v / r; } return v; }
		function sum() { var v = term(); while (peek() === "+" || peek() === "-") { var op = next(), r = term(); v = op === "+" ? v + r : v - r; } return v; }
		var res = sum();
		if (i < toks.length || !isFinite(res)) throw new Error("bad");
		return Math.round(res * 1e10) / 1e10;
	}
	types.calc = {
		name: "Calculator", desc: "Big keys, right on the panel, with your last results", icon: "calculator", group: "everyday",
		w: 3, h: 3, minW: 2, minH: 2, maxW: 6, maxH: 6,
		build: function (ctx) {
			var cfg = ctx.tile.cfg || (ctx.tile.cfg = {});
			var expr = "", justDone = false;
			ctx.node.classList.add("no-swipe");
			ctx.body.innerHTML = '<div class="ca"><div class="ca-hist"></div><div class="ca-disp"><span class="ca-expr"></span><b class="ca-res"></b></div><div class="ca-keys"></div></div>';
			var hist = ctx.body.querySelector(".ca-hist"), ex = ctx.body.querySelector(".ca-expr"), res = ctx.body.querySelector(".ca-res"), keys = ctx.body.querySelector(".ca-keys");
			var K = ["C", "(", ")", "÷", "7", "8", "9", "×", "4", "5", "6", "−", "1", "2", "3", "+", "%", "0", ".", "="];
			keys.innerHTML = K.map(function (k) { return '<button data-k="' + k + '" class="' + (/[÷×−+=]/.test(k) ? "op" : k === "C" ? "clr" : "") + '">' + k + "</button>"; }).join("");
			function show() {
				setText(ex, expr || "0");
				var live = "";
				try { if (expr && /[÷×−+%]/.test(expr)) live = "= " + calcEval(expr).toLocaleString("en-GB", { maximumFractionDigits: 8 }); } catch (e) {}
				setText(res, justDone ? "" : live);
				setHtml(hist, (cfg.hist || []).slice(0, 3).map(function (h) { return '<button data-h="' + esc(h.r) + '"><span>' + esc(h.e) + "</span><b>" + esc(h.r) + "</b></button>"; }).join(""));
			}
			keys.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
			keys.addEventListener("click", function (e) {
				var b = e.target.closest("[data-k]");
				if (!b || App.editing) return;
				e.stopPropagation();
				var k = b.dataset.k;
				if (k === "C") { expr = ""; justDone = false; }
				else if (k === "=") {
					try {
						var r = calcEval(expr);
						cfg.hist = [{ e: expr, r: String(r) }].concat(cfg.hist || []).slice(0, 10);
						Editor.save();
						expr = String(r);
						justDone = true;
					} catch (x) { U.toast("That doesn't add up"); }
				} else {
					if (justDone && /[0-9.(]/.test(k)) expr = "";
					justDone = false;
					expr = (expr + k).slice(0, 60);
				}
				show();
			});
			hist.addEventListener("click", function (e) {
				var b = e.target.closest("[data-h]");
				if (!b || App.editing) return;
				e.stopPropagation();
				expr = b.dataset.h;
				justDone = false;
				show();
				if (Helper.online && helperNew()) Helper.act({ action: "copyText", text: b.dataset.h }, true).then(function (ok) { if (ok) U.toast("Copied " + b.dataset.h); });
			});
			show();
			return function () {};
		},
	};

	/* ================================================================== "on air": an app is using your mic or camera */
	var airP = poller("/api/onair", 2000, 4000);
	types.onair = {
		name: "On air", desc: "Lights up red when an app is using your microphone or camera", icon: "record", group: "pc", helper: true,
		w: 2, h: 1, minW: 1, minH: 1, maxW: 4, maxH: 2, tickMs: 2000,
		defaults: function () { return { watch: "both" }; },
		options: function () { return [{ key: "watch", label: "Watch", type: "choice", "default": "both", choices: [{ value: "both", label: "Microphone and camera" }, { value: "mic", label: "Only the microphone" }, { value: "cam", label: "Only the camera" }] }]; },
		build: function (ctx) {
			var st = { built: false };
			return function () {
				if (gate(ctx, st)) return;
				if (!st.built) {
					ctx.body.innerHTML = '<div class="oa"><span class="oa-dot"></span><div class="oa-tx"><b></b><em></em></div></div>';
					st.built = true;
				}
				var r = airP.get(), w = (ctx.tile.cfg || {}).watch || "both";
				var mic = (r && r.mic) || [], cam = (r && r.cam) || [];
				var on = (w !== "cam" && mic.length) || (w !== "mic" && cam.length);
				var who = [];
				if (w !== "cam") mic.forEach(function (a) { who.push(a.name + " · mic"); });
				if (w !== "mic") cam.forEach(function (a) { who.push(a.name + " · camera"); });
				ctx.node.classList.toggle("on-air", !!on);
				setText(ctx.body.querySelector(".oa-tx b"), on ? "ON AIR" : "Off air");
				setText(ctx.body.querySelector(".oa-tx em"), on ? who.join(", ") : r ? "Nothing is listening" : "…");
			};
		},
	};

	/* ================================================================== downloads and recent files */
	function filesTile(which, name, desc, icon) {
		var fp = poller("/api/files?which=" + which, 8000, 10000);
		return {
			name: name, desc: desc, icon: icon, group: "pc", helper: true,
			w: 3, h: 2, minW: 2, minH: 1, maxW: 8, maxH: 6, tickMs: 8000,
			build: function (ctx) {
				var st = { built: false }, list, shown = "", holdT = null, held = false;
				return function () {
					if (gate(ctx, st)) return;
					if (!st.built) {
						ctx.body.innerHTML = T.head(icon, name) + '<div class="fl"></div>';
						list = ctx.body.querySelector(".fl");
						U.dragScroll(list);
						if (which === "downloads") {
							var th = ctx.body.querySelector(".th"), ob = el("button", "fl-open", svg("folder"));
							ob.setAttribute("aria-label", "Open the Downloads folder");
							ob.addEventListener("click", function (e) { e.stopPropagation(); if (!App.editing) Helper.act({ action: "downloadsFolder" }, true); });
							th.appendChild(ob);
						}
						list.addEventListener("pointerdown", function (e) {
							var r = e.target.closest("[data-id]");
							held = false;
							clearTimeout(holdT);
							if (!r || App.editing) return;
							holdT = setTimeout(function () { held = true; Helper.act({ action: "fileOpen", id: r.dataset.id, reveal: true }, true); U.toast("Showing it in its folder"); }, 700);
						});
						["pointerup", "pointercancel", "pointermove"].forEach(function (n) { list.addEventListener(n, function (e) { if (n !== "pointermove" || Math.abs(e.movementY || 0) > 3) clearTimeout(holdT); }); });
						list.addEventListener("click", function (e) {
							var r = e.target.closest("[data-id]");
							if (!r || App.editing) return;
							e.stopPropagation();
							if (held) { held = false; return; }
							Helper.act({ action: "fileOpen", id: r.dataset.id }, true).then(function (ok) { if (!ok) U.toast("That file isn't there any more"); else U.toast("Opening " + r.dataset.name); });
						});
						st.built = true;
						shown = "";
					}
					var r = fp.get(), items = (r && r.items) || [];
					var key = JSON.stringify(items.map(function (f) { return [f.id, f.time]; })) + ctx.h;
					if (key === shown) {
						list.querySelectorAll("[data-time]").forEach(function (e) { e.textContent = e.dataset.extra + ago(+e.dataset.time); });
						return;
					}
					shown = key;
					if (!r) return setHtml(list, '<div class="notice small"><span>Loading…</span></div>');
					if (!items.length) return setHtml(list, '<div class="notice small"><span>Nothing here yet</span></div>');
					list.innerHTML = items.slice(0, 30).map(function (f) {
						var extra = f.folder ? "Folder · " : f.size != null ? size(f.size) + " · " : "";
						return '<button class="fl-row" data-id="' + esc(f.id) + '" data-name="' + esc(f.name) + '"><span class="fl-ic"></span><span class="fl-tx"><b>' + esc(f.name) + '</b><em data-time="' + f.time + '" data-extra="' + esc(extra) + '">' + esc(extra + ago(f.time)) + "</em></span></button>";
					}).join("");
					list.querySelectorAll(".fl-row").forEach(function (b, i) { Round6.iconInto(b.querySelector(".fl-ic"), items[i].icon, items[i].folder ? "folder" : "note"); });
				};
			},
		};
	}
	types.downloads = filesTile("downloads", "Downloads", "Your newest downloads · tap to open, hold to show in the folder", "down");
	types.recentfiles = filesTile("recent", "Recent files", "The files you opened last · tap to open again", "history");

	/* ================================================================== website check */
	function sites(t) { return (t.cfg && t.cfg.sites) || []; }
	var siteState = {}, siteWas = {};
	function checkSite(url, every) {
		var s = siteState[url] || (siteState[url] = { at: 0, busy: false, data: null });
		if (!s.busy && Date.now() - s.at > every) {
			s.busy = true;
			Helper.fetch("/api/sitecheck?url=" + encodeURIComponent(url), { cache: "no-store" }, 25000).then(function (r) { s.data = r; }, function () {}).then(function () { s.at = Date.now(); s.busy = false; App.dirty(); });
		}
		return s.data;
	}
	function nameOf(url) { try { return new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return url; } }
	function editSites(t, back) {
		t.cfg = t.cfg || {};
		var list = sites(t).slice();
		var wrap = el("div", "opts sc-edit");
		Editor.modal("Websites to check", wrap, back);
		function draw() {
			wrap.innerHTML = "";
			var ol = el("div", "opt-list");
			list.forEach(function (s, i) {
				var r = el("div", "opt-row tpl-row", '<span class="src-check">' + svg("globe") + "</span><span><b></b><em></em></span>");
				r.querySelector("b").textContent = s.name || nameOf(s.url);
				r.querySelector("em").textContent = s.url;
				var x = el("button", "ch-mini danger tpl-del", svg("x"));
				x.addEventListener("click", function () { list.splice(i, 1); draw(); });
				r.appendChild(x);
				ol.appendChild(r);
			});
			if (!list.length) ol.appendChild(el("p", "hint", "Add a website you want to keep an eye on, for example one you're building."));
			wrap.appendChild(ol);
			if (list.length < 6) {
				var inp = el("input", "search");
				inp.placeholder = "https://…";
				inp.value = "https://";
				wrap.appendChild(inp);
				var add = function (v) {
					v = (v || "").trim();
					if (!/^https?:\/\//i.test(v)) v = "https://" + v.replace(/^\/+/, "");
					try { new URL(v); } catch (e) { return U.toast("That isn't a web address"); }
					if (!/\.[a-z]{2,}/i.test(v)) return U.toast("That isn't a web address");
					list.push({ url: v, name: nameOf(v) });
					draw();
				};
				if (window.Round8b) wrap.appendChild(Round8b.keyboard(inp, null, add, "Add"));
				else { var ab = el("button", "pill", "Add"); ab.addEventListener("click", function () { add(inp.value); }); wrap.appendChild(ab); }
			}
			var every = el("div", "opt", "<h4>Check every</h4>");
			var ch = el("div", "chips");
			[[1, "1 minute"], [5, "5 minutes"], [15, "15 minutes"]].forEach(function (o) {
				var b = el("button", "chip" + ((t.cfg.every || 5) === o[0] ? " on" : ""), o[1]);
				b.addEventListener("click", function () { t.cfg.every = o[0]; draw(); });
				ch.appendChild(b);
			});
			every.appendChild(ch);
			var warn = el("button", "opt-toggle" + (t.cfg.banner !== false ? " on" : ""), '<span class="switch"><i></i></span><span>Banner when a site goes down</span>');
			warn.addEventListener("click", function () { t.cfg.banner = t.cfg.banner === false; draw(); });
			every.appendChild(warn);
			wrap.appendChild(every);
			var ok = el("button", "pill accent save-btn", "Save");
			ok.addEventListener("click", function () { t.cfg.sites = list; Editor.saveTile(t, back); });
			wrap.appendChild(ok);
		}
		draw();
	}
	types.sitecheck = {
		name: "Website check", desc: "Is your website up, and how fast does it answer", icon: "globe", group: "pc", helper: true,
		w: 3, h: 1, minW: 1, minH: 1, maxW: 6, maxH: 4, tickMs: 10000,
		edit: function (t, back) { editSites(t, back); },
		build: function (ctx) {
			var st = { built: false }, box;
			return function () {
				if (gate(ctx, st)) return;
				if (!st.built) {
					ctx.body.innerHTML = '<div class="sck"></div>';
					box = ctx.body.querySelector(".sck");
					box.addEventListener("click", function (e) { if (!App.editing && !sites(ctx.tile).length) { e.stopPropagation(); Editor.edit(ctx.tile); } });
					st.built = true;
				}
				var list = sites(ctx.tile), cfg = ctx.tile.cfg || {};
				if (!list.length) return setHtml(box, '<div class="sck-empty">' + svg("plus") + "<span>Tap to add a website</span></div>");
				var anyDown = false;
				setHtml(box, list.slice(0, Math.max(1, ctx.h * (ctx.w >= 3 ? 2 : 1))).map(function (s) {
					var r = checkSite(s.url, (cfg.every || 5) * 60000);
					var up = r && r.up, state = !r ? "wait" : up ? (r.ms > 2500 ? "slow" : "up") : "down";
					if (state === "down") anyDown = true;
					// Banner when a site that was up goes down.
					if (r && siteWas[s.url] === true && !up && cfg.banner !== false && window.Round7 && Round7._onNotif)
						Round7._onNotif({ id: "site" + Date.now(), app: "Website check", appKey: "cp-site", title: (s.name || nameOf(s.url)) + " is down", text: r.error || "It doesn't answer", time: Date.now(), test: true });
					if (r) siteWas[s.url] = !!up;
					return '<div class="sck-row ' + state + '"><i></i><b>' + esc(s.name || nameOf(s.url)) + "</b><span>" + (!r ? "checking…" : up ? r.ms + " ms" : esc(r.error || "down")) + "</span></div>";
				}).join(""));
				attn(ctx, anyDown);
			};
		},
	};

	/* ================================================================== device batteries (Bluetooth) */
	var batP = poller("/api/devbattery", 60000, 15000);
	types.devbat = {
		name: "Device batteries", desc: "Battery of your Bluetooth mouse, keyboard, controller… (the ones that tell Windows)", icon: "battery", group: "pc", helper: true,
		w: 3, h: 1, minW: 2, minH: 1, maxW: 6, maxH: 4, tickMs: 60000,
		build: function (ctx) {
			var st = { built: false }, box;
			return function () {
				if (gate(ctx, st)) return;
				if (!st.built) { ctx.body.innerHTML = '<div class="db"></div>'; box = ctx.body.querySelector(".db"); st.built = true; }
				var r = batP.get(), items = (r && r.items) || [];
				if (!r) return setHtml(box, '<div class="notice small"><span>Looking for devices…</span></div>');
				if (!items.length) return setHtml(box, '<div class="notice small"><span>No device is sharing its battery with Windows</span></div>');
				var low = false;
				setHtml(box, items.slice(0, ctx.h * 2).map(function (d) {
					if (d.level <= 15) low = true;
					return '<div class="db-row' + (d.level <= 20 ? " low" : "") + '"><b>' + esc(d.name) + '</b><span>' + d.level + '%</span><div class="bar"><i style="width:' + d.level + '%"></i></div></div>';
				}).join(""));
				attn(ctx, low);
			};
		},
	};

	/* ================================================================== day overview */
	types.dayview = {
		name: "Day overview", desc: "Today at a glance: weather, your next event and the power price", icon: "sun", group: "everyday",
		w: 4, h: 2, minW: 2, minH: 1, maxW: 8, maxH: 4, tickMs: 60000,
		build: function (ctx) {
			ctx.body.innerHTML = '<div class="dv"><div class="dv-hi"><b class="dv-greet"></b><span class="dv-date"></span></div><div class="dv-rows"></div></div>';
			var greet = ctx.body.querySelector(".dv-greet"), date = ctx.body.querySelector(".dv-date"), rows = ctx.body.querySelector(".dv-rows");
			return function () {
				var now = new Date(), h = now.getHours();
				setText(greet, h < 5 ? "Good night" : h < 10 ? "Good morning" : h < 17 ? "Good afternoon" : h < 23 ? "Good evening" : "Good night");
				setText(date, now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }));
				var out = [];
				// Weather
				var pl = homePlace();
				var wurl = "https://api.open-meteo.com/v1/forecast?latitude=" + pl.lat.toFixed(3) + "&longitude=" + pl.lon.toFixed(3) + "&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=1";
				var wc = cached("dvw:" + wurl, 20 * 60000, function () { return getJson(wurl); }), w = wc.data;
				if (w && w.current) out.push(["partly", Math.round(w.current.temperature_2m) + "° now", (w.daily ? Math.round(w.daily.temperature_2m_max[0]) + "° / " + Math.round(w.daily.temperature_2m_min[0]) + "°" + (w.daily.precipitation_probability_max[0] >= 30 ? " · " + w.daily.precipitation_probability_max[0] + "% rain" : "") : "")]);
				// Next event
				if (Helper.online && typeof Everyday !== "undefined") {
					var cc = cached("dvcal", 15 * 60000, function () { return Helper.fetch("/api/calendars", { cache: "no-store" }, 30000).then(function (r) { return r.calendars || []; }); });
					if (cc.data && cc.data.length) {
						var evs = [], t0 = Date.now();
						cc.data.forEach(function (cal) { if (cal.ok) evs = evs.concat(Everyday.parseIcs(cal.ics, cal.name, t0, t0 + 3 * 86400000)); });
						evs = evs.filter(function (e) { return (e.end || e.t) > t0; }).sort(function (a, b) { return a.t - b.t; });
						var e = evs[0];
						if (e) {
							var d = new Date(e.t), today = d.toDateString() === now.toDateString();
							out.push(["calendar", e.title, e.allDay ? (today ? "Today" : d.toLocaleDateString("en-GB", { weekday: "long" })) : (today ? "" : d.toLocaleDateString("en-GB", { weekday: "short" }) + " ") + two(d.getHours()) + ":" + two(d.getMinutes())]);
						} else out.push(["calendar", "No events coming up", ""]);
					}
				}
				// Power price
				var cfg = { area: "DK2", vat: true };
				L().pages.forEach(function (pg) { pg.tiles.forEach(function (t) { if (t.type === "elprice" && t.cfg) cfg = t.cfg; }); });
				var el2 = elPrices(cfg.area || "DK2").data;
				var cur = el2 && el2.filter(function (x) { return x.h === localHourKey(now); })[0];
				if (cur) out.push(["bolt", elCost(cfg, cur.p).toFixed(2) + " kr/kWh", "power right now"]);
				setHtml(rows, out.slice(0, ctx.h >= 2 ? 3 : 1).map(function (r) { return '<div class="dv-row">' + svg(r[0]) + "<b>" + esc(r[1]) + "</b><span>" + esc(r[2]) + "</span></div>"; }).join(""));
			};
		},
	};

	/* ================================================================== copy board */
	function snippets() { var o = O(); return o.snippets || (o.snippets = []); }
	function editSnippets(t, back) {
		var wrap = el("div", "opts cb-edit");
		Editor.modal("Copy board", wrap, back);
		var me = function () { editSnippets(t, back); };
		var list = snippets();
		var ol = el("div", "opt-list");
		list.forEach(function (s, i) {
			var r = el("div", "opt-row tpl-row", '<span class="src-check">' + svg("copy") + "</span><span><b></b><em></em></span>");
			r.querySelector("b").textContent = s.label;
			r.querySelector("em").textContent = s.text.slice(0, 80);
			var x = el("button", "ch-mini danger tpl-del", svg("x"));
			x.addEventListener("click", function () { list.splice(i, 1); Editor.save(); App.dirty(); me(); });
			r.appendChild(x);
			ol.appendChild(r);
		});
		if (!list.length) ol.appendChild(el("p", "hint", "Texts you paste often: your address, email, phone number, a standard reply…"));
		wrap.appendChild(ol);
		var add = el("button", "pill accent", svg("plus") + "<span>Add a text</span>");
		add.addEventListener("click", function () { newSnippet(me); });
		wrap.appendChild(add);
		if (t) {
			var ok = el("button", "pill save-btn", "Done");
			ok.addEventListener("click", function () { Editor.saveTile(t, back); });
			wrap.appendChild(ok);
		}
	}
	function newSnippet(done) {
		var step = 0, work = { label: "", text: "" };
		var w = el("div", "osk-wrap");
		function draw() {
			w.innerHTML = "";
			w.appendChild(el("p", "hint", step === 0 ? "The text to copy (you can also paste with Ctrl+V):" : "A short name for the button:"));
			var inp = el(step === 0 ? "textarea" : "input", "search osk-in");
			inp.maxLength = step === 0 ? 1000 : 24;
			inp.value = step === 0 ? work.text : work.label || work.text.split("\n")[0].slice(0, 24);
			w.appendChild(inp);
			w.appendChild(Round8b.keyboard(inp, null, function (v) {
				if (step === 0) { if (!v.trim()) return U.toast("Type the text first"); work.text = v; step = 1; draw(); }
				else { work.label = (v.trim() || work.text.slice(0, 24)).slice(0, 24); snippets().push(work); Editor.save(); App.dirty(); done(); }
			}, step === 0 ? "Next" : "Save"));
			Editor.modal(step === 0 ? "New text" : "Name it", w);
		}
		draw();
	}
	types.copyboard = {
		name: "Copy board", desc: "Texts you use often · tap one and it's copied, ready to paste", icon: "clipboard", group: "everyday", helper: true,
		w: 3, h: 2, minW: 1, minH: 1, maxW: 8, maxH: 6,
		edit: function (t, back) { editSnippets(t, back); },
		build: function (ctx) {
			var st = { built: false }, box, shown = "";
			return function () {
				if (gate(ctx, st)) return;
				if (!st.built) {
					ctx.body.innerHTML = '<div class="cpb"></div>';
					box = ctx.body.querySelector(".cpb");
					box.addEventListener("click", function (e) {
						if (App.editing) return;
						e.stopPropagation();
						if (e.target.closest(".cpb-new")) return editSnippets(null, null);
						var b = e.target.closest("[data-i]");
						if (!b) return;
						var s = snippets()[+b.dataset.i];
						if (!s) return;
						b.classList.add("copied");
						setTimeout(function () { b.classList.remove("copied"); }, 900);
						Helper.act({ action: "copyText", text: s.text }, true).then(function (ok) { U.toast(ok ? "Copied: " + s.label : "Couldn't copy"); });
					});
					st.built = true;
					shown = "";
				}
				var list = snippets(), key = JSON.stringify(list.map(function (s) { return s.label; }));
				if (key === shown) return;
				shown = key;
				if (!list.length) return setHtml(box, '<button class="cpb-new">' + svg("plus") + "<span>Add texts you use often</span></button>");
				setHtml(box, list.map(function (s, i) { return '<button class="cpb-b" data-i="' + i + '">' + svg("copy") + "<b>" + esc(s.label) + "</b></button>"; }).join(""));
			};
		},
	};

	/* Tiles that use holding for their own thing. */
	["downloads", "recentfiles", "calc", "currency"].forEach(function (k) { if (types[k]) types[k].ownHold = true; });

	return {
		presets: presets,
		calcEval: calcEval,
		sunAltitude: sunAltitude,
		sunTimes: sunTimes,
	};
})();
