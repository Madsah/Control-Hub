/* Control Panel — Round 5: flight sim tiles for MSFS 2024 (live data through the helper's SimConnect link),
 * SimBrief, METAR, map, checklists, landing rate and flight log. */

var Flight = (function () {
	var svg = U.svg, el = U.el, esc = U.esc, setText = U.setText, setHtml = U.setHtml;
	var types = T.types, helperGate = T.helperGate;

	T.GROUPS.push(["flight", "Flight sim"]);

	/* ------------------------------------------------------------------ shared data */
	function sim() { return (Helper.state && Helper.state.sim) || null; }
	function live() { var s = sim(); return s && s.connected ? s : null; }
	function two(n) { return ("0" + n).slice(-2); }
	function num(n) { return n == null || isNaN(n) ? "--" : Math.round(n).toLocaleString("en-GB"); }
	function zuluOf(ms) { var d = new Date(ms); return two(d.getUTCHours()) + two(d.getUTCMinutes()) + "Z"; }
	function hhmm(min) { min = Math.max(0, Math.round(min)); return Math.floor(min / 60) + ":" + two(min % 60); }
	function secToClock(s) { s = Math.max(0, Math.floor(s)) % 86400; return two(Math.floor(s / 3600)) + ":" + two(Math.floor((s % 3600) / 60)); }

	function getText(url) {
		function viaHelper() {
			if (!Helper.online) return Promise.reject(new Error("helper"));
			return fetch(Helper.base() + "/api/fetch?url=" + encodeURIComponent(url), { cache: "no-store" }).then(function (r) {
				if (!r.ok) throw new Error("http " + r.status);
				return r.text();
			});
		}
		return viaHelper().catch(function () {
			return fetch(url, { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("http"); return r.text(); });
		});
	}

	var cache = {};
	function cached(key, maxAge, load) {
		var c = cache[key] || (cache[key] = { at: 0, data: null, err: null, busy: false });
		if (!c.busy && Date.now() - c.at > (c.err ? 60000 : maxAge)) {
			c.busy = true;
			load().then(function (d) { c.data = d; c.err = null; }, function (e) { c.err = e || true; }).then(function () {
				c.at = Date.now();
				c.busy = false;
				App.dirty();
			});
		}
		return c;
	}
	function refresh(key) { if (cache[key]) cache[key].at = 0; App.dirty(); }

	/* SimBrief: the latest plan for your username. */
	function simbriefUser() { return Editor.storeGet("cpSimbrief") || ""; }
	var lastPlanSent = "";
	function plan() {
		var user = simbriefUser();
		// No username yet: nothing to fetch (the SimBrief tile asks for it).
		if (!user) return { data: null, err: "Add your SimBrief username: Edit → ✏ on the SimBrief tile", nouser: true };
		var c = cached("sb:" + user, 10 * 60000, function () {
			return getText("https://www.simbrief.com/api/xml.fetcher.php?json=1&username=" + encodeURIComponent(user)).then(JSON.parse).then(parsePlan);
		});
		if (c.data && Helper.online) {
			var key = c.data.from + c.data.to + c.data.flight;
			if (key !== lastPlanSent) {
				lastPlanSent = key;
				Helper.act({ action: "simPlan", from: c.data.from, to: c.data.to, flight: c.data.flight }, true);
			}
		}
		return c;
	}

	function parsePlan(j) {
		if (!j || !j.origin) throw new Error((j && j.fetch && j.fetch.status) || "No plan");
		var g = j.general || {}, f = j.fuel || {}, w = j.weights || {}, t = j.times || {}, units = (j.params && j.params.units) || "kgs";
		var kg = units === "lbs" ? 0.453592 : 1;
		function n(x) { var v = parseFloat(x); return isNaN(v) ? null : v; }
		var fixes = ((j.navlog && j.navlog.fix) || []).map(function (x) {
			return { id: x.ident, lat: n(x.pos_lat), lon: n(x.pos_long), via: x.via_airway || "", alt: n(x.altitude_feet), type: x.type || "", name: x.name || "",
				leg: n(x.distance), time: n(x.time_total), fuel: n(x.fuel_plan_onboard) != null ? n(x.fuel_plan_onboard) * kg : null, wind: x.wind_dir != null ? ("00" + x.wind_dir).slice(-3) + "/" + x.wind_spd : "", sidstar: x.is_sid_star === "1" };
		}).filter(function (x) { return x.lat != null; });
		var o = j.origin, d = j.destination, a = j.alternate || {};
		var extra = {
			costIndex: g.costindex || "", avgWind: g.avg_wind_comp != null ? n(g.avg_wind_comp) : null, pax: n(w.pax_count) != null ? n(w.pax_count) : n(g.passengers),
			payload: n(w.payload) * kg, cargo: n(w.cargo) * kg, oew: n(w.oew) * kg, maxZfw: n(w.max_zfw) * kg, maxTow: n(w.max_tow) * kg, maxLdw: n(w.max_ldw) * kg,
			taxi: n(f.taxi) * kg, contingency: n(f.contingency) * kg, extraFuel: n(f.extra) * kg, minTo: n(f.min_takeoff) * kg, planTo: n(f.plan_takeoff) * kg, planLdg: n(f.plan_landing) * kg,
			altName: a.name || "", altRwy: a.plan_rwy || "", altDist: n(a.distance), altRoute: a.route || "",
			fromMetar: o.metar || "", toMetar: d.metar || "", toTaf: d.taf || "", toTransLevel: d.trans_level || "", fromTransAlt: o.trans_alt || "",
			reg: (j.aircraft && j.aircraft.reg) || "", callsign: (j.atc && j.atc.callsign) || "", units: units === "lbs" ? "lbs" : "kg",
			block: n(t.est_block),
		};
		return {
			x: extra,
			flight: (g.icao_airline || "") + (g.flight_number || ""),
			from: j.origin.icao_code, to: j.destination.icao_code, alt: j.alternate ? j.alternate.icao_code : "",
			fromName: j.origin.name, toName: j.destination.name,
			fromRwy: j.origin.plan_rwy, toRwy: j.destination.plan_rwy,
			from_lat: n(j.origin.pos_lat), from_lon: n(j.origin.pos_long),
			to_lat: n(j.destination.pos_lat), to_lon: n(j.destination.pos_long), to_elev: n(j.destination.elevation) || 0,
			route: g.route || "", cruise: n(g.initial_altitude), dist: n(g.route_distance) || n(g.air_distance),
			aircraft: (j.aircraft && (j.aircraft.name || j.aircraft.icaocode)) || "",
			out: n(t.sched_out) * 1000, off: n(t.sched_off) * 1000, on: n(t.sched_on) * 1000, in: n(t.sched_in) * 1000,
			ete: n(t.est_time_enroute),
			block: n(f.plan_ramp) * kg, burn: n(f.enroute_burn) * kg, reserve: n(f.reserve) * kg, altBurn: n(f.alternate_burn) * kg,
			zfw: n(w.est_zfw) * kg, tow: n(w.est_tow) * kg, ldw: n(w.est_ldw) * kg,
			fixes: fixes,
		};
	}

	function distNm(a, b, c, d) {
		var R = 3440.065, toR = Math.PI / 180;
		var dLat = (c - a) * toR, dLon = (d - b) * toR;
		var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a * toR) * Math.cos(c * toR) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
		return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
	}

	function kgText(kg) { return kg == null ? "--" : kg >= 10000 ? (kg / 1000).toFixed(1) + " t" : Math.round(kg) + " kg"; }

	/* A notice when the sim isn't there yet (or SimConnect isn't set up). */
	function simGate(ctx, box) {
		if (helperGate(ctx) === true) return true;
		var s = sim();
		if (s && s.connected) { box.classList.remove("sim-off"); return false; }
		box.classList.add("sim-off");
		var msg = !s ? "Connecting…"
			: !s.dll ? '<b>One-time setup</b><span>Control Hub needs SimConnect.dll from the free MSFS 2024 SDK.</span><button class="pill accent sim-how">How?</button>'
			: !s.running ? "<b>MSFS isn't running</b><span>Start a flight and this fills in by itself</span>"
			: "<b>Waiting for MSFS…</b><span>" + esc(s.status || "") + "</span>";
		setHtml(box, '<div class="notice small">' + msg + "</div>");
		var how = box.querySelector(".sim-how");
		if (how) how.onclick = function (e) { e.stopPropagation(); if (!App.editing) simGuide(); };
		return true;
	}

	function simGuide() {
		var wrap = el("div", "opts");
		Editor.modal("Connect MSFS 2024 (one time)", wrap);
		var steps = [
			["Start MSFS 2024 and open Options → General → Developers", "Turn on Developer Mode"],
			["In the bar at the top of the screen, choose Help → SDK Installer", "It downloads the free SDK installer in your browser"],
			["Run the installer. Keep the folder it suggests (like C:\\MSFS 2024 SDK)", ""],
			["Restart Control Hub Service (Control Hub → Projects → Restart)", "It finds SimConnect.dll by itself"],
			["Still not found? Open Control Hub → Connections → SimConnect and pick it in the SDK's \"SimConnect SDK\\lib\" folder", "Control Hub keeps its own copy, also after updates"],
		];
		var ol = el("ol", "guide");
		steps.forEach(function (s) {
			var li = el("li", "", "<b></b>" + (s[1] ? "<em></em>" : ""));
			li.querySelector("b").textContent = s[0];
			if (s[1]) li.querySelector("em").textContent = s[1];
			ol.appendChild(li);
		});
		wrap.appendChild(ol);
		wrap.appendChild(el("p", "hint", "You can turn Developer Mode off again afterwards."));
	}

	/* ------------------------------------------------------------------ flight dashboard */
	types.fdash = {
		name: "Flight dashboard", desc: "Speed, altitude, heading, V/S, fuel", icon: "plane", group: "flight", helper: true, parts: ["sim"],
		w: 3, h: 1, minW: 2, minH: 1, maxW: 6, maxH: 3,
		build: function (ctx) {
			ctx.body.innerHTML = '<div class="fd"></div>';
			var box = ctx.body.querySelector(".fd"), cells = null;
			var items = [["ias", "IAS", "kt"], ["alt", "ALT", "ft"], ["hdg", "HDG", "°"], ["vs", "V/S", "fpm"], ["gs", "GS", "kt"], ["fuel", "FUEL", ""]];
			return function () {
				if (simGate(ctx, box)) return (cells = null);
				var s = live();
				if (!cells) {
					// One row: as many values as the tile is wide. Two rows or more: all six.
					var n = ctx.h >= 2 ? 6 : Math.min(ctx.w, 6);
					var perRow = ctx.h >= 2 ? Math.min(Math.max(ctx.w, 2), 3) : n;
					box.style.gridTemplateColumns = "repeat(" + perRow + ", minmax(0, 1fr))";
					box.innerHTML = "";
					cells = items.slice(0, n).map(function (it) {
						var c = el("div", "fd-c", "<span>" + it[1] + "</span><b></b>");
						box.appendChild(c);
						return { k: it[0], u: it[2], b: c.querySelector("b") };
					});
				}
				cells.forEach(function (c) {
					var counting = typeof Round8 !== "undefined" && document.body.classList.contains("count-up") && /^(ias|alt|gs|vs)$/.test(c.k);
					if (counting) {
						if (!c.n) { c.b.innerHTML = '<span></span><small>' + c.u + "</small>"; c.n = c.b.firstChild; }
						return Round8.countTo(c.n, s[c.k], 0, "", function (n) { return (c.k === "vs" && n > 0 ? "+" : "") + num(n); });
					}
					c.n = null;
					var val = c.k === "fuel" ? kgText(s.fuelKg) : c.k === "hdg" ? ("00" + Math.round(s.hdg) % 360).slice(-3) : c.k === "vs" ? (s.vs > 0 ? "+" : "") + num(s.vs) : num(s[c.k]);
					setHtml(c.b, esc(val) + (c.u && c.k !== "fuel" ? "<small>" + c.u + "</small>" : ""));
				});
				ctx.node.dataset.phase = s.phase || "";
			};
		},
	};

	/* ------------------------------------------------------------------ SimBrief */
	types.simbrief = {
		name: "SimBrief", desc: "Your latest flight plan", icon: "list", group: "flight", helper: true,
		w: 3, h: 2, minW: 2, minH: 1, maxW: 6, maxH: 4,
		edit: function (t, back) { editSimbrief(t, back); },
		build: function (ctx) {
			ctx.node.classList.add("press");
			ctx.body.innerHTML = '<div class="sb"></div>';
			var box = ctx.body.querySelector(".sb");
			ctx.node.addEventListener("click", function () {
				if (App.editing) return;
				refresh("sb:" + simbriefUser());
				U.toast("Getting your latest SimBrief plan…");
			});
			return function () {
				if (helperGate(ctx) === true) return;
				var c = plan(), p = c.data;
				if (!p && c.nouser) return setHtml(box, '<div class="notice small"><b>Add your SimBrief username</b><span>Tap Edit, then ✏ on this tile. Your latest plan shows here.</span></div>');
				if (!p) return setHtml(box, '<div class="notice small"><span>' + (c.err ? "Couldn't get your SimBrief plan (" + esc(simbriefUser()) + ")" : "Loading your SimBrief plan…") + "</span></div>");
				var html = '<div class="sb-top"><b class="sb-route">' + esc(p.from) + ' <i>' + svg("plane") + "</i> " + esc(p.to) + '</b><span class="sb-flt">' + esc(p.flight) + "</span></div>" +
					'<div class="sb-sub">' + esc(p.aircraft) + (p.cruise ? " · FL" + Math.round(p.cruise / 100) : "") + (p.dist ? " · " + num(p.dist) + " NM" : "") + (p.alt ? " · ALTN " + esc(p.alt) : "") + "</div>";
				if (ctx.h >= 2) {
					html += '<div class="sb-grid">' +
						cell("Out", p.out ? zuluOf(p.out) : "--") + cell("Off", p.off ? zuluOf(p.off) : "--") + cell("On", p.on ? zuluOf(p.on) : "--") + cell("In", p.in ? zuluOf(p.in) : "--") +
						cell("Block fuel", kgText(p.block)) + cell("Trip", kgText(p.burn)) + cell("ZFW", kgText(p.zfw)) + cell("TOW", kgText(p.tow)) + "</div>" +
						'<div class="sb-rte">' + esc(p.route) + "</div>";
				}
				setHtml(box, html);
			};
		},
	};
	function cell(k, v) { return "<div><span>" + esc(k) + "</span><b>" + esc(v) + "</b></div>"; }

	function editSimbrief(t, back) {
		var wrap = el("div", "opts");
		Editor.modal("SimBrief", wrap, back);
		wrap.innerHTML = '<div class="opt"><h4>Your SimBrief username</h4><input class="search" maxlength="40" /><p class="hint">Or your Pilot ID (the number under Account on simbrief.com).</p></div>';
		var input = wrap.querySelector("input");
		input.value = simbriefUser();
		var save = el("button", "pill accent save-btn", "Save");
		save.addEventListener("click", function () {
			var v = input.value.trim();
			if (!/^[A-Za-z0-9_.\-]{2,40}$/.test(v)) return U.toast("That doesn't look like a username");
			Editor.storeSet("cpSimbrief", v);
			Editor.saveTile(t, back);
		});
		wrap.appendChild(save);
	}

	/* ------------------------------------------------------------------ METAR */
	function metars(ids) {
		ids = ids.filter(Boolean);
		if (!ids.length) return null;
		var key = ids.join(",");
		return cached("metar:" + key, 10 * 60000, function () {
			return getText("https://aviationweather.gov/api/data/metar?format=json&ids=" + encodeURIComponent(key)).then(JSON.parse);
		});
	}

	function decodeMetar(m) {
		var wind = m.wdir === "VRB" ? "Variable" : m.wdir != null ? ("00" + m.wdir).slice(-3) + "°" : "";
		wind += m.wspd != null ? " " + m.wspd + " kt" + (m.wgst ? " gusts " + m.wgst : "") : "";
		if (m.wspd === 0) wind = "Calm";
		var vis = m.visib == null ? "" : String(m.visib).indexOf("+") >= 0 || +m.visib >= 6 ? "10 km+" : Math.round(m.visib * 1.609) + " km";
		var clouds = (m.clouds || []).filter(function (c) { return c.cover && c.cover !== "CLR" && c.cover !== "SKC"; }).map(function (c) {
			return ({ FEW: "Few", SCT: "Scattered", BKN: "Broken", OVC: "Overcast", OVX: "Sky hidden" }[c.cover] || c.cover) + (c.base != null ? " " + num(c.base) : "");
		});
		return {
			wind: wind, vis: vis, clouds: clouds.length ? clouds.join(", ") : "No clouds",
			temp: m.temp != null ? Math.round(m.temp) + "° / " + Math.round(m.dewp) + "°" : "",
			qnh: m.altim != null ? Math.round(m.altim) + " hPa" : "",
			cat: m.fltCat || "", raw: m.rawOb || "",
		};
	}

	types.metar = {
		name: "METAR", desc: "Weather at departure and arrival, in plain words", icon: "cloud", group: "flight", helper: true,
		w: 3, h: 2, minW: 2, minH: 1, maxW: 6, maxH: 4, tickMs: 60000,
		options: function () {
			return [{ key: "which", label: "Airports", type: "choice", "default": "both",
				choices: [{ value: "both", label: "Departure and arrival" }, { value: "to", label: "Arrival only" }, { value: "from", label: "Departure only" }, { value: "all", label: "Departure, arrival and alternate" }] }];
		},
		build: function (ctx) {
			ctx.body.innerHTML = '<div class="mt"></div>';
			var box = ctx.body.querySelector(".mt");
			ctx.node.classList.add("press");
			ctx.node.addEventListener("click", function () { if (!App.editing) { Object.keys(cache).forEach(function (k) { if (k.indexOf("metar:") === 0) refresh(k); }); } });
			return function () {
				if (helperGate(ctx) === true) return;
				var p = plan().data;
				if (!p) return setHtml(box, '<div class="notice small"><span>Waiting for your SimBrief plan…</span></div>');
				var which = (ctx.tile.cfg || {}).which || "both";
				var ids = which === "to" ? [p.to] : which === "from" ? [p.from] : which === "all" ? [p.from, p.to, p.alt] : [p.from, p.to];
				var c = metars(ids);
				if (!c || !c.data) return setHtml(box, '<div class="notice small"><span>' + (c && c.err ? "Couldn't get the weather" : "Getting the weather…") + "</span></div>");
				var rows = ids.filter(Boolean).slice(0, Math.max(1, ctx.h)).map(function (id) {
					var m = c.data.filter(function (x) { return x.icaoId === id; })[0];
					if (!m) return '<div class="mt-row"><b class="mt-id">' + esc(id) + '</b><span class="mt-none">No report</span></div>';
					var d = decodeMetar(m);
					return '<div class="mt-row"><div class="mt-head"><b class="mt-id">' + esc(id) + '</b><span class="mt-cat cat-' + esc(d.cat) + '">' + esc(d.cat) + '</span><span class="mt-qnh">' + esc(d.qnh) + "</span></div>" +
						'<div class="mt-line">' + svg("network") + " " + esc(d.wind) + " · " + esc(d.vis) + "</div>" +
						'<div class="mt-line">' + svg("cloud") + " " + esc(d.clouds) + (d.temp ? " · " + esc(d.temp) : "") + "</div>" +
						(ctx.w >= 4 ? '<div class="mt-raw">' + esc(d.raw) + "</div>" : "") + "</div>";
				});
				setHtml(box, rows.join(""));
			};
		},
	};

	/* ------------------------------------------------------------------ flight timer */
	types.ftimer = {
		name: "Flight timer", desc: "Block and air time, starts by itself", icon: "timer", group: "flight", helper: true, parts: ["sim"],
		w: 2, h: 1, minW: 2, minH: 1, maxW: 4, maxH: 2, tickMs: 1000,
		build: function (ctx) {
			ctx.body.innerHTML = '<div class="ft"><div><span>Block</span><b class="ft-b"></b></div><div><span>Air</span><b class="ft-a"></b></div></div><span class="ft-note"></span>';
			var b = ctx.body.querySelector(".ft-b"), a = ctx.body.querySelector(".ft-a"), note = ctx.body.querySelector(".ft-note");
			return function () {
				if (helperGate(ctx) === true) return;
				var s = sim() || {}, now = Date.now();
				function span(from, to) {
					if (!from) return "--:--";
					var sec = Math.floor(((to || now) - from) / 1000);
					return Math.floor(sec / 3600) + ":" + two(Math.floor((sec % 3600) / 60)) + "<small>:" + two(sec % 60) + "</small>";
				}
				setHtml(b, span(s.blockOut, s.blockIn));
				setHtml(a, span(s.takeoff, s.landed && s.landed > (s.takeoff || 0) ? s.landed : 0));
				var ph = s.connected ? PHASES[s.phase] || s.phase : s.running ? "Waiting for MSFS" : "MSFS isn't running";
				setText(note, (ph || "") + (s.blockOut ? " · out " + zuluOf(s.blockOut) : ""));
			};
		},
	};
	var PHASES = { parked: "Parked", "taxi-out": "Taxi out", takeoff: "Takeoff", climb: "Climb", cruise: "Cruise", descent: "Descent", approach: "Approach", landing: "Landing", "taxi-in": "Taxi in" };

	/* ------------------------------------------------------------------ checklists */
	var A320 = [
		["Before start", ["Cockpit preparation · Completed", "Gear pins and covers · Removed", "Signs · On/Auto", "ADIRS · NAV", "Fuel quantity · Checked", "T.O data · Set", "Baro ref · Set", "Windows / doors · Closed", "Beacon · On", "Thrust levers · Idle", "Parking brake · Set"]],
		["After start", ["Anti ice · As required", "ECAM status · Checked", "Pitch trim · Set", "Rudder trim · Neutral"]],
		["Taxi", ["Flight controls · Checked", "Flight instruments · Checked", "Briefing · Confirmed", "Flaps setting · Set", "V1, VR, V2 / FLX temp · Set", "ATC · Set", "ECAM memo · T.O no blue"]],
		["Line-up", ["Takeoff runway · Confirmed", "Cabin crew · Advised", "TCAS · TA/RA", "Engine mode selector · As required", "Packs · As required"]],
		["After takeoff", ["Landing gear · Up", "Flaps · Retracted", "Packs · On", "Baro ref · STD"]],
		["Approach", ["Briefing · Confirmed", "ECAM status · Checked", "Seat belts · On", "Baro ref · Set", "Minimum · Set", "Auto brake · Set", "Engine mode selector · As required"]],
		["Landing", ["ECAM memo · Landing no blue", "Cabin crew · Advised", "A/THR · Speed / off"]],
		["After landing", ["Flaps · Retracted", "Spoilers · Disarmed", "APU · Start", "Radar · Off", "Predictive windshear · Off", "Lights · As required"]],
		["Parking", ["APU bleed · On", "Engines · Off", "Seat belts · Off", "External lights · As required", "Fuel pumps · Off", "Parking brake / chocks · Set"]],
		["Securing", ["ADIRS · Off", "Oxygen · Off", "APU bleed · Off", "Emergency exit light · Off", "Signs · Off", "APU and batteries · Off"]],
	];
	var A350 = [
		["Before start", ["Cockpit preparation · Completed", "Gear pins · Removed", "Signs · On/Auto", "ADIRS · NAV", "Fuel quantity · Checked", "Takeoff data · Set", "Baro ref · Set", "Doors · Closed", "Beacon · On", "Thrust levers · Idle", "Parking brake · Set"]],
		["After start", ["Anti ice · As required", "ECAM status · Checked", "Pitch trim · Set", "APU · Off / as required"]],
		["Taxi", ["Flight controls · Checked", "Brake temperatures · Checked", "Briefing · Confirmed", "Flaps setting · Set", "V1, VR, V2 / FLEX · Set", "ATC · Set", "ECAM T.O config · Normal"]],
		["Line-up", ["Takeoff runway · Confirmed", "Cabin · Ready", "TCAS · TA/RA", "Weather radar · On", "Exterior lights · Set"]],
		["After takeoff", ["Landing gear · Up", "Flaps · Retracted", "Baro ref · STD"]],
		["Approach", ["Briefing · Confirmed", "ECAM status · Checked", "Seat belts · On", "Baro ref · Set", "Minimum · Set", "Auto brake / BTV · Set"]],
		["Landing", ["ECAM landing memo · No blue", "Cabin · Ready", "A/THR · Speed / off", "Go-around altitude · Set"]],
		["After landing", ["Flaps · Retracted", "Spoilers · Disarmed", "APU · Start", "Radar · Off", "Strobes · Off"]],
		["Parking", ["APU bleed · On", "Engines · Off", "Seat belts · Off", "Fuel pumps · Off", "Parking brake · Set"]],
		["Securing", ["ADIRS · Off", "Oxygen · Off", "Signs · Off", "APU and batteries · Off"]],
	];
	var GENERIC = [
		["Before start", ["Preflight · Completed", "Fuel · Checked", "Flight plan · Loaded", "Doors · Closed", "Beacon · On", "Parking brake · Set"]],
		["Before takeoff", ["Flight controls · Checked", "Flaps · Set", "Trim · Set", "Transponder · On", "Lights · On"]],
		["After takeoff", ["Gear · Up", "Flaps · Up", "Lights · As required"]],
		["Approach", ["Briefing · Done", "Altimeter · Set", "Seat belts · On"]],
		["Landing", ["Gear · Down", "Flaps · Set", "Landing lights · On"]],
		["After landing", ["Flaps · Up", "Lights · As required", "Transponder · Standby"]],
		["Shutdown", ["Parking brake · Set", "Engines · Off", "Beacon · Off", "Battery · Off"]],
	];
	var LISTS = { a320: ["Fenix A320", A320], a350: ["iniBuilds A350", A350], generic: ["General", GENERIC] };
	var PHASE_LIST = { parked: 0, "taxi-out": 2, takeoff: 3, climb: 4, cruise: 4, descent: 5, approach: 5, landing: 6, "taxi-in": 7 };

	function aircraftKey(cfg) {
		if (cfg.ac && cfg.ac !== "auto") return cfg.ac;
		var s = live(), t = s ? (s.title || "").toLowerCase() : "";
		if (/a35[01]|a350/.test(t)) return "a350";
		if (/a32[01]|a319|a320|fenix/.test(t)) return "a320";
		return s ? "generic" : "a320";
	}

	types.checklist = {
		name: "Checklist", desc: "Fenix A320, A350 and general · tap to tick", icon: "check", group: "flight",
		w: 2, h: 3, minW: 2, minH: 2, maxW: 4, maxH: 6,
		options: function () {
			return [
				{ key: "ac", label: "Aircraft", type: "choice", "default": "auto", layout: "list", choices: [{ value: "auto", label: "Automatic", sub: "From the plane loaded in MSFS" }, { value: "a320", label: "Fenix A320" }, { value: "a350", label: "iniBuilds A350-900 / -1000" }, { value: "generic", label: "General (other planes)" }] },
				{ key: "follow", label: "Follow the flight", type: "toggle", "default": true, on: "Jumps to the next checklist by itself", off: "I choose the checklist" },
			];
		},
		build: function (ctx) {
			var cfg = ctx.tile.cfg || (ctx.tile.cfg = {});
			cfg.done = cfg.done || {};
			ctx.body.innerHTML = '<div class="ck-head"><button class="ck-nav ck-prev">' + svg("back") + '</button><b class="ck-title"></b><button class="ck-nav ck-next">' + svg("back") + '</button></div><div class="ck-list"></div><div class="mix-more"></div>';
			var title = ctx.body.querySelector(".ck-title"), list = ctx.body.querySelector(".ck-list");
			U.dragScroll(list, ctx.body.querySelector(".mix-more"));
			var lastPhase = null;
			function lists() { return LISTS[aircraftKey(cfg)][1]; }
			function go(d) {
				var n = lists().length;
				cfg.idx = ((cfg.idx || 0) + d + n) % n;
				Editor.save();
				App.dirty();
			}
			ctx.body.querySelector(".ck-prev").addEventListener("click", function (e) { e.stopPropagation(); if (!App.editing) go(-1); });
			ctx.body.querySelector(".ck-next").addEventListener("click", function (e) { e.stopPropagation(); if (!App.editing) go(1); });
			list.addEventListener("click", function (e) {
				var r = e.target.closest("[data-i]");
				if (!r || App.editing) return;
				e.stopPropagation();
				var key = aircraftKey(cfg) + ":" + (cfg.idx || 0), arr = cfg.done[key] || (cfg.done[key] = []);
				var i = +r.dataset.i, at = arr.indexOf(i);
				if (at >= 0) arr.splice(at, 1); else arr.push(i);
				var items = lists()[cfg.idx || 0][1];
				if (arr.length === items.length) {
					U.toast(lists()[cfg.idx || 0][0] + " checklist complete");
					setTimeout(function () { cfg.done[key] = []; go(1); }, 900);
				}
				Editor.save();
				App.dirty();
			});
			return function () {
				var s = live();
				if (cfg.follow !== false && s && s.phase !== lastPhase) {
					if (lastPhase !== null && PHASE_LIST[s.phase] != null) {
						var target = Math.min(PHASE_LIST[s.phase], lists().length - 1);
						if (target !== (cfg.idx || 0)) { cfg.idx = target; Editor.save(); }
					}
					lastPhase = s.phase;
				}
				var ls = lists(), idx = Math.min(cfg.idx || 0, ls.length - 1), cur = ls[idx];
				var key = aircraftKey(cfg) + ":" + idx, done = cfg.done[key] || [];
				setText(title, cur[0] + "  ·  " + LISTS[aircraftKey(cfg)][0]);
				setHtml(list, cur[1].map(function (item, i) {
					var parts = item.split(" · ");
					return '<button class="ck-row' + (done.indexOf(i) >= 0 ? " on" : "") + '" data-i="' + i + '"><span class="src-check">' + svg("check") + "</span><span class=\"ck-l\">" + esc(parts[0]) + '</span><b class="ck-r">' + esc(parts[1] || "") + "</b></button>";
				}).join(""));
			};
		},
	};

	/* ------------------------------------------------------------------ live map */
	var TILE = 256;
	function project(lat, lon, z) {
		var s = Math.pow(2, z) * TILE, r = Math.PI / 180;
		var x = (lon + 180) / 360 * s;
		var y = (1 - Math.log(Math.tan(lat * r) + 1 / Math.cos(lat * r)) / Math.PI) / 2 * s;
		return { x: x, y: y };
	}

	types.flightmap = {
		name: "Live map", desc: "Your plane, the SimBrief route and the traffic around you", icon: "globe", group: "flight", helper: true,
		parts: function (t) { return t.cfg && t.cfg.traffic === false ? ["sim"] : ["sim", "traffic"]; },
		w: 3, h: 2, minW: 2, minH: 2, maxW: 6, maxH: 6,
		options: function () {
			return [{ key: "traffic", label: "Traffic", type: "toggle", "default": true, on: "Show other aircraft (AI and SayIntentions traffic in the sim)", off: "Only my plane" }];
		},
		build: function (ctx) {
			var cfg = ctx.tile.cfg || (ctx.tile.cfg = {});
			ctx.node.classList.add("no-swipe");
			ctx.body.innerHTML = '<div class="fm"><div class="fm-tiles"></div><svg class="fm-route"><polyline/></svg><div class="fm-traffic"></div><div class="fm-plane">' + svg("plane") + '</div><div class="fm-zoom"><button data-z="1">+</button><button data-z="-1">−</button></div><span class="fm-copy">© OpenStreetMap © CARTO</span><div class="fm-info"></div></div>';
			var trafficEl = ctx.body.querySelector(".fm-traffic"), trafficKey = "";
			var fm = ctx.body.querySelector(".fm"), tilesEl = ctx.body.querySelector(".fm-tiles"), line = ctx.body.querySelector("polyline"), planeEl = ctx.body.querySelector(".fm-plane"), info = ctx.body.querySelector(".fm-info");
			var shownKey = "";
			ctx.body.querySelectorAll("[data-z]").forEach(function (b) {
				b.addEventListener("click", function (e) {
					e.stopPropagation();
					if (App.editing) return;
					cfg.zoom = U.clamp((cfg.zoom || 7) + +b.dataset.z, 3, 13);
					Editor.save();
					shownKey = "";
					App.dirty();
				});
			});
			return function () {
				if (simGate(ctx, info)) { fm.classList.add("off"); return; }
				fm.classList.remove("off");
				var s = live(), p = plan().data, z = cfg.zoom || 7;
				var W = fm.clientWidth, H = fm.clientHeight;
				var c = project(s.lat, s.lon, z);
				var ox = c.x - W / 2, oy = c.y - H / 2;
				// Map pictures: only redrawn when the plane has moved into new map squares.
				var tx0 = Math.floor(ox / TILE), ty0 = Math.floor(oy / TILE), tx1 = Math.floor((ox + W) / TILE), ty1 = Math.floor((oy + H) / TILE);
				var dark = !document.body.classList.contains("theme-light");
				var key = [z, tx0, ty0, tx1, ty1, dark].join(",");
				if (key !== shownKey) {
					shownKey = key;
					var n = Math.pow(2, z), html = "";
					for (var ty = ty0; ty <= ty1; ty++)
						for (var tx = tx0; tx <= tx1; tx++) {
							if (ty < 0 || ty >= n) continue;
							var wx = ((tx % n) + n) % n;
							html += '<img alt="" onerror="this.style.visibility=\'hidden\'" style="left:' + tx * TILE + "px;top:" + ty * TILE + 'px" src="https://' + "abcd"[(wx + ty) % 4] + ".basemaps.cartocdn.com/" + (dark ? "dark_all" : "light_all") + "/" + z + "/" + wx + "/" + ty + '.png" />';
						}
					tilesEl.innerHTML = html;
				}
				tilesEl.style.transform = "translate(" + -ox + "px," + -oy + "px)";
				var pts = p && p.fixes.length ? [{ lat: p.from_lat, lon: p.from_lon }].concat(p.fixes, [{ lat: p.to_lat, lon: p.to_lon }]) : [];
				line.setAttribute("points", pts.filter(function (f) { return f.lat != null; }).map(function (f) { var q = project(f.lat, f.lon, z); return (q.x - ox).toFixed(1) + "," + (q.y - oy).toFixed(1); }).join(" "));
				planeEl.style.transform = "translate(-50%,-50%) rotate(" + s.trk + "deg)";
				// Other aircraft (from the sim: AI traffic, including what SayIntentions puts in).
				var tr = cfg.traffic === false ? [] : Helper.state.traffic || [];
				var tk = JSON.stringify(tr) + z + Math.round(ox) + Math.round(oy);
				if (tk !== trafficKey) {
					trafficKey = tk;
					setHtml(trafficEl, tr.filter(function (a) { var q = project(a.lat, a.lon, z); return q.x - ox > -20 && q.x - ox < W + 20 && q.y - oy > -20 && q.y - oy < H + 20; }).slice(0, 40).map(function (a) {
						var q = project(a.lat, a.lon, z), dAlt = a.alt - s.alt;
						var lbl = a.ground ? "" : (Math.abs(dAlt) < 1000 ? "" : (dAlt > 0 ? "+" : "−") + Math.round(Math.abs(dAlt) / 100));
						return '<div class="fm-ac' + (a.ground ? " gnd" : Math.abs(dAlt) < 1000 ? " near" : "") + '" style="left:' + (q.x - ox).toFixed(0) + "px;top:" + (q.y - oy).toFixed(0) + 'px"><i style="transform:rotate(' + Math.round(a.hdg) + 'deg)">' + svg("plane") + "</i>" + (z >= 8 && !a.ground || z >= 11 ? "<span>" + esc(a.cs || "") + (lbl ? " " + lbl : "") + "</span>" : "") + "</div>";
					}).join(""));
				}
				var toGo = p && p.to_lat != null ? distNm(s.lat, s.lon, p.to_lat, p.to_lon) : null;
				setHtml(info, "<b>" + num(s.alt) + " ft</b> · " + num(s.gs) + " kt" + (toGo != null ? " · " + num(toGo) + " NM to " + esc(p.to) : ""));
			};
		},
	};

	/* ------------------------------------------------------------------ landing rate */
	types.landing = {
		name: "Landing rate", desc: "How soft your touchdown was", icon: "plane", group: "flight", helper: true, parts: ["sim"],
		w: 2, h: 1, minW: 1, minH: 1, maxW: 4, maxH: 2,
		build: function (ctx) {
			ctx.body.innerHTML = '<div class="ld"><b class="ld-v"></b><span class="ld-r"></span><span class="ld-s"></span></div>';
			var v = ctx.body.querySelector(".ld-v"), r = ctx.body.querySelector(".ld-r"), sub = ctx.body.querySelector(".ld-s");
			var lastAt = null;
			return function () {
				if (helperGate(ctx) === true) return;
				var l = (sim() || {}).landing;
				if (!l) {
					setHtml(v, "--<small>fpm</small>");
					setText(r, "No landing yet");
					setText(sub, "");
					return;
				}
				if (lastAt !== null && l.at !== lastAt) {
					ctx.node.classList.remove("ld-new");
					void ctx.node.offsetWidth;
					ctx.node.classList.add("ld-new");
					U.toast("Landing: " + l.fpm + " fpm · " + l.rating);
				}
				lastAt = l.at;
				setHtml(v, "−" + l.fpm + "<small>fpm</small>");
				setText(r, l.rating);
				ctx.node.dataset.rating = l.rating.toLowerCase();
				setText(sub, (l.g ? l.g.toFixed(2) + " G · " : "") + "bank " + Math.abs(l.bank) + "° · pitch " + l.pitch + "°");
			};
		},
	};

	/* ------------------------------------------------------------------ radio */
	function mhz(f) { return f ? f.toFixed(3) : "---.---"; }
	types.radio = {
		name: "Radios", desc: "COM1, COM2 and squawk, big", icon: "stream", group: "flight", helper: true, parts: ["sim"],
		w: 3, h: 1, minW: 2, minH: 1, maxW: 6, maxH: 2,
		build: function (ctx) {
			ctx.body.innerHTML = '<div class="rd"></div>';
			var box = ctx.body.querySelector(".rd"), built = false, els = {};
			return function () {
				if (simGate(ctx, box)) return (built = false);
				if (!built) {
					box.innerHTML = '<div class="rd-c"><span>COM1</span><b class="r1"></b><em class="r1s"></em></div>' + (ctx.w >= 3 ? '<div class="rd-c"><span>COM2</span><b class="r2"></b></div>' : "") + '<div class="rd-c rd-x"><span>SQUAWK</span><b class="rx"></b></div>';
					["r1", "r1s", "r2", "rx"].forEach(function (k) { els[k] = box.querySelector("." + k); });
					built = true;
				}
				var s = live();
				setText(els.r1, mhz(s.com1));
				setText(els.r1s, "STBY " + mhz(s.com1s));
				if (els.r2) setText(els.r2, mhz(s.com2));
				setText(els.rx, ("000" + (s.xpdr || 0)).slice(-4));
			};
		},
	};

	/* ------------------------------------------------------------------ flight log */
	types.flightlog = {
		name: "Flight log", desc: "Every flight, saved by itself", icon: "list", group: "flight", helper: true,
		w: 3, h: 2, minW: 2, minH: 1, maxW: 6, maxH: 6, tickMs: 60000,
		build: function (ctx) {
			ctx.body.innerHTML = '<div class="fl-head"></div><div class="fl-list"></div><div class="mix-more"></div>';
			var head = ctx.body.querySelector(".fl-head"), list = ctx.body.querySelector(".fl-list");
			U.dragScroll(list, ctx.body.querySelector(".mix-more"));
			return function () {
				if (helperGate(ctx) === true) return;
				var c = cached("flightlog", 60000, function () { return Helper.fetch("/api/flightlog", { cache: "no-store" }, 6000).then(function (r) { return r.flights || []; }); });
				var f = c.data;
				if (!f) return setHtml(list, '<div class="notice small"><span>Loading…</span></div>');
				var mins = f.reduce(function (a, x) { return a + (x.blockMin || 0); }, 0);
				setHtml(head, svg("plane") + " <b>" + f.length + "</b> flights · <b>" + hhmm(mins) + "</b> hours");
				if (!f.length) return setHtml(list, '<div class="notice small"><span>Your flights are saved here by themselves when you park at the gate.</span></div>');
				setHtml(list, f.slice(0, 50).map(function (x) {
					var d = new Date(x.date);
					return '<div class="fl-row"><span class="fl-date">' + d.getDate() + "/" + (d.getMonth() + 1) + '</span><b class="fl-rt">' + esc(x.from || "?") + "–" + esc(x.to || "?") + '</b><span class="fl-ac">' + esc((x.flight ? x.flight + " · " : "") + (x.aircraft || "")) + '</span><span class="fl-t">' + hhmm(x.blockMin || 0) + "</span>" + (x.fpm != null ? '<span class="fl-fpm r-' + esc(String(x.rating || "").toLowerCase()) + '">' + x.fpm + "</span>" : "") + "</div>";
				}).join(""));
			};
		},
	};

	/* ------------------------------------------------------------------ fuel planner */
	types.fuelplan = {
		name: "Fuel planner", desc: "Fuel at arrival vs. what you need", icon: "gauge", group: "flight", helper: true, parts: ["sim"],
		w: 2, h: 1, minW: 2, minH: 1, maxW: 4, maxH: 2,
		build: function (ctx) {
			ctx.body.innerHTML = '<div class="fp"></div>';
			var box = ctx.body.querySelector(".fp");
			return function () {
				if (simGate(ctx, box)) return;
				var s = live(), p = plan().data;
				var minKg = p ? (p.reserve || 0) + (p.altBurn || 0) : null;
				var arrive = null;
				if (p && p.to_lat != null && s.gs > 60 && s.ffKgH > 0) {
					var hours = distNm(s.lat, s.lon, p.to_lat, p.to_lon) / s.gs;
					arrive = s.fuelKg - s.ffKgH * hours;
				} else if (p && s.ground) arrive = s.fuelKg - (p.burn || 0);
				var ok = arrive == null || minKg == null ? null : arrive >= minKg;
				ctx.node.classList.toggle("fp-bad", ok === false);
				setHtml(box, '<div><span>On board</span><b>' + kgText(s.fuelKg) + '</b></div><div><span>At ' + esc(p ? p.to : "arrival") + '</span><b class="fp-arr">' + kgText(arrive) + '</b></div>' +
					(ctx.w >= 3 || ctx.h >= 2 ? '<div><span>Needed (res + altn)</span><b>' + kgText(minKg) + "</b></div>" : "") +
					'<em class="fp-note">' + (ok === null ? (s.ffKgH ? "" : "Fuel flow not available") : ok ? "✓ Enough fuel" : "⚠ Below reserve + alternate") + "</em>");
			};
		},
	};

	/* ------------------------------------------------------------------ top of descent */
	types.tod = {
		name: "Top of descent", desc: "When to start down (3° rule)", icon: "plane", group: "flight", helper: true, parts: ["sim"],
		w: 2, h: 1, minW: 2, minH: 1, maxW: 4, maxH: 2,
		build: function (ctx) {
			ctx.body.innerHTML = '<div class="tod"></div>';
			var box = ctx.body.querySelector(".tod");
			return function () {
				if (simGate(ctx, box)) return;
				var s = live(), p = plan().data;
				if (!p || p.to_lat == null) return setHtml(box, '<div class="notice small"><span>Needs your SimBrief plan</span></div>');
				var toGo = distNm(s.lat, s.lon, p.to_lat, p.to_lon);
				var need = Math.max(0, (s.alt - p.to_elev - 1500) / 1000 * 3 + 10);
				var left = toGo - need, big, small;
				ctx.node.classList.toggle("tod-now", left <= 5 && s.phase === "cruise");
				if (s.phase === "descent" || s.phase === "approach") { big = num(toGo) + "<small> NM</small>"; small = "to " + esc(p.to) + " · descending"; }
				else if (left > 0) { big = num(left) + "<small> NM</small>"; small = "to top of descent" + (s.gs > 60 ? " · " + hhmm(left / s.gs * 60) : ""); }
				else { big = "Descend now"; small = num(toGo) + " NM to " + esc(p.to); }
				setHtml(box, '<div class="big"><b class="v">' + big + '</b><span class="s">' + small + "</span></div>");
			};
		},
	};

	/* ------------------------------------------------------------------ frequencies */
	types.freqs = {
		name: "Frequencies", desc: "Tower, ground and ATIS at your airports", icon: "stream", group: "flight", helper: true,
		w: 2, h: 2, minW: 2, minH: 1, maxW: 4, maxH: 4,
		options: function () {
			return [{ key: "which", label: "Airport", type: "choice", "default": "auto", choices: [{ value: "auto", label: "Departure on the ground, arrival in the air" }, { value: "from", label: "Departure" }, { value: "to", label: "Arrival" }] }];
		},
		build: function (ctx) {
			ctx.body.innerHTML = '<div class="th">' + svg("stream") + '<span class="fq-t">Frequencies</span></div><div class="fq-list"></div><div class="mix-more"></div>';
			var t = ctx.body.querySelector(".fq-t"), list = ctx.body.querySelector(".fq-list");
			U.dragScroll(list, ctx.body.querySelector(".mix-more"));
			return function () {
				if (helperGate(ctx) === true) return;
				var p = plan().data;
				if (!p) return setHtml(list, '<div class="notice small"><span>Needs your SimBrief plan</span></div>');
				var which = (ctx.tile.cfg || {}).which || "auto", s = live();
				var icao = which === "from" ? p.from : which === "to" ? p.to : s && !s.ground ? p.to : p.from;
				setText(t, icao + " frequencies");
				var c = cached("fq:" + icao, 3600000, function () { return Helper.fetch("/api/freqs?icao=" + encodeURIComponent(icao), { cache: "no-store" }, 30000).then(function (r) { return r.freqs || []; }); });
				if (!c.data) return setHtml(list, '<div class="notice small"><span>' + (c.err ? "Couldn't get frequencies" : "Loading…") + "</span></div>");
				var order = ["ATIS", "DEL", "CLD", "GND", "TWR", "APP", "DEP", "CTR"];
				var f = c.data.slice().sort(function (a, b) { return (order.indexOf(a.type) + 99) % 108 - (order.indexOf(b.type) + 99) % 108; });
				setHtml(list, f.length ? f.map(function (x) {
					return '<div class="fq-row"><b class="fq-type">' + esc(x.type) + '</b><span class="fq-desc">' + esc(x.desc) + '</span><b class="fq-mhz">' + esc((+x.mhz).toFixed(3)) + "</b></div>";
				}).join("") : '<div class="notice small"><span>No frequencies listed for ' + esc(icao) + "</span></div>");
			};
		},
	};

	/* ------------------------------------------------------------------ sim time */
	types.simtime = {
		name: "Sim time", desc: "Local time in the sim and Zulu", icon: "clock", group: "flight", helper: true, parts: ["sim"],
		w: 2, h: 1, minW: 2, minH: 1, maxW: 4, maxH: 2, tickMs: 30000,
		build: function (ctx) {
			ctx.body.innerHTML = '<div class="st2"><div><span>Sim local</span><b class="a"></b></div><div><span>Zulu</span><b class="b"></b></div></div>';
			var a = ctx.body.querySelector(".a"), b = ctx.body.querySelector(".b");
			return function () {
				var s = live();
				if (s) {
					setText(a, secToClock(s.local));
					setText(b, secToClock(s.zulu) + "Z");
				} else {
					var n = new Date();
					setText(a, "--:--");
					setText(b, two(n.getUTCHours()) + ":" + two(n.getUTCMinutes()) + "Z");
				}
			};
		},
	};

	/* ------------------------------------------------------------------ camera, pause, sim rate */
	types.simcontrols = {
		name: "Sim controls", desc: "Camera views, pause and sim rate", icon: "camera", group: "flight", helper: true, parts: ["sim"],
		w: 3, h: 1, minW: 2, minH: 1, maxW: 6, maxH: 2,
		build: function (ctx) {
			ctx.body.innerHTML = '<div class="sc2"></div>';
			var box = ctx.body.querySelector(".sc2"), built = false;
			var btns = [
				["camera", 2, "Cockpit", "plane"], ["camera", 3, "Outside", "camera"], ["camera", 4, "Drone", "rocket"],
				["pause", 0, "Pause", "pause"], ["rateDown", 0, "Rate −", "back"], ["rateUp", 0, "Rate +", "next"],
			];
			return function () {
				if (simGate(ctx, box)) return (built = false);
				var s = live();
				if (!built) {
					box.innerHTML = "";
					btns.slice(0, ctx.w >= 3 || ctx.h >= 2 ? 6 : 4).forEach(function (b) {
						var e = el("button", "sc2-b", svg(b[3]) + "<span>" + b[2] + "</span>");
						e.dataset.what = b[0];
						e.dataset.v = b[1];
						e.addEventListener("click", function (ev) {
							ev.stopPropagation();
							if (App.editing) return;
							Helper.act({ action: "sim", what: b[0], value: b[1] }, true).then(function (ok) { if (!ok) U.toast("MSFS didn't take that"); });
						});
						box.appendChild(e);
					});
					built = true;
				}
				box.querySelectorAll(".sc2-b").forEach(function (e) {
					var on = e.dataset.what === "camera" ? +e.dataset.v === s.camera : e.dataset.what === "pause" ? s.paused : false;
					e.classList.toggle("on", !!on);
					if (e.dataset.what === "rateUp") setHtml(e, svg("next") + "<span>Rate " + (s.rate >= 1 ? "×" + s.rate : "×" + (+s.rate).toFixed(2)) + "</span>");
				});
			};
		},
	};

	/* ------------------------------------------------------------------ SayIntentions.AI */
	var si = { data: null, at: 0, busy: false };
	function siState() {
		if (!si.busy && Helper.online && Date.now() - si.at > 4000) {
			si.busy = true;
			Helper.fetch("/api/si", { cache: "no-store" }, 15000).then(function (r) { si.data = r; }, function () {}).then(function () {
				si.at = Date.now();
				si.busy = false;
				App.dirty();
			});
		}
		return si.data;
	}

	function siOrder(list) {
		var numeric = list.every(function (x) { return /^\d+$/.test(x.id); });
		return list.slice().sort(function (a, b) { return numeric ? a.id - b.id : a.time < b.time ? -1 : a.time > b.time ? 1 : 0; });
	}

	types.sayintentions = {
		name: "SayIntentions", desc: "ATC station, frequency and what was said", icon: "chat", group: "flight", helper: true,
		w: 3, h: 2, minW: 2, minH: 1, maxW: 6, maxH: 6, tickMs: 4000,
		build: function (ctx) {
			ctx.body.innerHTML = '<div class="si-top"><b class="si-st"></b><span class="si-fq"></span></div><div class="si-tags"></div><div class="si-last"></div><div class="si-chat"></div><div class="si-off notice small"></div>';
			var st = ctx.body.querySelector(".si-st"), fq = ctx.body.querySelector(".si-fq"), tags = ctx.body.querySelector(".si-tags"), chat = ctx.body.querySelector(".si-chat"), off = ctx.body.querySelector(".si-off");
			U.dragScroll(chat);
			var shown = "";
			return function () {
				if (helperGate(ctx) === true) return;
				var d = siState();
				var ready = d && d.key;
				ctx.node.classList.toggle("si-ready", !!ready);
				if (!ready) {
					setHtml(off, !d ? "<span>Connecting…</span>" : !d.running ? "<b>SayIntentions isn't running</b><span>Start SayIntentions and a flight, and the radio calls show up here</span>" : "<b>No API key found</b><span>Open Control Hub → Connections → SayIntentions (Pilot Portal → API Key)</span>");
					return;
				}
				var list = siOrder(d.comms || []);
				var last = list.filter(function (x) { return x.freq && !/^(1|true)$/i.test(x.acars) && !/acars|cpdlc|telex/i.test(x.channel); }).pop();
				setText(st, last ? last.station || "ATC" : (d.callsign || "SayIntentions"));
				setText(fq, last && last.freq ? (+last.freq ? (+last.freq).toFixed(3) : last.freq) : d.airport || "");
				var t = [];
				if (d.callsign) t.push(d.callsign);
				if (d.from || d.to) t.push((d.from || "?") + " → " + (d.to || "?"));
				if (d.runway) t.push("RWY " + d.runway);
				if (d.gate) t.push("Gate " + d.gate);
				if (/^(1|true)$/i.test(d.clearedTakeoff)) t.push("Cleared for takeoff");
				if (/^(1|true)$/i.test(d.clearedLanding)) t.push("Cleared to land");
				setHtml(tags, t.map(function (x) { return "<span>" + esc(x) + "</span>"; }).join(""));
				var lastIn = list.filter(function (x) { return x.in; }).pop();
				setText(ctx.body.querySelector(".si-last"), lastIn ? lastIn.in : "No radio calls yet");
				var max = ctx.h * 4;
				var items = list.slice(-max);
				var key = items.map(function (x) { return x.id + x.in.length + x.out.length; }).join("|");
				if (key === shown) return;
				shown = key;
				var html = "";
				items.forEach(function (x) {
					var time = (x.time.match(/(\d{2}:\d{2})/) || [])[1] || "";
					if (x.out) html += '<div class="si-msg me"><span>' + esc(x.out) + "</span><em>You" + (time ? " · " + time : "") + "</em></div>";
					if (x.in) html += '<div class="si-msg atc"><span>' + esc(x.in) + "</span><em>" + esc(x.station || "ATC") + (time ? " · " + time : "") + "</em></div>";
				});
				chat.innerHTML = html || '<div class="notice small"><span>No radio calls yet this flight</span></div>';
				chat.scrollTop = chat.scrollHeight;
				requestAnimationFrame(function () { chat.scrollTop = chat.scrollHeight; });
			};
		},
	};

	/* ------------------------------------------------------------------ SayIntentions: radio and cabin call buttons */
	var ATC_CALLS = [
		["IFR clearance", "{callsign}, request IFR clearance to {to}"],
		["Pushback", "{callsign}, request pushback and start up"],
		["Ready to taxi", "{callsign}, ready to taxi"],
		["Ready for departure", "{callsign}, holding short runway {runway}, ready for departure"],
		["Request higher", "{callsign}, request higher"],
		["Request descent", "{callsign}, request descent"],
		["Say again", "{callsign}, say again"],
		["Wilco", "Wilco, {callsign}"],
	];
	var CABIN_CALLS = [
		["Doors armed", "Cabin crew, arm doors and cross-check"],
		["Seats for takeoff", "Cabin crew, seats for takeoff"],
		["Seatbelts off", "Ladies and gentlemen, the captain has turned off the seatbelt sign"],
		["Prepare for landing", "Cabin crew, prepare the cabin for landing"],
		["Seats for landing", "Cabin crew, seats for landing"],
		["Doors disarmed", "Cabin crew, disarm doors and cross-check"],
	];

	function fillCall(text) {
		var d = siState() || {}, p = plan().data || {};
		var vals = {
			callsign: d.callsign || p.flight || "",
			from: d.from || p.from || "", to: d.to || p.to || "",
			runway: d.depRwy || d.runway || p.fromRwy || "", gate: d.gate || "",
			sid: d.sid || "", star: d.star || "",
		};
		return text.replace(/\{(\w+)\}/g, function (m, k) { return vals[k] != null ? vals[k] : ""; }).replace(/\s+,/g, ",").replace(/\s{2,}/g, " ").trim();
	}

	function callsTile(kind) {
		var cabin = kind === "cabin";
		return {
			name: cabin ? "Cabin calls" : "ATC calls", desc: cabin ? "Talk to the cabin through SayIntentions" : "Tap to make radio calls in SayIntentions",
			icon: cabin ? "chat" : "stream", group: "flight", helper: true,
			w: 3, h: 2, minW: 1, minH: 1, maxW: 6, maxH: 6,
			edit: function (t, back) { editCalls(t, back, cabin); },
			build: function (ctx) {
				var cfg = ctx.tile.cfg || {};
				var calls = cfg.calls || (cabin ? CABIN_CALLS : ATC_CALLS);
				var channel = cfg.channel || (cabin ? "INTERCOM1" : "COM1");
				ctx.body.innerHTML = '<div class="sic"></div>';
				var box = ctx.body.querySelector(".sic");
				calls.forEach(function (c) {
					var b = el("button", "sic-b", "<b></b>");
					b.querySelector("b").textContent = c[0];
					b.addEventListener("click", function (e) {
						e.stopPropagation();
						if (App.editing) return;
						var d = siState();
						if (!d || !d.key) return U.toast("SayIntentions isn't connected yet");
						var msg = fillCall(c[1]);
						b.classList.add("sending");
						Helper.act({ action: "siSay", channel: channel, message: msg }, true).then(function (ok) {
							b.classList.remove("sending");
							U.toast(ok ? "Said: " + msg : "SayIntentions didn't take that");
							si.at = 0;
						});
					});
					box.appendChild(b);
				});
				return function () { siState(); ctx.node.classList.toggle("si-wait", !(si.data && si.data.key)); };
			},
		};
	}
	types.siatc = callsTile("atc");
	types.sicabin = callsTile("cabin");

	function editCalls(t, back, cabin) {
		t.cfg = t.cfg || {};
		var work = { channel: t.cfg.channel || (cabin ? "INTERCOM1" : "COM1"), calls: (t.cfg.calls || (cabin ? CABIN_CALLS : ATC_CALLS)).map(function (c) { return c.slice(); }) };
		var wrap = el("div", "opts");
		Editor.modal(cabin ? "Cabin calls" : "ATC calls", wrap, back);
		function draw() {
			wrap.innerHTML = "";
			var s0 = el("div", "opt", "<h4>Send on</h4>");
			var ch = el("div", "chips");
			(cabin ? [["INTERCOM1", "Intercom 1"], ["INTERCOM2", "Intercom 2"], ["INTERCOM3", "Intercom 3"]] : [["COM1", "COM1"], ["COM2", "COM2"]]).forEach(function (o) {
				var c = el("button", "chip" + (work.channel === o[0] ? " on" : ""), o[1]);
				c.addEventListener("click", function () { work.channel = o[0]; draw(); });
				ch.appendChild(c);
			});
			s0.appendChild(ch);
			wrap.appendChild(s0);
			var s1 = el("div", "opt", "<h4>Buttons</h4>");
			work.calls.forEach(function (c, i) {
				var r = el("div", "hid-row sic-row", "<span><b></b><em></em></span>");
				r.querySelector("b").textContent = c[0];
				r.querySelector("em").textContent = c[1];
				var up = el("button", "pill", svg("up"));
				up.disabled = i === 0;
				up.addEventListener("click", function () { work.calls.splice(i - 1, 0, work.calls.splice(i, 1)[0]); draw(); });
				var del = el("button", "pill danger", "Remove");
				del.addEventListener("click", function () { work.calls.splice(i, 1); draw(); });
				r.appendChild(up);
				r.appendChild(del);
				s1.appendChild(r);
			});
			wrap.appendChild(s1);
			var s2 = el("div", "opt", "<h4>Add a button</h4>");
			var lab = el("input", "search"); lab.placeholder = "Button text, e.g. Request direct"; lab.maxLength = 24;
			var msg = el("input", "search"); msg.placeholder = "What to say, e.g. {callsign}, request direct TOBIS"; msg.maxLength = 200;
			var f = el("div", "pk-fields"); f.appendChild(lab); f.appendChild(msg);
			s2.appendChild(f);
			s2.appendChild(el("p", "hint", "You can use {callsign}, {from}, {to}, {runway}, {gate}, {sid} and {star}; they're filled in from SayIntentions and SimBrief."));
			var add = el("button", "pill", "Add");
			add.addEventListener("click", function () {
				if (!lab.value.trim() || !msg.value.trim()) return U.toast("Fill in both");
				work.calls.push([lab.value.trim(), msg.value.trim()]);
				draw();
			});
			s2.appendChild(add);
			wrap.appendChild(s2);
			var reset = el("button", "pill", "Back to the standard buttons");
			reset.addEventListener("click", function () { work.calls = (cabin ? CABIN_CALLS : ATC_CALLS).map(function (c) { return c.slice(); }); draw(); });
			wrap.appendChild(reset);
			var save = el("button", "pill accent save-btn", "Save");
			save.addEventListener("click", function () {
				t.cfg = { channel: work.channel, calls: work.calls };
				Editor.saveTile(t, back);
			});
			wrap.appendChild(save);
		}
		draw();
	}

	/* ------------------------------------------------------------------ SayIntentions: ACARS messages */
	types.siacars = {
		name: "ACARS", desc: "ACARS / CPDLC messages from SayIntentions", icon: "list", group: "flight", helper: true,
		w: 3, h: 2, minW: 2, minH: 1, maxW: 6, maxH: 6, tickMs: 4000,
		build: function (ctx) {
			ctx.body.innerHTML = '<div class="th">' + svg("list") + '<span>ACARS</span></div><div class="ac-list"></div>';
			var list = ctx.body.querySelector(".ac-list");
			U.dragScroll(list);
			var shown = "";
			return function () {
				if (helperGate(ctx) === true) return;
				var d = siState();
				if (!d || !d.key) return setHtml(list, '<div class="notice small"><span>' + (d && !d.running ? "SayIntentions isn't running" : "Connecting…") + "</span></div>");
				var msgs = siOrder(d.comms || []).filter(function (x) { return /^(1|true)$/i.test(x.acars) || /acars|cpdlc|telex/i.test(x.channel); }).reverse();
				var key = msgs.map(function (x) { return x.id; }).join(",");
				if (key === shown) return;
				shown = key;
				setHtml(list, msgs.length ? msgs.slice(0, 20).map(function (x) {
					var time = (x.time.match(/(\d{2}:\d{2})/) || [])[1] || "";
					return '<div class="ac-msg"><em>' + esc((x.station || "ACARS") + (time ? " · " + time : "")) + "</em><pre>" + esc(x.in || x.out) + "</pre></div>";
				}).join("") : '<div class="notice small"><span>No ACARS messages yet</span></div>');
			};
		},
	};

	/* ------------------------------------------------------------------ SayIntentions: flight info + gate */
	types.siinfo = {
		name: "ATC flight info", desc: "Runways, SID/STAR, taxi route and gate from SayIntentions", icon: "plane", group: "flight", helper: true,
		w: 3, h: 2, minW: 2, minH: 1, maxW: 6, maxH: 4, tickMs: 4000,
		build: function (ctx) {
			ctx.body.innerHTML = '<div class="sii"></div>';
			var box = ctx.body.querySelector(".sii");
			box.addEventListener("click", function (e) {
				if (e.target.closest(".sii-gate") && !App.editing) { e.stopPropagation(); pickGate(); }
			});
			return function () {
				if (helperGate(ctx) === true) return;
				var d = siState();
				if (!d || !d.running) return setHtml(box, '<div class="notice small"><span>' + (d ? "SayIntentions isn't running" : "Connecting…") + "</span></div>");
				var rows = [
					["Callsign", d.callsign], ["Route", (d.from || "?") + " → " + (d.to || "?")],
					["Departure", [d.depRwy && "RWY " + d.depRwy, d.sid].filter(Boolean).join(" · ")],
					["Arrival", [d.arrRwy && "RWY " + d.arrRwy, d.star].filter(Boolean).join(" · ")],
					["Gate", d.gate], ["Taxi", d.taxi],
				].filter(function (r) { return r[1]; });
				var flags = [];
				if (/^(1|true)$/i.test(d.clearedTakeoff)) flags.push('<span class="sii-ok">Cleared for takeoff</span>');
				if (/^(1|true)$/i.test(d.clearedLanding)) flags.push('<span class="sii-ok">Cleared to land</span>');
				setHtml(box, (flags.length ? '<div class="sii-flags">' + flags.join("") + "</div>" : "") +
					'<div class="sii-grid">' + rows.slice(0, ctx.h * 3).map(function (r) { return "<span>" + esc(r[0]) + "</span><b>" + esc(r[1]) + "</b>"; }).join("") + "</div>" +
					(ctx.h >= 2 ? '<button class="pill sii-gate">Choose gate</button>' : ""));
			};
		},
	};

	/* Lists from SayIntentions whose exact layout isn't documented: find the items that look like what we need. */
	function findItems(obj, test) {
		var out = [];
		(function walk(o, depth) {
			if (!o || depth > 5) return;
			if (Array.isArray(o)) return o.forEach(function (x) { if (x && typeof x === "object" && test(x)) out.push(x); else walk(x, depth + 1); });
			if (typeof o === "object") Object.keys(o).forEach(function (k) {
				var v = o[k];
				if (v && typeof v === "object" && !Array.isArray(v) && test(v)) { v.__key = v.__key || k; out.push(v); }
				else walk(v, depth + 1);
			});
		})(obj, 0);
		return out;
	}
	function pick(o, names) {
		for (var i = 0; i < names.length; i++) if (o[names[i]] != null && o[names[i]] !== "") return o[names[i]];
		return null;
	}

	function pickGate() {
		var wrap = el("div", "opts");
		Editor.modal("Choose your gate", wrap);
		wrap.innerHTML = '<p class="hint">Asking SayIntentions…</p>';
		Helper.fetch("/api/si/parking", { cache: "no-store" }, 20000).then(function (r) {
			var items = findItems(r.data, function (x) { return pick(x, ["name", "gate", "parking", "ident", "id"]) != null && (x.lat != null || x.latitude != null || x.type != null || x.name != null); });
			var d = siState() || {};
			wrap.innerHTML = "";
			var search = el("input", "search");
			search.placeholder = "Search, e.g. B7";
			wrap.appendChild(search);
			var list = el("div", "chips gate-chips");
			wrap.appendChild(list);
			function fill() {
				var q = search.value.trim().toLowerCase();
				list.innerHTML = "";
				items.forEach(function (x) {
					var name = String(pick(x, ["name", "gate", "parking", "ident", "id"]));
					if (q && name.toLowerCase().indexOf(q) < 0) return;
					var c = el("button", "chip" + (name === d.gate ? " on" : ""), esc(name));
					c.addEventListener("click", function () {
						Helper.act({ action: "siGate", gate: name, airport: d.to || d.airport || "" }).then(function (ok) {
							U.toast(ok ? "Gate " + name + " requested" : "SayIntentions didn't take that");
							if (ok) Editor.closeModal();
						});
					});
					list.appendChild(c);
				});
				if (!list.children.length) list.appendChild(el("p", "hint", items.length ? "No match." : "SayIntentions didn't send a gate list yet (it usually comes once you have a flight and destination)."));
			}
			search.addEventListener("input", fill);
			fill();
		}, function () { wrap.innerHTML = '<p class="hint">Couldn\'t reach SayIntentions.</p>'; });
	}

	/* ------------------------------------------------------------------ SayIntentions: frequencies, tap to tune */
	types.sifreqs = {
		name: "ATC frequencies", desc: "SayIntentions frequencies · tap to tune", icon: "stream", group: "flight", helper: true,
		w: 3, h: 2, minW: 2, minH: 1, maxW: 6, maxH: 6, tickMs: 20000,
		options: function () {
			return [{ key: "into", label: "A tap puts it in", type: "choice", "default": "standby", choices: [{ value: "standby", label: "COM1 standby" }, { value: "active", label: "COM1 active" }, { value: "standby2", label: "COM2 standby" }] }];
		},
		build: function (ctx) {
			var cfg = ctx.tile.cfg || {};
			ctx.body.innerHTML = '<div class="th">' + svg("stream") + '<span>ATC frequencies</span></div><div class="fq-list"></div>';
			var list = ctx.body.querySelector(".fq-list");
			U.dragScroll(list);
			var data = null, at = 0, busy = false;
			list.addEventListener("click", function (e) {
				var r = e.target.closest("[data-f]");
				if (!r || App.editing) return;
				e.stopPropagation();
				var into = cfg.into || "standby";
				Helper.act({ action: "siFreq", freq: r.dataset.f, com: into === "standby2" ? 2 : 1, mode: into === "active" ? "active" : "standby" }, true).then(function (ok) {
					U.toast(ok ? r.dataset.f + " set" : "Couldn't set the frequency");
				});
			});
			return function () {
				if (helperGate(ctx) === true) return;
				if (!busy && Date.now() - at > 20000) {
					busy = true;
					Helper.fetch("/api/si/freqs", { cache: "no-store" }, 20000).then(function (r) { data = r; }, function () {}).then(function () { at = Date.now(); busy = false; App.dirty(); });
				}
				if (!data) return setHtml(list, '<div class="notice small"><span>Loading…</span></div>');
				var items = findItems(data.data, function (x) { var f = parseFloat(pick(x, ["frequency", "freq", "mhz", "frequency_mhz"])); return f >= 108 && f <= 137; });
				setHtml(list, items.length ? items.slice(0, 40).map(function (x) {
					var f = parseFloat(pick(x, ["frequency", "freq", "mhz", "frequency_mhz"])).toFixed(3);
					var name = pick(x, ["name", "station_name", "station", "facility", "description", "type", "callsign", "__key"]) || "";
					return '<button class="fq-row fq-tap" data-f="' + f + '"><span class="fq-desc">' + esc(name) + '</span><b class="fq-mhz">' + f + "</b></button>";
				}).join("") : '<div class="notice small"><span>' + (data.ok ? "No frequencies from SayIntentions right now" : "SayIntentions isn't connected") + "</span></div>");
			};
		},
	};

	/* ------------------------------------------------------------------ flight phase pages */
	var PHASE_GROUP = { "taxi-out": "taxi", "taxi-in": "taxi", takeoff: "takeoff", climb: "takeoff", cruise: "cruise", descent: "approach", approach: "approach", landing: "approach", parked: "parked" };
	var lastGroup = null;
	function phaseRules() {
		return Editor.layout().pages.some(function (p) { return p.auto && p.auto.phase; });
	}
	var lastAtc = null;
	/* The first look after the panel starts (or iCUE reloads it) only notes the phase and clearances, so the
	   page doesn't jump just because a flight was already going on. */
	function checkPhase() {
		if (!phaseRules() || App.editing) return;
		// SayIntentions clearances (cleared for takeoff / cleared to land) win over the flight phase.
		var pages = Editor.layout().pages;
		var wantsAtc = pages.some(function (p) { return p.auto && /^atc-/.test(p.auto.phase || ""); });
		if (wantsAtc && siState()) {
			var d = siState();
			var atc = /^(1|true)$/i.test(d.clearedLanding) ? "atc-landing" : /^(1|true)$/i.test(d.clearedTakeoff) ? "atc-takeoff" : "";
			if (lastAtc === null) lastAtc = atc;
			if (atc !== lastAtc) {
				lastAtc = atc;
				for (var j = 0; atc && j < pages.length; j++) {
					if (pages[j].auto && pages[j].auto.phase === atc && Editor.layout().current !== j) {
						if (typeof Look !== "undefined") Look.wake();
						return Editor.goPage(j, "auto");
					}
				}
			}
		}
		var s = live();
		if (!s) return;
		var g = PHASE_GROUP[s.phase] || "";
		if (lastGroup === null) lastGroup = g;
		if (g === lastGroup) return;
		lastGroup = g;
		for (var i = 0; i < pages.length; i++) {
			if (pages[i].auto && pages[i].auto.phase === g) {
				if (Editor.layout().current !== i) {
					if (typeof Look !== "undefined") Look.wake();
					Editor.goPage(i, "auto");
				}
				return;
			}
		}
	}

	return {
		check: checkPhase,
		phaseRules: phaseRules,
		plan: plan,
		reloadPlan: function () { refresh("sb:" + simbriefUser()); return plan(); },
		distNm: distNm,
		project: project,
		simGate: simGate,
		PHASE_CHOICES: [["taxi", "Taxi"], ["takeoff", "Takeoff and climb"], ["cruise", "Cruise"], ["approach", "Descent and approach"], ["parked", "Parked at the gate"], ["atc-takeoff", "Cleared for takeoff (SayIntentions)"], ["atc-landing", "Cleared to land (SayIntentions)"]],
		_decodeMetar: decodeMetar,
		_parsePlan: parsePlan,
	};
})();
