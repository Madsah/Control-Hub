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
	const TIMES = [[30, 60, "30 min – 1 h"], [60, 120, "1 – 2 h"], [120, 240, "2 – 4 h"], [240, 480, "4 – 8 h"], [480, 900, "8 h +"]];
	const FLAG = cc => /^[A-Z]{2}$/.test(cc || "") ? String.fromCodePoint(...[...cc].map(c => 0x1f1e6 + c.charCodeAt(0) - 65)) : "";

	let box = null, opts = null, result = null, status = null, map = null, busy = false;

	function load() {
		try { opts = JSON.parse(localStorage.getItem("flFinder") || "null"); } catch (e) { opts = null; }
		if (!opts) opts = { plane: guessPlane(), from: "last", fromCode: "", time: 1, newOnly: false };
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
		if (status && status.have && !result) search(false);
		else if (status && status.building) waitForRoutes();
	}

	function draw() {
		const p = plane();
		let h = '<div class="head"><div class="grow"><h1>Find a flight</h1><p>Real airline routes: flights that have actually been flown, that fit your plane and your time.</p></div></div>';
		h += '<div class="panel side-panel finder-form">' +
			'<label class="field">Plane<select id="fPlane">' + PLANES.map(x => '<option value="' + x[0] + '"' + (x[0] === p[0] ? " selected" : "") + ">" + esc(x[1]) + " (" + x[0] + ")</option>").join("") + "</select></label>" +
			'<div class="field">From<div class="from-row"><div class="tabs" id="fFromTabs">' +
			'<button data-f="last"' + (opts.from === "last" ? ' class="on"' : "") + ">Last landing</button>" +
			'<button data-f="here"' + (opts.from === "here" ? ' class="on"' : "") + ">Where I am in MSFS</button>" +
			'<button data-f="code"' + (opts.from === "code" ? ' class="on"' : "") + ">Airport</button></div>" +
			'<input class="search code" id="fCode" maxlength="4" placeholder="EKCH" value="' + esc(opts.fromCode || "") + '"' + (opts.from === "code" ? "" : " hidden") + "></div>" +
			'<span class="muted small" id="fFromNote"></span></div>' +
			'<div class="field">Flight time<div class="chips" id="fTime">' + TIMES.map((t, i) => '<button class="chip' + (i === opts.time ? " on" : "") + '" data-i="' + i + '">' + t[2] + "</button>").join("") + "</div></div>" +
			'<label class="chk big-chk"><input type="checkbox" id="fNew"' + (opts.newOnly ? " checked" : "") + "> Only airports I haven't flown to</label>" +
			'<div class="find-btns"><button class="btn accent big" id="fGo">Find flights</button><button class="btn big" id="fSurprise">Surprise me</button></div>' +
			"</div>";
		h += '<div id="fStatus"></div><div id="fOut"></div>';
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
		$$("#fGo").addEventListener("click", () => search(false));
		$$("#fSurprise").addEventListener("click", () => search(true));
		fromNote();
		if (result) drawResult();
	}

	function fromNote() {
		const n = box && box.querySelector("#fFromNote");
		if (!n) return;
		if (opts.from === "last") n.textContent = status ? (status.last ? "Your last flight landed at " + status.last : "No landing in the logbook yet: choose Airport") : "";
		else if (opts.from === "here") n.textContent = status ? (status.here ? "You're at " + status.here : "MSFS isn't connected, or you're not at an airport") : "";
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
		const out = box.querySelector("#fOut");
		if (!from) { out.innerHTML = '<div class="hint-box">Type an airport code, e.g. EKCH.</div>'; return; }
		busy = true;
		out.innerHTML = '<p class="muted">Looking…</p>';
		try {
			result = await get("/api/fl/find?from=" + encodeURIComponent(from) + "&min=" + t[0] + "&max=" + t[1] + "&kt=" + p[2] + "&rwy=" + p[3] + "&ovh=" + p[4] +
				"&new=" + (opts.newOnly ? 1 : 0) + "&surprise=" + (surprise ? 1 : 0) + "&count=12");
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
		let h = '<div class="find-head"><div><b>' + esc(from.icao) + "</b> " + esc(from.name) + ' <span class="muted">· ' + (result.surprise ? "your surprise flight" : fl.length + " of " + result.total + " routes that fit") + "</span></div>" +
			(result.surprise ? "" : '<button class="btn" id="fMore">Show others</button>') + "</div>";
		h += '<div class="grid2 finder-grid"><div class="results">' + fl.map((f, i) => card(f, i)).join("") + '</div><div><div class="map finder-map" id="fMap"></div>' +
			'<p class="muted small">Routes from Virtual Radar Server\'s public route list (' + esc(result.routesDate || "") + "), sent in by people who track real flights. Most are flown today; a few may have stopped.</p></div></div>";
		out.innerHTML = h;
		const more = out.querySelector("#fMore");
		if (more) more.addEventListener("click", () => search(false));
		out.querySelectorAll("[data-sb]").forEach(b => b.addEventListener("click", () => simbrief(fl[+b.dataset.sb], b.dataset.flight)));
		out.querySelectorAll(".fcard").forEach(c => {
			c.addEventListener("mouseenter", () => highlight(+c.dataset.i, true));
			c.addEventListener("mouseleave", () => highlight(+c.dataset.i, false));
		});
		drawMap(from, fl);
	}

	function card(f, i) {
		const flights = (f.flights || []).slice(0, 3);
		const lines = (f.airlines || []).slice(0, 3).map(a => esc(a.name)).join(", ");
		return '<div class="fcard" data-i="' + i + '"><div class="fc-top"><span class="fc-code">' + esc(f.icao) + "</span>" +
			'<div class="fc-name"><b>' + esc(f.name) + '</b><span class="muted">' + FLAG(f.country) + " " + esc(f.city || "") + (f.city && f.country ? ", " : "") + esc(f.country || "") + "</span></div>" +
			(f.visited ? '<span class="tag">Been there</span>' : '<span class="tag new">New</span>') + "</div>" +
			'<div class="fc-facts num"><span><em>Distance</em>' + fmtInt(f.distNm) + ' nm</span><span><em>About</em>' + dur(f.estMin) + "</span><span><em>Runway</em>" + (f.rwyFt ? fmtInt(f.rwyFt) + " ft" : "–") + "</span></div>" +
			(lines ? '<div class="fc-air muted">Flown by ' + lines + ((f.airlines || []).length > 3 ? " and more" : "") + "</div>" : "") +
			'<div class="fc-btns">' + flights.map(c => '<button class="chip" data-sb="' + i + '" data-flight="' + esc(c) + '" title="Plan this flight in SimBrief">' + esc(c) + "</button>").join("") +
			'<button class="btn accent" data-sb="' + i + '" data-flight="' + esc(flights[0] || "") + '">Send to SimBrief</button></div></div>';
	}

	/* SimBrief with departure, destination, aircraft type and the flight number filled in. */
	function simbrief(f, callsign) {
		const p = plane(), from = result.from.icao;
		let url = "https://dispatch.simbrief.com/options/custom?orig=" + from + "&dest=" + f.icao + "&type=" + p[0];
		const m = /^([A-Z]{3})(\d+[A-Z]?)$/.exec(callsign || "");
		if (m) url += "&airline=" + m[1] + "&fltnum=" + m[2];
		fetch("/api/action", { method: "POST", headers: { "Content-Type": "application/json", "X-Control-Panel": "1" }, body: JSON.stringify({ action: "openUrl", url: url }) })
			.then(r => r.json()).then(r => { if (!r || !r.ok) window.open(url, "_blank"); }).catch(() => window.open(url, "_blank"));
	}

	/* ------------------------------------------------------------------ the map */
	let lines = [];
	function drawMap(from, fl) {
		const el = box.querySelector("#fMap");
		if (!el) return;
		const path = [[from.lat, from.lon]];
		makeMap(el, path, [{ name: from.icao, at: [from.lat, from.lon] }]).then(m => {
			if (!m || !el.isConnected) return;
			map = m;
			lines = fl.map(f => {
				const l = m.L.polyline(arc([from.lat, from.lon], [f.lat, f.lon]), { color: f.visited ? "#8c9ab0" : "#2dd4bf", weight: 2, opacity: 0.75 }).addTo(m.map);
				m.L.circleMarker([f.lat, f.lon], { radius: 4, color: "#0b111b", weight: 1, fillColor: f.visited ? "#8c9ab0" : "#2dd4bf", fillOpacity: 1 }).addTo(m.map)
					.bindTooltip(f.icao + " · " + f.distNm + " nm", { direction: "top" });
				return l;
			});
			const b = m.L.latLngBounds([[from.lat, from.lon]].concat(fl.map(f => [f.lat, f.lon])));
			m.map.fitBounds(b, { padding: [30, 30], maxZoom: 8 });
		});
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
