/* FlightLine — Find a flight: real airline routes (flights that have actually been flown) that fit your plane and your time.
   Control Hub Service keeps the route list (/api/fl/find); "Send to SimBrief" opens SimBrief with the flight filled in. */
"use strict";

const Finder = (function () {
	// ICAO type, name, cruise speed (kt), shortest runway (ft), minutes for taxi/climb/descent, SimBrief type
	const PLANES = [
		["A20N", "Airbus A320neo", 450, 6000, 25], ["A320", "Airbus A320", 450, 6500, 25], ["A21N", "Airbus A321neo", 450, 7000, 25], ["A319", "Airbus A319", 450, 6000, 25],
		["B738", "Boeing 737-800", 455, 7000, 25], ["B38M", "Boeing 737 MAX 8", 455, 6800, 25], ["B739", "Boeing 737-900", 455, 7500, 25],
		["B789", "Boeing 787-9", 490, 8500, 30], ["B78X", "Boeing 787-10", 490, 9000, 30], ["B77W", "Boeing 777-300ER", 490, 9500, 30], ["B748", "Boeing 747-8", 490, 10000, 30],
		["A359", "Airbus A350-900", 488, 8500, 30], ["A339", "Airbus A330-900neo", 470, 8000, 30], ["A346", "Airbus A340-600", 480, 10000, 30], ["A388", "Airbus A380", 490, 10000, 30],
		["E175", "Embraer E175", 430, 5500, 20], ["E190", "Embraer E190", 440, 6000, 20], ["CRJ7", "Bombardier CRJ-700", 430, 5500, 20],
		["AT76", "ATR 72-600", 275, 4000, 15], ["DH8D", "Dash 8-400", 330, 4500, 15], ["B350", "King Air 350", 300, 3500, 12],
		["TBM9", "Daher TBM 930", 320, 3000, 12], ["PC12", "Pilatus PC-12", 270, 3000, 12], ["C208", "Cessna 208 Caravan", 170, 2500, 10], ["C172", "Cessna 172", 115, 2000, 10],
	];
	const REGIONS = [["EU", "Europe"], ["ME", "Middle East"], ["NAF", "North Africa"], ["AS", "Asia"], ["NA", "North America"], ["SA", "South America"], ["AF", "Africa"], ["OC", "Oceania"]];
	const TIMES = [[30, 60, "30 min – 1 h"], [60, 120, "1 – 2 h"], [120, 240, "2 – 4 h"], [240, 480, "4 – 8 h"], [480, 900, "8 h +"]];
	const FLAG = cc => /^[A-Z]{2}$/.test(cc || "") ? String.fromCodePoint(...[...cc].map(c => 0x1f1e6 + c.charCodeAt(0) - 65)) : "";

	let box = null, opts = null, result = null, status = null, map = null, busy = false, scen = null;

	function load() {
		try { opts = JSON.parse(localStorage.getItem("flFinder") || "null"); } catch (e) { opts = null; }
		if (!opts) opts = { plane: guessPlane(), from: "last", fromCode: "", time: 1, newOnly: false };
		if (!Array.isArray(opts.regions)) opts.regions = ["EU", "ME"];
		if (!opts.scenery) opts.scenery = "any";
		if (!opts.size) opts.size = "big";
	}
	function keep() { try { localStorage.setItem("flFinder", JSON.stringify(opts)); } catch (e) {} }

	/* The plane you flew last, if it's one of the list. */
	function guessPlane() {
		const t = String((flights[0] || {}).aircraft || "").toLowerCase();
		const tests = [[/a320\s?neo|a20n/, "A20N"], [/a321/, "A21N"], [/a319/, "A319"], [/a320/, "A320"], [/737.?max|b38m/, "B38M"], [/737/, "B738"], [/787-10/, "B78X"], [/787/, "B789"],
			[/777/, "B77W"], [/747/, "B748"], [/a350/, "A359"], [/a330/, "A339"], [/a380/, "A388"], [/e175|e170/, "E175"], [/e19/, "E190"], [/crj/, "CRJ7"], [/atr/, "AT76"],
			[/dash|q400|dh8/, "DH8D"], [/king air/, "B350"], [/tbm/, "TBM9"], [/pc-?12/, "PC12"], [/caravan|208/, "C208"], [/172|skyhawk/, "C172"]];
		for (const [re, code] of tests) if (re.test(t)) return code;
		return "A20N";
	}
	function plane() { return PLANES.find(p => p[0] === opts.plane) || PLANES[0]; }

	/* ------------------------------------------------------------------ the page */
	async function render(main) {
		box = main;
		load();
		map = null;
		draw();
		try { status = await get("/api/fl/routes"); } catch (e) { status = null; }
		if (view !== "finder") return;
		drawStatus();
		loadScenery(false);
		if (status && status.have && !result) search(false);
		else if (status && status.building) waitForRoutes();
	}

	function draw() {
		const p = plane();
		let h = '<div class="head"><div class="grow"><h1>Find a flight</h1><p>Real airline routes: flights that have actually been flown, that fit your plane and your time.</p></div></div>';
		const chip = (on, attr, text) => '<button class="chip' + (on ? " on" : "") + '" ' + attr + ">" + text + "</button>";
		h += '<div class="panel fbar">' +
			'<div class="fbar-main">' +
			'<label class="fb fb-plane"><em>Plane</em><select id="fPlane">' + PLANES.map(x => '<option value="' + x[0] + '"' + (x[0] === p[0] ? " selected" : "") + ">" + esc(x[1]) + "</option>").join("") + "</select></label>" +
			'<div class="fb"><em>From</em><div class="fb-row"><div class="seg" id="fFromTabs">' +
			[["last", "Last landing"], ["here", "Where I am"], ["code", "Airport"], ["any", "Anywhere"]].map(x => '<button data-f="' + x[0] + '"' + (opts.from === x[0] ? ' class="on"' : "") + ">" + x[1] + "</button>").join("") +
			'</div><input class="search code" id="fCode" maxlength="4" placeholder="EKCH" value="' + esc(opts.fromCode || "") + '"' + (opts.from === "code" ? "" : " hidden") + "></div></div>" +
			'<div class="fb"><em>Flight time</em><div class="seg" id="fTime">' + TIMES.map((t, i) => chip(i === opts.time, 'data-i="' + i + '"', t[2].replace(" – ", "–"))).join("") + "</div></div>" +
			'<div class="fb-go"><button class="btn accent big" id="fGo">Find flights</button><button class="btn big" id="fSurprise" title="One random flight">Surprise me</button></div>' +
			"</div>" +
			'<div class="fbar-filters">' +
			'<div class="fl"><em>Where to</em><div class="chips" id="fReg">' + chip(!opts.regions.length, 'data-r=""', "Anywhere") +
			REGIONS.map(r => chip(opts.regions.indexOf(r[0]) >= 0, 'data-r="' + r[0] + '"', r[1])).join("") + "</div></div>" +
			'<div class="fl"><em>Airports</em><div class="chips" id="fSize">' + [["big", "Big only"], ["medium", "Big and medium"], ["all", "All"]].map(x => chip(opts.size === x[0], 'data-z="' + x[0] + '"', x[1])).join("") + "</div></div>" +
			'<div class="fl"><em>Scenery</em><div class="chips" id="fScen">' + [["any", "Any"], ["prefer", "Mine first"], ["only", "Only mine"]].map(x => chip(opts.scenery === x[0], 'data-s="' + x[0] + '"', x[1])).join("") + "</div></div>" +
			'<label class="chk fl-new"><input type="checkbox" id="fNew"' + (opts.newOnly ? " checked" : "") + "> New airports only</label>" +
			"</div>" +
			'<div class="fbar-notes muted small"><span id="fFromNote"></span><span id="fScenNote"></span></div>' +
			"</div>";
		h += '<div id="fStatus"></div><div id="fOut"></div><div id="fDeals"></div>';
		box.innerHTML = h;
		const $$ = s => box.querySelector(s);
		$$("#fPlane").addEventListener("change", e => { opts.plane = e.target.value; keep(); });
		box.querySelectorAll("#fFromTabs button").forEach(b => b.addEventListener("click", () => {
			opts.from = b.dataset.f; keep();
			box.querySelectorAll("#fFromTabs button").forEach(x => x.classList.toggle("on", x === b));
			$$("#fCode").hidden = opts.from !== "code";
			if (opts.from === "code") $$("#fCode").focus();
			fromNote();
		}));
		$$("#fCode").addEventListener("input", e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); opts.fromCode = e.target.value; keep(); });
		$$("#fCode").addEventListener("keydown", e => { if (e.key === "Enter") search(false); });
		box.querySelectorAll("#fTime .chip").forEach(b => b.addEventListener("click", () => {
			opts.time = +b.dataset.i; keep();
			box.querySelectorAll("#fTime .chip").forEach(x => x.classList.toggle("on", x === b));
		}));
		$$("#fNew").addEventListener("change", e => { opts.newOnly = e.target.checked; keep(); });
		box.querySelectorAll("#fReg .chip").forEach(b => b.addEventListener("click", () => {
			const r = b.dataset.r;
			if (!r) opts.regions = [];
			else if (opts.regions.indexOf(r) >= 0) opts.regions.splice(opts.regions.indexOf(r), 1);
			else opts.regions.push(r);
			keep();
			box.querySelectorAll("#fReg .chip").forEach(x => x.classList.toggle("on", x.dataset.r ? opts.regions.indexOf(x.dataset.r) >= 0 : !opts.regions.length));
			loadScenery(false);
		}));
		box.querySelectorAll("#fSize .chip").forEach(b => b.addEventListener("click", () => {
			opts.size = b.dataset.z; keep();
			box.querySelectorAll("#fSize .chip").forEach(x => x.classList.toggle("on", x === b));
		}));
		box.querySelectorAll("#fScen .chip").forEach(b => b.addEventListener("click", () => {
			opts.scenery = b.dataset.s; keep();
			box.querySelectorAll("#fScen .chip").forEach(x => x.classList.toggle("on", x === b));
		}));
		$$("#fGo").addEventListener("click", () => search(false));
		$$("#fSurprise").addEventListener("click", () => search(true));
		fromNote();
		if (result) drawResult();
		if (scen) drawScenery();
	}

	/* ------------------------------------------------------------------ your scenery and deals */
	async function loadScenery(rescan) {
		try { scen = await get("/api/fl/scenery?regions=" + opts.regions.join(",") + (rescan ? "&rescan=1" : "")); } catch (e) { scen = null; }
		if (view === "finder") drawScenery();
	}

	function money(v, cur) {
		const n = Number(v) || 0;
		try { return cur ? n.toLocaleString("en-GB", { style: "currency", currency: cur }) : n.toFixed(2); } catch (e) { return n.toFixed(2) + " " + cur; }
	}

	function drawScenery() {
		const note = box && box.querySelector("#fScenNote"), d = box && box.querySelector("#fDeals");
		if (!note || !d || !scen) return;
		note.innerHTML = esc(scen.note || "Looking through your Community folder…") + ' · <a href="#" id="fRescan">Look again</a>';
		note.querySelector("#fRescan").addEventListener("click", e => { e.preventDefault(); note.textContent = "Looking…"; loadScenery(true); setTimeout(() => loadScenery(false), 4000); });
		const deals = scen.deals || [];
		if (!deals.length) { d.innerHTML = scen.dealsNote ? '<p class="muted small deals-note">Scenery deals: ' + esc(scen.dealsNote) + "</p>" : ""; return; }
		d.innerHTML = '<div class="panel deals"><h2>Airport scenery on sale now</h2><div class="deal-list">' + deals.map(x =>
			'<a class="deal" href="#" data-url="' + esc(x.url) + '"><span class="fc-code">' + esc(x.icao) + '</span><div class="fc-name"><b>' + esc(x.title) + '</b><span class="muted">' +
			esc(x.store) + (x.name ? " · " + FLAG(x.country) + " " + esc(x.city || x.name) : "") + (x.visited ? " · you've flown there" : "") + (x.msfs2024 ? "" : " · MSFS 2020") + "</span></div>" +
			'<div class="price"><b>' + money(x.price, x.currency) + '</b><s class="muted">' + money(x.was, x.currency) + '</s><span class="tag sale">−' + x.pct + "%</span></div></a>").join("") +
			'</div><p class="muted small deals-note">' + esc(scen.dealsNote || "") + " · checked once a day</p></div>";
		d.querySelectorAll("[data-url]").forEach(a => a.addEventListener("click", e => { e.preventDefault(); openLink(a.dataset.url); }));
	}

	function openLink(url) {
		fetch("/api/action", { method: "POST", headers: { "Content-Type": "application/json", "X-Control-Panel": "1" }, body: JSON.stringify({ action: "openUrl", url: url }) })
			.then(r => r.json()).then(r => { if (!r || !r.ok) window.open(url, "_blank"); }).catch(() => window.open(url, "_blank"));
	}

	function fromNote() {
		const n = box && box.querySelector("#fFromNote");
		if (!n) return;
		if (opts.from === "last") n.textContent = status ? (status.last ? "Your last flight landed at " + status.last : "No landing in the logbook yet: choose Airport") : "";
		else if (opts.from === "here") n.textContent = status ? (status.here ? "You're at " + status.here : "MSFS isn't connected, or you're not at an airport") : "";
		else if (opts.from === "any") n.textContent = "A random airport in your regions (with Surprise me: a random flight)";
		else n.textContent = "";
	}

	function drawStatus() {
		fromNote();
		const s = box && box.querySelector("#fStatus");
		if (!s) return;
		if (!status) s.innerHTML = '<div class="hint-box">Control Hub isn\'t answering.</div>';
		else if (status.building) s.innerHTML = '<div class="hint-box"><span class="spin"></span> Getting the real airline routes for the first time. This takes a minute or two, and then they\'re kept on your PC.</div>';
		else if (!status.have) s.innerHTML = '<div class="hint-box">The route list couldn\'t be downloaded' + (status.error ? " (" + esc(status.error) + ")" : "") + '. <button class="btn" id="fRetry">Try again</button></div>';
		else s.innerHTML = "";
		const r = s.querySelector("#fRetry");
		if (r) r.addEventListener("click", async () => { status = await get("/api/fl/routes?refresh=1"); drawStatus(); waitForRoutes(); });
	}

	function waitForRoutes() {
		const t = setInterval(async () => {
			if (view !== "finder") return clearInterval(t);
			try { status = await get("/api/fl/routes"); } catch (e) { return; }
			drawStatus();
			if (!status.building) { clearInterval(t); if (status.have) search(false); }
		}, 4000);
	}

	/* ------------------------------------------------------------------ searching */
	async function search(surprise) {
		if (busy) return;
		const p = plane(), t = TIMES[opts.time] || TIMES[1];
		const from = opts.from === "code" ? opts.fromCode : opts.from;
		const extra = "&regions=" + opts.regions.join(",") + "&scenery=" + opts.scenery + "&size=" + opts.size;
		const out = box.querySelector("#fOut");
		if (!from) { out.innerHTML = '<div class="hint-box">Type an airport code, e.g. EKCH.</div>'; return; }
		busy = true;
		out.innerHTML = '<p class="muted">Looking…</p>';
		try {
			result = await get("/api/fl/find?from=" + encodeURIComponent(from) + "&min=" + t[0] + "&max=" + t[1] + "&kt=" + p[2] + "&rwy=" + p[3] + "&ovh=" + p[4] +
				"&new=" + (opts.newOnly ? 1 : 0) + "&surprise=" + (surprise ? 1 : 0) + "&count=12" + extra);
			result.surprise = surprise;
		} catch (e) { result = { ok: false, error: "Control Hub isn't answering." }; }
		busy = false;
		if (view === "finder") drawResult();
	}

	function drawResult() {
		const out = box && box.querySelector("#fOut");
		if (!out || !result) return;
		map = null;
		if (!result.ok) {
			let h = '<div class="hint-box">' + esc(result.error || "Nothing found.") + "</div>";
			if (result.nearby && result.nearby.length) h += '<div class="panel side-panel"><h3>Airports nearby with airline routes</h3><div class="chips">' +
				result.nearby.map(a => '<button class="chip" data-icao="' + esc(a.icao) + '"><b>' + esc(a.icao) + "</b> " + esc(a.name) + ' <span class="muted">' + a.distNm + " nm</span></button>").join("") + "</div></div>";
			out.innerHTML = h;
			out.querySelectorAll("[data-icao]").forEach(b => b.addEventListener("click", () => { opts.from = "code"; opts.fromCode = b.dataset.icao; keep(); draw(); search(false); }));
			return;
		}
		const fl = result.flights || [], from = result.from;
		if (!fl.length) {
			out.innerHTML = '<div class="hint-box">No real routes from ' + esc(from.icao) + " fit that time" + (opts.newOnly ? " with only new airports" : "") + ". Try another flight time" + (opts.newOnly ? ", or allow airports you've been to" : "") + ".</div>";
			return;
		}
		let h = '<div class="find-head"><div><b>' + esc(from.icao) + "</b> " + esc(from.name) + (from.scenery ? ' <span class="tag mine" title="' + esc(from.scenery.title) + '">Your scenery</span>' : "") + ' <span class="muted">· ' + (result.surprise ? "your surprise flight" : fl.length + " of " + result.total + " routes that fit") + "</span></div>" +
			(result.surprise ? "" : '<button class="btn" id="fMore">Show others</button>') + "</div>";
		h += '<div class="map finder-map" id="fMap"></div><div class="fgrid' + (result.surprise ? " one" : "") + '">' + fl.map((f, i) => card(f, i)).join("") + "</div>" +
			'<p class="muted small">' + (result.sizesNote ? esc(result.sizesNote) + " " : "") + "Routes from Virtual Radar Server's public route list (" + esc(result.routesDate || "") + "), sent in by people who track real flights. Most are flown today; a few may have stopped.</p>";
		out.innerHTML = h;
		const more = out.querySelector("#fMore");
		if (more) more.addEventListener("click", () => search(false));
		out.querySelectorAll("[data-sb]").forEach(b => b.addEventListener("click", () => simbrief(fl[+b.dataset.sb], b.dataset.flight)));
		out.querySelectorAll(".fc-deal").forEach(a => a.addEventListener("click", e => { e.preventDefault(); openLink(a.dataset.url); }));
		out.querySelectorAll(".fcard").forEach(c => {
			c.addEventListener("mouseenter", () => highlight(+c.dataset.i, true));
			c.addEventListener("mouseleave", () => highlight(+c.dataset.i, false));
		});
		drawMap(from, fl);
	}

	function card(f, i) {
		const flights = (f.flights || []).slice(0, 3);
		const lines = (f.airlines || []).slice(0, 2).map(a => esc(a.name)).join(", ") + ((f.airlines || []).length > 2 ? " +" + (f.airlines.length - 2) : "");
		return '<div class="fcard" data-i="' + i + '">' +
			'<div class="fc-head"><span class="fc-code">' + esc(f.icao) + '</span><span class="fc-flag">' + FLAG(f.country) + '</span><span class="grow"></span>' +
			(f.scenery ? '<span class="tag mine" title="' + esc(f.scenery.title) + '">Your scenery</span>' : "") +
			(f.visited ? '<span class="tag">Been there</span>' : '<span class="tag new">New</span>') + "</div>" +
			'<div class="fc-city">' + esc(f.city || f.name) + '</div><div class="fc-apt muted">' + esc(f.name) + "</div>" +
			'<div class="fc-facts num"><span><b>' + dur(f.estMin) + "</b><em>flight</em></span><span><b>" + fmtInt(f.distNm) + " nm</b><em>distance</em></span><span><b>" +
			(f.rwyFt ? fmtInt(f.rwyFt) + " ft" : "–") + "</b><em>runway</em></span></div>" +
			(lines ? '<div class="fc-air muted">' + lines + "</div>" : "") +
			(f.deal ? '<a class="fc-deal" href="#" data-url="' + esc(f.deal.url) + '"><span class="tag sale">−' + f.deal.pct + "%</span> scenery " + money(f.deal.price, f.deal.currency) +
				' <s class="muted">' + money(f.deal.was, f.deal.currency) + "</s> · " + esc(f.deal.store) + "</a>" : "") +
			'<div class="fc-flights">' + flights.map(c => '<button class="chip" data-sb="' + i + '" data-flight="' + esc(c) + '" title="Plan this flight number in SimBrief">' + esc(c) + "</button>").join("") + "</div>" +
			'<button class="btn accent fc-send" data-sb="' + i + '" data-flight="' + esc(flights[0] || "") + '">Send to SimBrief</button></div>';
	}

	/* SimBrief with departure, destination, aircraft type and the flight number filled in. */
	function simbrief(f, callsign) {
		const p = plane(), from = result.from.icao;
		let url = "https://dispatch.simbrief.com/options/custom?orig=" + from + "&dest=" + f.icao + "&type=" + p[0];
		const m = /^([A-Z]{3})(\d+[A-Z]?)$/.exec(callsign || "");
		if (m) url += "&airline=" + m[1] + "&fltnum=" + m[2];
		openLink(url);
	}

	/* ------------------------------------------------------------------ the map */
	let lines = [];
	function drawMap(from, fl) {
		const el = box.querySelector("#fMap");
		if (!el) return;
		const path = [[from.lat, from.lon]];
		makeMap(el, path, [{ name: from.icao, at: [from.lat, from.lon] }]).then(m => {
			if (!el.isConnected) return;
			if (!m) return plainRoutes(el, from, fl);
			map = m;
			lines = fl.map(f => {
				const l = m.L.polyline(arc([from.lat, from.lon], [f.lat, f.lon]), { color: f.visited ? "#8c9ab0" : "#2dd4bf", weight: 2, opacity: 0.75 }).addTo(m.map);
				m.L.circleMarker([f.lat, f.lon], { radius: 4, color: "#0b111b", weight: 1, fillColor: f.visited ? "#8c9ab0" : "#2dd4bf", fillOpacity: 1 }).addTo(m.map)
					.bindTooltip(f.icao + " · " + f.distNm + " nm", { direction: "top" });
				m.L.marker([f.lat, f.lon], { icon: m.L.divIcon({ html: '<div class="dest-label">' + esc(f.icao) + "</div>" }), interactive: false }).addTo(m.map);
				return l;
			});
			const b = m.L.latLngBounds([[from.lat, from.lon]].concat(fl.map(f => [f.lat, f.lon])));
			m.map.fitBounds(b, { padding: [30, 30], maxZoom: 8 });
		});
	}
	/* Without the internet (no map tiles): the routes on their own. */
	function plainRoutes(el, from, fl) {
		const pts = [[from.lat, from.lon]].concat(fl.map(f => [f.lat, f.lon]));
		let a = 90, b = -90, c = 180, d = -180;
		pts.forEach(p => { a = Math.min(a, p[0]); b = Math.max(b, p[0]); c = Math.min(c, p[1]); d = Math.max(d, p[1]); });
		const W = 1200, H = 330, k = Math.cos(((a + b) / 2) * Math.PI / 180), sx = Math.max(0.5, (d - c) * k), sy = Math.max(0.5, b - a), sc = Math.min((W - 120) / sx, (H - 70) / sy);
		const X = p => ((p[1] - c) * k * sc + (W - sx * sc) / 2), Y = p => ((b - p[0]) * sc + (H - sy * sc) / 2);
		const o = [from.lat, from.lon];
		let g = "";
		fl.forEach(f => {
			const q = [f.lat, f.lon], col = f.visited ? "#8c9ab0" : "#2dd4bf";
			const mx = (X(o) + X(q)) / 2 + (Y(q) - Y(o)) * 0.12, my = (Y(o) + Y(q)) / 2 - (X(q) - X(o)) * 0.12;
			g += '<path d="M' + X(o) + " " + Y(o) + " Q" + mx + " " + my + " " + X(q) + " " + Y(q) + '" stroke="' + col + '" stroke-width="2" fill="none" opacity=".75"/>' +
				'<circle cx="' + X(q) + '" cy="' + Y(q) + '" r="4" fill="' + col + '"/><text x="' + (X(q) + 7) + '" y="' + (Y(q) + 4) + '" fill="#c9d3e3" stroke="none" font-size="12" font-weight="700">' + esc(f.icao) + "</text>";
		});
		g += '<circle cx="' + X(o) + '" cy="' + Y(o) + '" r="6" fill="#e6ecf5"/><text x="' + (X(o) + 9) + '" y="' + (Y(o) + 5) + '" fill="#e6ecf5" stroke="none" font-size="14" font-weight="800">' + esc(from.icao) + "</text>";
		el.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" style="width:100%;height:100%">' + g + '</svg><div class="note">Map tiles need the internet</div>';
	}

	/* A gentle great-circle-like curve between two points. */
	function arc(a, b) {
		const pts = [], n = 24;
		const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], dx = b[1] - a[1], dy = b[0] - a[0], k = 0.12;
		const ctrl = [mid[0] + dx * k, mid[1] - dy * k];
		for (let i = 0; i <= n; i++) {
			const t = i / n, u = 1 - t;
			pts.push([u * u * a[0] + 2 * u * t * ctrl[0] + t * t * b[0], u * u * a[1] + 2 * u * t * ctrl[1] + t * t * b[1]]);
		}
		return pts;
	}
	function highlight(i, on) {
		const l = lines[i];
		if (!l) return;
		l.setStyle({ weight: on ? 4 : 2, opacity: on ? 1 : 0.75 });
		if (on) l.bringToFront();
	}

	return { render: render };
})();
