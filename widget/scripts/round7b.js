/* Control Panel — Round 7B: flight tiles. OFP viewer, approach briefing, taxi helper,
 * airline stats and the landing replay card. */

var Round7b = (function () {
	var svg = U.svg, el = U.el, esc = U.esc, setText = U.setText, setHtml = U.setHtml;
	var types = T.types, helperGate = T.helperGate;

	/* ------------------------------------------------------------------ shared */
	function sim() { return (Helper.state && Helper.state.sim) || null; }
	function live() { var s = sim(); return s && s.connected ? s : null; }
	function planData() { return typeof Flight !== "undefined" && Flight.plan ? Flight.plan() : { data: null }; }
	function two(n) { return ("0" + n).slice(-2); }
	function num(n) { return n == null || isNaN(n) ? "--" : Math.round(n).toLocaleString("en-GB"); }
	function kg(v, units) {
		if (v == null || isNaN(v)) return "--";
		var u = units === "lbs" ? "lbs" : "kg";
		var x = u === "lbs" ? v / 0.453592 : v;
		return x >= 10000 ? (x / 1000).toFixed(1) + (u === "lbs" ? "k lbs" : " t") : Math.round(x).toLocaleString("en-GB") + " " + u;
	}
	function zulu(ms) { if (!ms) return "--"; var d = new Date(ms); return two(d.getUTCHours()) + two(d.getUTCMinutes()) + "Z"; }
	function hm(sec) { if (sec == null) return "--"; sec = Math.max(0, Math.round(sec / 60)); return Math.floor(sec / 60) + ":" + two(sec % 60); }
	function distNm(a, b, c, d) {
		var R = 3440.065, r = Math.PI / 180, dLat = (c - a) * r, dLon = (d - b) * r;
		var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
		return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
	}
	function waitBox(box, text) { setHtml(box, '<div class="notice small"><span>' + esc(text) + "</span></div>"); }

	/* Airport data from the helper (runways and frequencies, OurAirports), kept for an hour. */
	var apCache = {};
	function airport(icao) {
		if (!icao || !Helper.online) return null;
		var c = apCache[icao] || (apCache[icao] = { at: 0, data: null, busy: false });
		if (!c.busy && Date.now() - c.at > (c.data ? 3600000 : 60000)) {
			c.busy = true;
			Helper.fetch("/api/freqs?runways=1&icao=" + encodeURIComponent(icao), { cache: "no-store" }, 30000).then(function (r) {
				c.data = { freqs: r.freqs || [], runways: r.runways || [], old: r.runways === undefined };
			}, function () {}).then(function () { c.at = Date.now(); c.busy = false; App.dirty(); });
		}
		return c.data;
	}
	function runwayEnd(ap, id) {
		if (!ap || !id) return null;
		id = String(id).toUpperCase().replace(/^RW/, "");
		for (var i = 0; i < ap.runways.length; i++) {
			var r = ap.runways[i];
			for (var k = 0; k < 2; k++) if (String(r.ends[k].id).toUpperCase() === id) return { rwy: r, end: r.ends[k], other: r.ends[1 - k] };
		}
		return null;
	}
	function freq(ap, re) {
		var f = ((ap && ap.freqs) || []).filter(function (x) { return re.test(x.type + " " + x.desc); })[0];
		return f ? f.mhz : "";
	}

	/* METAR for one airport (aviationweather.gov, through the helper). */
	var wxCache = {};
	function metar(icao) {
		if (!icao) return null;
		var c = wxCache[icao] || (wxCache[icao] = { at: 0, data: null, busy: false });
		if (!c.busy && Date.now() - c.at > 10 * 60000) {
			c.busy = true;
			var url = "https://aviationweather.gov/api/data/metar?format=json&ids=" + encodeURIComponent(icao);
			(Helper.online ? Helper.fetch("/api/fetch?url=" + encodeURIComponent(url), { cache: "no-store" }, 10000) : fetch(url).then(function (r) { return r.json(); })).then(function (j) {
				c.data = (j || []).filter(function (m) { return m.icaoId === icao; })[0] || null;
			}, function () {}).then(function () { c.at = Date.now(); c.busy = false; App.dirty(); });
		}
		return c.data;
	}

	function tabsHtml(list, on) {
		return '<div class="t7-tabs no-swipe">' + list.map(function (t) { return '<button data-tab="' + t[0] + '"' + (t[0] === on ? ' class="on"' : "") + ">" + esc(t[1]) + "</button>"; }).join("") + "</div>";
	}

	/* ================================================================== OFP viewer */
	types.ofp = {
		name: "Flight plan (OFP)", desc: "Your SimBrief plan to scroll through: route, fuel, weights, times", icon: "list", group: "flight", helper: true, parts: ["sim"],
		w: 4, h: 3, minW: 3, minH: 2, maxW: 8, maxH: 6, tickMs: 5000,
		build: function (ctx) {
			var cfg = ctx.tile.cfg || (ctx.tile.cfg = {});
			var tab = cfg.tab || "route";
			ctx.body.innerHTML = '<div class="ofp-top"><b class="ofp-rt"></b><span class="ofp-sub"></span></div>' + tabsHtml([["route", "Route"], ["fuel", "Fuel"], ["weights", "Weights"], ["info", "Info"]], tab) + '<div class="ofp-body"></div>';
			var rt = ctx.body.querySelector(".ofp-rt"), sub = ctx.body.querySelector(".ofp-sub"), body = ctx.body.querySelector(".ofp-body");
			U.dragScroll(body);
			var shown = "", scrolledTo = -1;
			ctx.body.querySelector(".t7-tabs").addEventListener("click", function (e) {
				var b = e.target.closest("[data-tab]");
				if (!b || App.editing) return;
				e.stopPropagation();
				tab = cfg.tab = b.dataset.tab;
				ctx.body.querySelectorAll("[data-tab]").forEach(function (x) { x.classList.toggle("on", x === b); });
				shown = "";
				scrolledTo = -1;
				body.scrollTop = 0;
				App.dirty();
			});
			function row(k, v, cls) { return '<div class="ofp-kv' + (cls ? " " + cls : "") + '"><span>' + esc(k) + "</span><b>" + esc(v) + "</b></div>"; }
			return function () {
				if (helperGate(ctx) === true) return;
				var c = planData(), p = c.data;
				if (!p) return waitBox(body, c.err ? "Couldn't get your SimBrief plan" : "Loading your SimBrief plan…");
				var x = p.x || {}, u = x.units;
				setText(rt, p.from + " → " + p.to);
				setText(sub, [p.flight, p.aircraft, x.reg].filter(Boolean).join(" · "));
				// Where you are on the route: the fix closest ahead of the plane.
				var s = live(), next = -1;
				if (s && p.fixes.length) {
					var best = 1e9;
					p.fixes.forEach(function (f, i) { var d = distNm(s.lat, s.lon, f.lat, f.lon); if (d < best) { best = d; next = i; } });
					if (next >= 0 && next + 1 < p.fixes.length) {
						var a = p.fixes[next], b2 = p.fixes[next + 1];
						if (distNm(s.lat, s.lon, b2.lat, b2.lon) < distNm(a.lat, a.lon, b2.lat, b2.lon)) next++;
					}
				}
				var key = tab + "|" + next + "|" + p.from + p.to + p.flight + p.out;
				if (key === shown) return;
				shown = key;
				var html = "";
				if (tab === "route") {
					html = '<div class="ofp-tr ofp-th"><span>Fix</span><span>Via</span><span>FL</span><span>Time</span><span>Fuel</span></div>' + p.fixes.map(function (f, i) {
						return '<div class="ofp-tr' + (i < next ? " past" : i === next ? " next" : "") + (f.sidstar ? " ss" : "") + '"><b>' + esc(f.id) + "</b><span>" + esc(f.via === "DCT" ? "DCT" : f.via) + "</span><span>" + (f.alt != null ? Math.round(f.alt / 100) : "") + "</span><span>" + hm(f.time) + "</span><span>" + (f.fuel != null ? (f.fuel / (u === "lbs" ? 453.592 : 1000)).toFixed(1) : "") + "</span></div>";
					}).join("") + '<div class="ofp-route">' + esc(p.route) + "</div>";
				} else if (tab === "fuel") {
					html = row("Taxi", kg(x.taxi, u)) + row("Trip", kg(p.burn, u)) + row("Contingency", kg(x.contingency, u)) + row("Alternate (" + (p.alt || "–") + ")", kg(p.altBurn, u)) +
						row("Final reserve", kg(p.reserve, u)) + row("Extra", kg(x.extraFuel, u)) + row("Block fuel", kg(p.block, u), "tot") + row("Min takeoff", kg(x.minTo, u)) +
						row("Takeoff", kg(x.planTo, u)) + row("Landing", kg(x.planLdg, u));
					if (s) html += row("On board now", kg(s.fuelKg, u), "now");
				} else if (tab === "weights") {
					function lim(v, m) { return kg(v, u) + (m ? " / " + kg(m, u) : ""); }
					html = row("Passengers", x.pax != null ? num(x.pax) : "--") + row("Payload", kg(x.payload, u)) + row("Cargo", kg(x.cargo, u)) + row("Empty (OEW)", kg(x.oew, u)) +
						row("Zero fuel (ZFW) / max", lim(p.zfw, x.maxZfw), p.zfw > x.maxZfw && x.maxZfw ? "warn" : "") + row("Takeoff (TOW) / max", lim(p.tow, x.maxTow), p.tow > x.maxTow && x.maxTow ? "warn" : "") +
						row("Landing (LDW) / max", lim(p.ldw, x.maxLdw), p.ldw > x.maxLdw && x.maxLdw ? "warn" : "");
				} else {
					html = row("Callsign", x.callsign || p.flight || "--") + row("Departure", p.from + (p.fromRwy ? " · runway " + p.fromRwy : "")) + row("Arrival", p.to + (p.toRwy ? " · runway " + p.toRwy : "")) +
						row("Alternate", p.alt ? p.alt + (x.altRwy ? " · " + x.altRwy : "") + (x.altDist ? " · " + num(x.altDist) + " NM" : "") : "--") +
						row("Cruise", p.cruise ? "FL" + Math.round(p.cruise / 100) : "--") + row("Cost index", x.costIndex || "--") +
						row("Average wind", x.avgWind != null ? (x.avgWind >= 0 ? "Tail " : "Head ") + Math.abs(Math.round(x.avgWind)) + " kt" : "--") + row("Distance", p.dist ? num(p.dist) + " NM" : "--") +
						row("Out / Off", zulu(p.out) + " / " + zulu(p.off)) + row("On / In", zulu(p.on) + " / " + zulu(p.in)) + row("Air time", hm(p.ete)) + row("Block time", hm(x.block)) +
						(x.toTransLevel ? row("Transition level " + p.to, "FL" + Math.round(x.toTransLevel / 100)) : "");
				}
				setHtml(body, html);
				if (tab === "route" && next >= 0 && next !== scrolledTo) {
					scrolledTo = next;
					var r = body.querySelector(".ofp-tr.next");
					if (r) body.scrollTop = Math.max(0, r.offsetTop - body.clientHeight / 3);
				}
			};
		},
	};

	/* ================================================================== approach briefing */
	function windParts(m, hdg) {
		if (!m || m.wspd == null) return null;
		if (m.wdir === "VRB" || m.wdir == null) return { head: null, cross: null, text: "Variable " + m.wspd + " kt" };
		var diff = ((+m.wdir - hdg) * Math.PI) / 180;
		var spd = +m.wspd, gust = m.wgst ? +m.wgst : null;
		return {
			head: Math.round(spd * Math.cos(diff)), cross: Math.round(spd * Math.sin(diff)), gust: gust,
			text: ("00" + m.wdir).slice(-3) + "° " + spd + (gust ? "G" + gust : "") + " kt",
		};
	}
	function ceiling(m) {
		var c = (m && m.clouds || []).filter(function (x) { return /BKN|OVC|OVX/.test(x.cover) && x.base != null; }).sort(function (a, b) { return a.base - b.base; })[0];
		return c ? c.base : null;
	}

	types.briefing = {
		name: "Approach briefing", desc: "Arrival runway, wind on the runway, weather, frequencies and landing weight on one tile", icon: "flag", group: "flight", helper: true, parts: ["sim"],
		w: 4, h: 2, minW: 2, minH: 2, maxW: 8, maxH: 4, tickMs: 60000,
		build: function (ctx) {
			ctx.body.innerHTML = '<div class="br-top"><b class="br-ap"></b><span class="br-rwy"></span></div><div class="br-grid"></div><div class="br-note"></div>';
			var ap = ctx.body.querySelector(".br-ap"), rw = ctx.body.querySelector(".br-rwy"), grid = ctx.body.querySelector(".br-grid"), note = ctx.body.querySelector(".br-note");
			U.dragScroll(grid);
			function cell(k, v, sub, cls) { return '<div class="br-c' + (cls ? " " + cls : "") + '"><span>' + esc(k) + "</span><b>" + v + "</b>" + (sub ? "<em>" + esc(sub) + "</em>" : "") + "</div>"; }
			return function () {
				if (helperGate(ctx) === true) return;
				var p = planData().data;
				if (!p) return waitBox(grid, "Waiting for your SimBrief plan…");
				var x = p.x || {};
				var si = siP.get();
				var rwyId = (si && si.running && si.to === p.to && si.arrRwy) || p.toRwy || "";
				var a = airport(p.to), m = metar(p.to), re = runwayEnd(a, rwyId);
				setText(ap, p.to + (p.toName ? " · " + p.toName : ""));
				setText(rw, rwyId ? "Runway " + rwyId : "");
				var html = "";
				if (re) html += cell("Runway " + re.end.id, num(re.rwy.lengthFt * 0.3048) + "<small> m</small>", Math.round(re.end.hdg) + "° true · " + num(re.end.elev) + " ft" + (re.end.dispFt ? " · displaced " + num(re.end.dispFt * 0.3048) + " m" : ""));
				else html += cell("Runway", rwyId || "--", a && a.old ? "Update Control Hub for runway data" : a ? "Not in the runway list" : "Loading…");
				var w = re ? windParts(m, re.end.hdg) : null;
				if (w && w.head != null) {
					var hw = w.head >= 0 ? "Head " + w.head : "Tail " + -w.head, xw = w.cross === 0 ? "no cross" : (w.cross > 0 ? "from the right " : "from the left ") + Math.abs(w.cross);
					html += cell("Wind on the runway", esc(hw) + "<small> kt</small>", w.text + " · cross " + xw + " kt", w.head < -5 || Math.abs(w.cross) > 20 ? "warn" : "");
				} else html += cell("Wind", m ? esc(w ? w.text : m.wspd === 0 ? "Calm" : "--") : "--", m ? "" : "Getting the weather…");
				if (m) {
					var cl = ceiling(m), vis = m.visib == null ? "--" : String(m.visib).indexOf("+") >= 0 || +m.visib >= 6 ? "10 km+" : Math.round(m.visib * 1.609) + " km";
					html += cell("Visibility · ceiling", esc(vis), cl != null ? "Ceiling " + num(cl) + " ft" : "No ceiling", cl != null && cl < 1000 ? "warn" : "");
					html += cell("QNH · temp", (m.altim != null ? Math.round(m.altim) : "--") + "<small> hPa</small>", m.temp != null ? Math.round(m.temp) + "° / dew " + Math.round(m.dewp) + "°" : "");
				}
				var atis = freq(a, /ATIS/i), twr = freq(a, /TWR|TOWER/i), app = freq(a, /APP|APPROACH|ARR/i);
				html += cell("ATIS · Tower", esc(atis || "--"), (twr ? "Tower " + twr : "") + (app ? (twr ? " · " : "") + "Approach " + app : ""));
				html += cell("Landing weight", esc(kg(p.ldw, x.units).replace(/ (t|kg|k lbs|lbs)$/, "")) + "<small> " + (kg(p.ldw, x.units).split(" ").pop()) + "</small>", x.maxLdw ? "max " + kg(x.maxLdw, x.units) : "");
				var s = live(), eta = p.on;
				if (s && p.to_lat != null && s.gs > 50) eta = Date.now() + (distNm(s.lat, s.lon, p.to_lat, p.to_lon) / s.gs) * 3600000;
				html += cell("Arrival", esc(zulu(eta)), s && s.gs > 50 ? num(distNm(s.lat, s.lon, p.to_lat, p.to_lon)) + " NM to go" : "planned");
				setHtml(grid, html);
				setText(note, "ILS frequency and minimums: on your approach chart");
			};
		},
	};

	/* ================================================================== taxi helper */
	var siP = Round6.poller("/api/si", 15000, 8000), parkP = Round6.poller("/api/si/parking", 120000, 15000);

	types.taxi = {
		name: "Taxi helper", desc: "Your gate and runway on a simple airport map", icon: "pages", group: "flight", helper: true, parts: ["sim"],
		w: 3, h: 2, minW: 2, minH: 2, maxW: 8, maxH: 6, tickMs: 2000,
		build: function (ctx) {
			ctx.node.classList.add("no-swipe");
			ctx.body.innerHTML = '<div class="tx-map"><svg class="tx-svg"></svg></div><div class="tx-bar"><b class="tx-ap"></b><span class="tx-info"></span></div>';
			var svgEl = ctx.body.querySelector(".tx-svg"), map = ctx.body.querySelector(".tx-map"), apEl = ctx.body.querySelector(".tx-ap"), info = ctx.body.querySelector(".tx-info");
			var drawn = "";
			return function () {
				if (helperGate(ctx) === true) return;
				var p = planData().data, s = live();
				var arriving = s && /^(descent|approach|landing|taxi-in)$/.test(s.phase || "");
				if (s && p && p.to_lat != null && distNm(s.lat, s.lon, p.to_lat, p.to_lon) < 8) arriving = true;
				var icao = p ? (arriving ? p.to : p.from) : "";
				var si = siP.get(), siOk = si && si.ok !== false && si.running !== false;
				if (siOk && si.airport && !p) icao = si.airport;
				if (!icao) return setHtml(map, '<div class="notice small"><span>Waiting for your SimBrief plan…</span></div>');
				var a = airport(icao);
				if (!a) return setHtml(map, '<div class="notice small"><span>Loading ' + esc(icao) + "…</span></div>");
				if (a.old) return setHtml(map, '<div class="notice small"><b>Update Control Hub</b><span>The taxi map needs a newer Control Hub.</span></div>');
				if (!a.runways.length) return setHtml(map, '<div class="notice small"><span>No runway map for ' + esc(icao) + "</span></div>");
				if (!map.querySelector("svg")) { map.innerHTML = '<svg class="tx-svg"></svg>'; svgEl = map.querySelector("svg"); }
				var rwyId = arriving ? (siOk && si.arrRwy) || (p && p.toRwy) || "" : (siOk && (si.depRwy || si.runway)) || (p && p.fromRwy) || "";
				var gate = siOk ? si.gate || "" : "";
				var park = null, pk = gate ? parkP.get() : null;
				var plist = pk && pk.data && (pk.data.parking || pk.data.Parking || pk.data);
				if (Array.isArray(plist)) park = plist.filter(function (g) { return String(g.name).toUpperCase() === String(gate).toUpperCase() && g.lat != null && g.lon != null && Math.abs(g.lat) > 1; })[0] || null;
				// Projection around the airport.
				var pts = [];
				a.runways.forEach(function (r) { r.ends.forEach(function (e) { pts.push([e.lat, e.lon]); }); });
				var lat0 = pts.reduce(function (t, q) { return t + q[0]; }, 0) / pts.length;
				var kx = Math.cos((lat0 * Math.PI) / 180);
				var near = s && Math.abs(s.lat - lat0) < 0.06 && Math.abs(s.lon - pts[0][1]) < 0.1;
				if (near) pts.push([s.lat, s.lon]);
				if (park) pts.push([park.lat, park.lon]);
				var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
				pts.forEach(function (q) { var X = q[1] * kx, Y = -q[0]; minX = Math.min(minX, X); maxX = Math.max(maxX, X); minY = Math.min(minY, Y); maxY = Math.max(maxY, Y); });
				var W = map.clientWidth || 300, H = map.clientHeight || 200, pad = 28;
				var sc = Math.min((W - 2 * pad) / Math.max(maxX - minX, 0.002), (H - 2 * pad) / Math.max(maxY - minY, 0.002));
				function P(la, lo) { return [pad + (lo * kx - minX) * sc + ((W - 2 * pad) - (maxX - minX) * sc) / 2, pad + (-la - minY) * sc + ((H - 2 * pad) - (maxY - minY) * sc) / 2]; }
				var mPerPx = 111320 / sc;
				var key = [icao, rwyId, gate, park ? 1 : 0, W, H, near ? Math.round(s.lat * 1e4) + "," + Math.round(s.lon * 1e4) + "," + Math.round(s.hdg) : ""].join("|");
				if (key !== drawn) {
					drawn = key;
					var g = "";
					var act = String(rwyId || "").toUpperCase();
					a.runways.forEach(function (r) {
						var e1 = P(r.ends[0].lat, r.ends[0].lon), e2 = P(r.ends[1].lat, r.ends[1].lon);
						var on = r.ends.some(function (e) { return String(e.id).toUpperCase() === act; });
						var wpx = Math.max(4, Math.min(14, ((r.widthFt || 150) * 0.3048) / mPerPx));
						g += '<line class="tx-rw' + (on ? " on" : "") + '" x1="' + e1[0].toFixed(1) + '" y1="' + e1[1].toFixed(1) + '" x2="' + e2[0].toFixed(1) + '" y2="' + e2[1].toFixed(1) + '" stroke-width="' + wpx.toFixed(1) + '"/>';
						r.ends.forEach(function (e, i) {
							var q = i === 0 ? e1 : e2, o = i === 0 ? e2 : e1, dx = q[0] - o[0], dy = q[1] - o[1], L = Math.sqrt(dx * dx + dy * dy) || 1;
							var lx = q[0] + (dx / L) * 13, ly = q[1] + (dy / L) * 13 + 4;
							g += '<text class="tx-id' + (String(e.id).toUpperCase() === act ? " on" : "") + '" x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '">' + esc(e.id) + "</text>";
						});
					});
					if (park) { var gp = P(park.lat, park.lon); g += '<g class="tx-gate" transform="translate(' + gp[0].toFixed(1) + "," + gp[1].toFixed(1) + ')"><circle r="7"/><text y="-11">' + esc(gate) + "</text></g>"; }
					if (near) { var pp = P(s.lat, s.lon); g += '<g class="tx-me" transform="translate(' + pp[0].toFixed(1) + "," + pp[1].toFixed(1) + ") rotate(" + Math.round(s.hdg || 0) + ')"><path d="M0,-10 L7,8 L0,4 L-7,8 Z"/></g>'; }
					svgEl.setAttribute("viewBox", "0 0 " + W + " " + H);
					svgEl.innerHTML = g;
				}
				setText(apEl, icao + (rwyId ? " · runway " + rwyId : ""));
				var bits = [];
				if (gate) bits.push("Gate " + gate);
				var re = runwayEnd(a, rwyId);
				if (near && re && !arriving) bits.push(num(distNm(s.lat, s.lon, re.end.lat, re.end.lon) * 1852) + " m to runway " + re.end.id);
				if (near && park) bits.push(num(distNm(s.lat, s.lon, park.lat, park.lon) * 1852) + " m to the gate");
				var gnd = freq(a, /GND|GROUND/i);
				if (gnd) bits.push("Ground " + gnd);
				var path = siOk && typeof si.taxi === "string" && si.taxi.length < 80 ? si.taxi.replace(/[\[\]"]/g, "").replace(/,/g, " ") : "";
				if (path) bits.unshift("Taxi " + path);
				setText(info, bits.join(" · ") || (siOk ? "" : "Gate shows up when SayIntentions gives you one"));
			};
		},
	};

	/* ================================================================== airline stats */
	var logC = { at: 0, data: null, busy: false };
	function flightLog() {
		if (Helper.online && !logC.busy && Date.now() - logC.at > 60000) {
			logC.busy = true;
			Helper.fetch("/api/flightlog", { cache: "no-store" }, 6000).then(function (r) { logC.data = r.flights || []; }, function () {}).then(function () { logC.at = Date.now(); logC.busy = false; App.dirty(); });
		}
		return logC.data;
	}

	types.fstats = {
		name: "Airline stats", desc: "Hours, landings, best landing and favourite airports from your flight log", icon: "trophy", group: "flight", helper: true,
		w: 4, h: 2, minW: 2, minH: 1, maxW: 8, maxH: 4, tickMs: 60000,
		build: function (ctx) {
			ctx.body.innerHTML = '<div class="th">' + svg("trophy") + '<span>My airline</span><span class="fs-sum"></span></div><div class="fs-grid"></div>';
			var grid = ctx.body.querySelector(".fs-grid"), sum = ctx.body.querySelector(".fs-sum"), shown = "";
			U.dragScroll(grid);
			function cell(k, v, sub) { return '<div class="fs-c"><span>' + esc(k) + "</span><b>" + v + "</b>" + (sub ? "<em>" + esc(sub) + "</em>" : "") + "</div>"; }
			function top(list) {
				var c = {};
				list.forEach(function (x) { if (x) c[x] = (c[x] || 0) + 1; });
				return Object.keys(c).sort(function (a, b) { return c[b] - c[a]; }).slice(0, 3).map(function (k) { return [k, c[k]]; });
			}
			return function () {
				if (helperGate(ctx) === true) return;
				var f = flightLog();
				if (!f) return waitBox(grid, "Loading your flight log…");
				var key = f.length + ":" + (f[0] ? f[0].date : 0) + ":" + ctx.w + ctx.h;
				if (key === shown) return;
				shown = key;
				if (!f.length) return waitBox(grid, "Your stats grow by themselves: every flight is logged when you park at the gate.");
				var mins = 0, air = 0, fpms = [], best = null, month = 0, now = new Date(), longest = null, grades = {};
				f.forEach(function (x) {
					mins += x.blockMin || 0;
					air += x.airMin || 0;
					if (x.fpm != null) { fpms.push(x.fpm); if (!best || x.fpm < best.fpm) best = x; }
					var d = new Date(x.date);
					if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) month++;
					if (!longest || (x.blockMin || 0) > (longest.blockMin || 0)) longest = x;
					if (x.grade) grades[x.grade] = (grades[x.grade] || 0) + 1;
				});
				var avg = fpms.length ? Math.round(fpms.reduce(function (a, b) { return a + b; }, 0) / fpms.length) : null;
				var aps = top([].concat(f.map(function (x) { return x.from; }), f.map(function (x) { return x.to; })));
				var acs = top(f.map(function (x) { return String(x.aircraft || "").replace(/\s*(Airbus House|Livery).*$/i, "").slice(0, 28); }));
				setText(sum, f.length + " flights");
				var hours = Math.floor(mins / 60) + "<small>:" + two(Math.round(mins % 60)) + "</small>";
				var html = cell("Block hours", hours, "air " + Math.floor(air / 60) + ":" + two(Math.round(air % 60))) +
					cell("Flights", f.length, month + " this month") +
					cell("Average landing", avg != null ? "−" + avg + "<small> fpm</small>" : "--", fpms.length + " landings") +
					cell("Best landing", best ? "−" + best.fpm + "<small> fpm</small>" : "--", best ? (best.from || "?") + "–" + (best.to || "?") + (best.grade ? " · " + best.grade : "") : "") +
					cell("Favourite airports", aps.length ? esc(aps.map(function (a) { return a[0]; }).join(" · ")) : "--", aps.length ? aps[0][1] + " visits to " + aps[0][0] : "") +
					cell("Favourite aircraft", acs.length ? esc(acs[0][0]) : "--", acs.length ? acs[0][1] + " flights" : "") +
					cell("Longest flight", longest ? esc((longest.from || "?") + "–" + (longest.to || "?")) : "--", longest ? Math.floor((longest.blockMin || 0) / 60) + ":" + two((longest.blockMin || 0) % 60) + " block" : "") +
					cell("Grades", Object.keys(grades).length ? ["A+", "A", "B", "C", "D", "F"].filter(function (g) { return grades[g]; }).map(function (g) { return g + "<small>×" + grades[g] + "</small>"; }).join(" ") : "--", "");
				setHtml(grid, html);
			};
		},
	};

	/* ================================================================== landing replay card */
	types.lreplay = {
		name: "Landing replay", desc: "Grade, landing rate, G, where on the runway you touched down", icon: "plane", group: "flight", helper: true, parts: ["sim"],
		w: 3, h: 2, minW: 2, minH: 1, maxW: 6, maxH: 4,
		build: function (ctx) {
			ctx.body.innerHTML = '<div class="lr"><div class="lr-grade"><b></b></div><div class="lr-main"><div class="lr-top"><b class="lr-fpm"></b><span class="lr-rt"></span></div>' +
				'<div class="lr-facts"></div></div></div><div class="lr-rwy"><i class="lr-tdz"></i><i class="lr-cl"></i><s class="lr-dot"></s><span class="lr-a"></span><span class="lr-b"></span></div>';
			var q = function (c) { return ctx.body.querySelector(c); };
			var lastAt = null;
			return function () {
				if (helperGate(ctx) === true) return;
				var l = (sim() || {}).landing;
				if (!l) {
					ctx.node.dataset.grade = "";
					setText(q(".lr-grade b"), "–");
					setHtml(q(".lr-fpm"), "No landing yet");
					setText(q(".lr-rt"), "");
					setHtml(q(".lr-facts"), "<span>Land somewhere and your replay card shows up here.</span>");
					q(".lr-rwy").style.visibility = "hidden";
					return;
				}
				if (lastAt !== null && l.at !== lastAt) {
					ctx.node.classList.remove("lr-new");
					void ctx.node.offsetWidth;
					ctx.node.classList.add("lr-new");
				}
				lastAt = l.at;
				var grade = l.grade || "";
				ctx.node.dataset.grade = grade.replace("+", "p");
				setText(q(".lr-grade b"), grade || "?");
				setHtml(q(".lr-fpm"), "−" + l.fpm + "<small> fpm</small>");
				setText(q(".lr-rt"), l.rating + (l.rwy ? " · runway " + l.rwy : ""));
				var facts = ['<span><b>' + (l.g != null ? (+l.g).toFixed(2) : "--") + "</b> G</span>"];
				if (l.distM != null) facts.push("<span><b>" + num(l.distM) + " m</b> past the threshold</span>");
				if (l.clM != null) facts.push("<span><b>" + Math.abs(l.clM).toFixed(1) + " m</b> " + (Math.abs(l.clM) < 0.5 ? "on the centerline" : l.clM > 0 ? "right of centerline" : "left of centerline") + "</span>");
				facts.push("<span>bank <b>" + Math.abs(l.bank) + "°</b> · pitch <b>" + l.pitch + "°</b>" + (l.ias ? " · <b>" + l.ias + "</b> kt" : "") + "</span>");
				setHtml(q(".lr-facts"), facts.join(""));
				var rw = q(".lr-rwy");
				if (l.distM != null && l.lengthM) {
					rw.style.visibility = "";
					var len = l.lengthM;
					q(".lr-tdz").style.left = (300 / len) * 100 + "%";
					q(".lr-tdz").style.width = (300 / len) * 100 + "%";
					q(".lr-dot").style.left = U.clamp((l.distM / len) * 100, 0, 100) + "%";
					q(".lr-dot").style.top = U.clamp(50 + (l.clM || 0) * 2.2, 10, 90) + "%";
					setText(q(".lr-a"), l.rwy || "");
					setText(q(".lr-b"), num(len) + " m");
				} else rw.style.visibility = "hidden";
			};
		},
	};

	return {};
})();
