/* FlightLine — the window. Everything comes from Control Hub Service on this PC (/api/fl/...).
   Logbook (every flight, recorded by itself), Stats, one flight (map, altitude, events, landing), and Live while you fly. */
"use strict";

const $ = (s, r) => (r || document).querySelector(s);
const main = $("#main");
const PLANE = '<svg viewBox="0 0 24 24"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/></svg>';
const BACK = '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>';
const TRASH = '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';

let flights = [], live = null, sim = null, view = "logbook", openId = null, query = "";

/* ------------------------------------------------------------------ helpers */
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function n(v, d) { v = Number(v); return isFinite(v) ? v : (d === undefined ? 0 : d); }
function fmtInt(v) { return Math.round(n(v)).toLocaleString("en-GB").replace(/,/g, " "); }
function dur(min) {
	min = Math.round(n(min));
	if (min < 60) return min + " min";
	return Math.floor(min / 60) + " h " + String(min % 60).padStart(2, "0") + " min";
}
function hours(min) { return (n(min) / 60).toFixed(1).replace(/\.0$/, ""); }
function clock(ms) { return new Date(n(ms)).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); }
function day(ms) { return new Date(n(ms)).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }); }
function since(sec) {
	sec = Math.max(0, Math.round(n(sec)));
	const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
	return h ? h + ":" + String(m).padStart(2, "0") + " h" : m + " min";
}
function tplus(sec) {
	sec = Math.max(0, Math.round(n(sec)));
	const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
	return h ? h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0") : m + ":" + String(s).padStart(2, "0");
}
function from(f) { return f.from || f.planFrom || "?"; }
function to(f) { return f.to || f.planTo || (f.takeoff ? "?" : from(f)); }
function gradeClass(g) { return !g ? "" : g[0] === "A" ? "g-a" : g === "B" ? "g-b" : g === "C" ? "g-c" : "g-d"; }
function gradeBadge(g) { return g ? '<span class="grade ' + gradeClass(g) + '">' + esc(g) + "</span>" : ""; }
/* "Airbus A320neo Asobo Air France" → shorter, without the maker's studio. */
function acName(t) { return String(t || "Unknown aircraft").replace(/\s+(Asobo|Microsoft|iniBuilds|PMDG|Fenix|FBW|Headwind)\b/i, "").trim(); }

async function get(path) {
	const r = await fetch(path, { cache: "no-store" });
	if (!r.ok) throw new Error(path + " " + r.status);
	return r.json();
}

/* ------------------------------------------------------------------ tooltip */
const tip = $("#tip");
function showTip(x, y, html) {
	tip.innerHTML = html;
	tip.hidden = false;
	const w = tip.offsetWidth, h = tip.offsetHeight;
	tip.style.left = Math.min(window.innerWidth - w - 8, x + 14) + "px";
	tip.style.top = Math.max(8, y - h - 12) + "px";
}
function hideTip() { tip.hidden = true; }

function confirmBox(title, text, ok) {
	return new Promise(res => {
		const d = $("#dialog");
		d.innerHTML = '<div class="box"><h3>' + esc(title) + "</h3><p>" + esc(text) + '</p><div class="row"><button class="btn" data-a="no">Cancel</button><button class="btn danger" data-a="yes">' + esc(ok) + "</button></div></div>";
		d.hidden = false;
		d.onclick = e => {
			const a = e.target.closest("[data-a]");
			if (!a && e.target !== d) return;
			d.hidden = true;
			res(a && a.dataset.a === "yes");
		};
	});
}

/* ------------------------------------------------------------------ navigation */
document.querySelectorAll(".nav").forEach(b => b.addEventListener("click", () => go(b.dataset.view)));
function go(v, id) {
	view = v;
	openId = id || null;
	document.querySelectorAll(".nav").forEach(b => b.classList.toggle("on", b.dataset.view === (v === "flight" ? "logbook" : v)));
	hideTip();
	render();
	main.scrollTop = 0;
}

function render() {
	if (view === "stats") return renderStats();
	if (view === "live") return renderLive();
	if (view === "session") return Session.render(main);
	if (view === "finder") return Finder.render(main);
	if (view === "flight") return renderFlight(openId);
	renderLogbook();
}

/* ------------------------------------------------------------------ totals */
function totals(list) {
	const t = { flights: list.length, blockMin: 0, airMin: 0, dist: 0, apts: new Set(), fpm: [], best: null, ac: {} };
	list.forEach(f => {
		t.blockMin += n(f.blockMin);
		t.airMin += n(f.airMin);
		t.dist += n(f.distNm);
		if (f.from) t.apts.add(f.from);
		if (f.to) t.apts.add(f.to);
		if (f.fpm != null && f.landing) {
			t.fpm.push(n(f.fpm));
			if (!t.best || n(f.fpm) < n(t.best.fpm)) t.best = f;
		}
		const a = acName(f.aircraft);
		t.ac[a] = (t.ac[a] || 0) + n(f.blockMin);
	});
	t.avg = t.fpm.length ? Math.round(t.fpm.reduce((a, b) => a + b, 0) / t.fpm.length) : null;
	return t;
}

function card(label, value, sub) {
	return '<div class="card"><em>' + esc(label) + '</em><b class="num">' + value + "</b>" + (sub ? "<small>" + sub + "</small>" : "") + "</div>";
}

function liveBanner() {
	if (!live || !live.recording) return "";
	const el = live.start ? (Date.now() - live.start) / 1000 : 0;
	return '<button class="live" id="liveBtn"><span class="dot"></span><div><b>Recording ' + esc(live.from || "?") + " → " + esc(live.planTo || "…") +
		'</b><div class="muted">' + esc(acName(live.aircraft)) + " · " + (live.landed ? "landed" : live.airborne ? "in the air" : "on the ground") + "</div></div>" +
		'<div class="vals num"><div><em>Time</em>' + since(el) + "</div><div><em>Altitude</em>" + fmtInt(live.alt) + " ft</div><div><em>Ground speed</em>" +
		fmtInt(live.gs) + " kt</div><div><em>Distance</em>" + fmtInt(live.distNm) + " nm</div></div></button>";
}

/* ------------------------------------------------------------------ logbook */
function renderLogbook() {
	const t = totals(flights);
	let h = '<div class="head"><div class="grow"><h1>Logbook</h1><p>Every flight in MSFS is recorded by itself while Control Hub runs.</p></div></div>';
	h += liveBanner();
	h += '<div class="cards">' +
		card("Flight hours", hours(t.blockMin), hours(t.airMin) + " h in the air") +
		card("Flights", t.flights, t.flights ? "since " + new Date(n(flights[flights.length - 1].start)).toLocaleDateString("en-GB", { month: "short", year: "numeric" }) : "") +
		card("Airports", t.apts.size, "visited") +
		card("Distance", fmtInt(t.dist) + " nm", "") +
		card("Average landing", t.avg == null ? "–" : t.avg + " fpm", t.fpm.length ? t.fpm.length + " landings" : "") +
		card("Best landing", t.best ? n(t.best.fpm) + " fpm" : "–", t.best ? esc(from(t.best) + " → " + to(t.best)) : "") +
		"</div>";
	h += '<div class="panel"><h2>Flights</h2>';
	if (!flights.length) {
		h += '<div class="empty"><div class="big">' + PLANE + "</div><b>No flights yet</b>" + simHint() + "</div></div>";
		main.innerHTML = h;
		wireLive();
		return;
	}
	h += '<div class="tools"><input class="search" id="q" placeholder="Search airport or aircraft" value="' + esc(query) + '"></div>';
	h += '<table><thead><tr><th>Date</th><th>Route</th><th>Aircraft</th><th class="r">Time</th><th class="r">Distance</th><th class="r">Landing</th></tr></thead><tbody id="rows"></tbody></table></div>';
	main.innerHTML = h;
	wireLive();
	const q = $("#q");
	q.addEventListener("input", () => { query = q.value; fillRows(); });
	fillRows();
}

function fillRows() {
	const q = query.trim().toLowerCase();
	const list = flights.filter(f => !q || [from(f), to(f), f.aircraft, f.planFrom, f.planTo, f.flightNo].join(" ").toLowerCase().includes(q));
	$("#rows").innerHTML = list.map(f =>
		'<tr data-id="' + esc(f.id) + '"><td><div>' + esc(day(f.start)) + '</div><div class="muted">' + clock(f.start) + "</div></td>" +
		'<td class="route"><b>' + esc(from(f)) + '</b><span class="arr">→</span><b>' + esc(to(f)) + "</b>" +
		(f.complete === false ? '<span class="tag warn">Unfinished</span>' : "") + (f.imported ? '<span class="tag">Old log</span>' : "") + "</td>" +
		'<td class="ac">' + esc(acName(f.aircraft)) + "</td>" +
		'<td class="r num">' + dur(f.blockMin) + "</td>" +
		'<td class="r num">' + (f.distNm ? fmtInt(f.distNm) + " nm" : '<span class="muted">–</span>') + "</td>" +
		'<td class="r num">' + (f.fpm != null ? n(f.fpm) + " fpm" + gradeBadge(f.grade) : '<span class="muted">–</span>') + "</td></tr>"
	).join("") || '<tr><td colspan="6" class="muted">Nothing matches “' + esc(query) + "”.</td></tr>";
	document.querySelectorAll("#rows tr[data-id]").forEach(r => r.addEventListener("click", () => go("flight", r.dataset.id)));
}

function simHint() {
	if (!sim) return "<p>Start Control Hub, then fly in MSFS 2024. Your flights show up here by themselves.</p>";
	if (!sim.dll) return "<p>MSFS isn't connected yet: SimConnect.dll is missing. Right-click Control Hub Service by the clock → Set up MSFS (SimConnect).</p>";
	if (!sim.running) return "<p>Fly in MSFS 2024 and your flights show up here by themselves, from pushback to parking.</p>";
	return "<p>MSFS is connected. Start taxiing and the flight is recorded by itself.</p>";
}

function wireLive() {
	const b = $("#liveBtn");
	if (b) b.addEventListener("click", () => go("live"));
}

/* ------------------------------------------------------------------ the map (Leaflet from the internet; a plain drawing without it) */
/* The map: FlightLine's own small map (map.js), so nothing has to load from the internet except the map pictures. */
function leaflet() { return Promise.resolve(typeof MiniL !== "undefined" ? MiniL : null); }

function makeMap(box, path, airports) {
	return leaflet().then(L => {
		if (!box.isConnected) return null;
		if (!L) { drawPlain(box, path); return null; }
		const map = L.map(box, { zoomControl: true, attributionControl: true, worldCopyJump: true });
		// OpenStreetMap's own map pictures (free, no key), turned dark to match FlightLine (map.js: dark).
		L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
			maxZoom: 18, dark: true,
			attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
		}).addTo(map);
		const ll = path.map(p => [p[0], p[1]]);
		const line = L.polyline(ll, { color: "#2dd4bf", weight: 3, opacity: 0.95 }).addTo(map);
		(airports || []).forEach(a => {
			if (!a.at) return;
			L.circleMarker(a.at, { radius: 6, color: "#0b111b", weight: 2, fillColor: "#e6ecf5", fillOpacity: 1 }).addTo(map);
			L.marker(a.at, { icon: L.divIcon({ className: "", html: '<div class="apt-label">' + esc(a.name) + "</div>", iconSize: [0, 0] }), interactive: false }).addTo(map);
		});
		if (ll.length > 1) map.fitBounds(line.getBounds(), { padding: [40, 40], maxZoom: 13 });
		else if (ll.length) map.setView(ll[0], 12);
		else map.setView([55.6, 12.6], 6);
		return { L, map, line };
	});
}

/* Without the internet: the path on its own, in a box. */
function drawPlain(box, path) {
	if (!path.length) { box.innerHTML = '<div class="empty">No path recorded for this flight.</div>'; return; }
	let a = 90, b = -90, c = 180, d = -180;
	path.forEach(p => { a = Math.min(a, p[0]); b = Math.max(b, p[0]); c = Math.min(c, p[1]); d = Math.max(d, p[1]); });
	const W = 1000, H = 430, k = Math.cos(((a + b) / 2) * Math.PI / 180);
	const sx = (d - c) * k || 0.01, sy = b - a || 0.01, s = Math.min((W - 80) / sx, (H - 80) / sy);
	const pts = path.map(p => ((p[1] - c) * k * s + (W - sx * s) / 2).toFixed(1) + "," + ((b - p[0]) * s + (H - sy * s) / 2).toFixed(1)).join(" ");
	box.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" style="width:100%;height:100%"><polyline points="' + pts + '" style="fill:none;stroke:#2dd4bf;stroke-width:3"/></svg><div class="note">Map tiles need the internet</div>';
}

/* ------------------------------------------------------------------ altitude chart (one series, hover crosshair) */
function altChart(box, pts, events, onHover) {
	if (pts.length < 2) { box.innerHTML = '<p class="muted">Not enough points for a profile.</p>'; return; }
	const W = 900, H = 170, L0 = 46, R0 = 10, T0 = 10, B0 = 22;
	const t0 = pts[0][0], t1 = pts[pts.length - 1][0] || 1;
	let maxA = 0;
	pts.forEach(p => { maxA = Math.max(maxA, p[3]); });
	const step = maxA > 20000 ? 10000 : maxA > 8000 ? 5000 : maxA > 3000 ? 1000 : 500;
	const top = Math.max(step, Math.ceil(maxA / step) * step);
	const X = t => L0 + ((t - t0) / Math.max(1, t1 - t0)) * (W - L0 - R0);
	const Y = a => T0 + (1 - Math.max(0, a) / top) * (H - T0 - B0);
	let grid = "";
	for (let v = 0; v <= top; v += step) grid += '<line class="gridline" x1="' + L0 + '" x2="' + (W - R0) + '" y1="' + Y(v) + '" y2="' + Y(v) + '"/><text class="axis" x="' + (L0 - 6) + '" y="' + (Y(v) + 4) + '" text-anchor="end">' + (v >= 1000 ? v / 1000 + "k" : v) + "</text>";
	const mins = (t1 - t0) / 60, tick = mins > 240 ? 60 : mins > 90 ? 30 : mins > 40 ? 10 : 5;
	for (let m = 0; m <= mins; m += tick) grid += '<text class="axis" x="' + X(t0 + m * 60) + '" y="' + (H - 6) + '" text-anchor="middle">' + (m >= 60 ? Math.floor(m / 60) + ":" + String(m % 60).padStart(2, "0") : m + "m") + "</text>";
	const line = pts.map((p, i) => (i ? "L" : "M") + X(p[0]).toFixed(1) + " " + Y(p[3]).toFixed(1)).join("");
	const area = line + "L" + X(pts[pts.length - 1][0]).toFixed(1) + " " + Y(0) + "L" + X(pts[0][0]).toFixed(1) + " " + Y(0) + "Z";
	const evs = (events || []).filter(e => e[1] === "takeoff" || e[1] === "touchdown").map(e => '<line class="ev" x1="' + X(e[0]) + '" x2="' + X(e[0]) + '" y1="' + T0 + '" y2="' + (H - B0) + '"/>').join("");
	box.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none">' + grid + evs + '<path class="area" d="' + area + '"/><path class="lineq" d="' + line + '"/>' +
		'<line class="cross" id="cx" y1="' + T0 + '" y2="' + (H - B0) + '" visibility="hidden"/><circle class="dotq" id="cd" r="5" visibility="hidden"/>' +
		'<rect x="' + L0 + '" y="0" width="' + (W - L0 - R0) + '" height="' + H + '" fill="transparent" id="hit"/></svg>';
	const svg = box.querySelector("svg"), cx = box.querySelector("#cx"), cd = box.querySelector("#cd");
	box.querySelector("#hit").addEventListener("mousemove", e => {
		const r = svg.getBoundingClientRect();
		const t = t0 + ((e.clientX - r.left) / r.width * W - L0) / (W - L0 - R0) * (t1 - t0);
		let best = pts[0];
		for (const p of pts) if (Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p;
		cx.setAttribute("x1", X(best[0])); cx.setAttribute("x2", X(best[0])); cx.setAttribute("visibility", "visible");
		cd.setAttribute("cx", X(best[0])); cd.setAttribute("cy", Y(best[3])); cd.setAttribute("visibility", "visible");
		showTip(e.clientX, e.clientY, "<b>+" + tplus(best[0] - t0) + "</b><div><span>Altitude</span><span>" + fmtInt(best[3]) + " ft</span></div>" +
			(best[6] >= 0 ? "<div><span>Ground speed</span><span>" + fmtInt(best[6]) + " kt</span></div>" : "") +
			(best[5] > 0 ? "<div><span>Airspeed</span><span>" + fmtInt(best[5]) + " kt</span></div>" : "") +
			"<div><span>Vertical speed</span><span>" + fmtInt(best[7]) + " fpm</span></div>");
		if (onHover) onHover(best);
	});
	box.querySelector("#hit").addEventListener("mouseleave", () => {
		cx.setAttribute("visibility", "hidden"); cd.setAttribute("visibility", "hidden"); hideTip();
		if (onHover) onHover(null);
	});
}

/* ------------------------------------------------------------------ one flight */
async function renderFlight(id) {
	main.innerHTML = '<button class="back" id="back">' + BACK + ' Logbook</button><p class="muted">Loading the flight…</p>';
	$("#back").addEventListener("click", () => go("logbook"));
	let f;
	try { f = await get("/api/fl/flight?id=" + encodeURIComponent(id)); }
	catch (e) { main.insertAdjacentHTML("beforeend", '<p class="muted">Couldn\'t load this flight.</p>'); return; }
	if (view !== "flight" || openId !== id) return;
	const pts = f.pts || [], ev = f.events || [], li = f.landingInfo || {};
	const fa = from(f), ta = to(f);
	let h = '<button class="back" id="back">' + BACK + " Logbook</button>";
	h += '<div class="head"><div class="grow"><div class="route-big">' + esc(fa) + '<span class="arr">→</span>' + esc(ta) +
		(f.complete === false ? '<span class="tag warn">Unfinished</span>' : "") + "</div><p>" + esc(day(f.start)) + " · " + clock(f.start) + "–" + clock(f.end) + " · " + esc(acName(f.aircraft)) +
		(f.planTo && f.planTo !== ta ? " · planned to " + esc(f.planTo) : "") + '</p></div>' + (ta.length === 4 ? '<button class="btn" id="again">Find a flight from ' + esc(ta) + "</button>" : "") + '<button class="btn danger" id="del">' + TRASH + " Delete</button></div>";
	h += '<div class="grid2"><div><div class="map" id="map"></div><div class="panel chart"><h3>Altitude</h3><div id="alt"></div></div></div><div>';
	h += '<div class="panel side-panel"><h3>Landing</h3>';
	if (li.fpm != null) {
		h += '<div class="landing"><span class="fpm num">' + n(li.fpm) + ' <small class="muted" style="font-size:15px;font-weight:500">fpm</small></span>' + gradeBadge(li.grade) +
			'<span class="muted">' + esc(li.rating || "") + "</span></div>";
		h += '<div class="facts">' +
			fact("G at touchdown", li.g != null ? n(li.g).toFixed(2) + " G" : "–") +
			fact("Runway", li.rwy ? esc((li.airport || ta) + " " + li.rwy) : "–") +
			fact("Touchdown", li.distM != null ? fmtInt(li.distM) + " m past the threshold" : "–") +
			fact("Centerline", li.clM != null ? Math.abs(n(li.clM)).toFixed(1) + " m " + (n(li.clM) > 0.5 ? "right" : n(li.clM) < -0.5 ? "left" : "") : "–") +
			"</div>";
	} else h += '<p class="muted">' + (f.takeoff ? "No landing was recorded on this flight." : "This flight never took off.") + "</p>";
	h += "</div>";
	h += '<div class="panel side-panel"><h3>Flight</h3><div class="facts">' +
		fact("Block time", dur(f.blockMin) + '<div class="muted" style="font-size:12px;font-weight:400">' + clock(f.start) + " – " + clock(f.end) + "</div>") +
		fact("In the air", f.airMin != null ? dur(f.airMin) : "–") +
		fact("Distance", f.distNm ? fmtInt(f.distNm) + " nm" : "–") +
		fact("Highest", f.maxAlt ? fmtInt(f.maxAlt) + " ft" : "–") +
		fact("Fuel used", f.fuelUsedKg != null ? fmtInt(f.fuelUsedKg) + " kg" : "–") +
		fact("Flight number", f.flightNo ? esc(f.flightNo) : "–") +
		"</div></div>";
	h += '<div class="panel side-panel"><h3>What happened</h3>' + (ev.length ? '<ul class="events">' + ev.map(e =>
		'<li class="k-' + esc(e[1]) + '"><time>+' + tplus(e[0]) + "</time><i></i><span>" + esc(e[2]) + "</span></li>").join("") + "</ul>" : '<p class="muted">Nothing recorded (this flight is from the old flight log).</p>') + "</div>";
	h += "</div></div>";
	main.innerHTML = h;
	$("#back").addEventListener("click", () => go("logbook"));
	const again = $("#again");
	if (again) again.addEventListener("click", () => {
		try { const o = JSON.parse(localStorage.getItem("flFinder") || "{}"); o.from = "code"; o.fromCode = ta; localStorage.setItem("flFinder", JSON.stringify(o)); } catch (e) {}
		go("finder");
	});
	$("#del").addEventListener("click", async () => {
		if (!(await confirmBox("Delete this flight?", fa + " → " + ta + ", " + day(f.start) + ". It's removed from the logbook and can't be brought back (except from a Control Hub backup).", "Delete"))) return;
		const r = await fetch("/api/fl/delete", { method: "POST", headers: { "Content-Type": "application/json", "X-Control-Panel": "1" }, body: JSON.stringify({ id: f.id }) }).then(r => r.json()).catch(() => null);
		if (r && r.ok) { await loadLogbook(); go("logbook"); }
	});
	const path = pts.filter(p => p[1] || p[2]).map(p => [p[1], p[2]]);
	const apts = [];
	if (path.length) {
		apts.push({ name: fa, at: path[0] });
		if (f.takeoff && ta !== "?") apts.push({ name: ta, at: path[path.length - 1] });
	}
	let marker = null, mapObj = null;
	makeMap($("#map"), path, apts).then(m => { mapObj = m; });
	altChart($("#alt"), pts, ev, p => {
		if (!mapObj) return;
		if (!p) { if (marker) { marker.remove(); marker = null; } return; }
		const ic = mapObj.L.divIcon({ className: "", html: '<div class="plane-ic" style="transform:translate(-11px,-11px) rotate(' + (p[8] >= 0 ? p[8] : 0) + 'deg)">' + PLANE + "</div>", iconSize: [0, 0] });
		if (!marker) marker = mapObj.L.marker([p[1], p[2]], { icon: ic, interactive: false }).addTo(mapObj.map);
		else { marker.setLatLng([p[1], p[2]]); marker.setIcon(ic); }
	});
}

function fact(label, value) { return '<div class="fact"><em>' + esc(label) + '</em><b class="num">' + value + "</b></div>"; }

/* ------------------------------------------------------------------ live */
let liveMap = null, livePlane = null;
function renderLive() {
	liveMap = null; livePlane = null;
	if (!live || !live.recording) {
		main.innerHTML = '<div class="head"><div class="grow"><h1>Live</h1><p>Nothing is being recorded right now.</p></div></div><div class="panel"><div class="empty"><div class="big">' + PLANE + "</div><b>Not flying</b>" + simHint() + "</div></div>";
		return;
	}
	main.innerHTML = '<div class="head"><div class="grow"><h1>Live</h1><p id="liveSub"></p></div></div><div class="cards" id="liveCards"></div><div class="map" id="map" style="height:520px"></div>';
	updateLive();
	makeMap($("#map"), (live.path || []).map(p => [p[0], p[1]]), live.path && live.path.length ? [{ name: live.from || "?", at: [live.path[0][0], live.path[0][1]] }] : []).then(m => {
		liveMap = m;
		updateLive();
	});
}

function updateLive() {
	if (view !== "live" || !live || !live.recording) return;
	const sub = $("#liveSub"), cards = $("#liveCards");
	if (!sub) return;
	const el = live.start ? (Date.now() - live.start) / 1000 : 0;
	sub.textContent = (live.from || "?") + " → " + (live.planTo || "…") + " · " + acName(live.aircraft) + " · " + (live.landed ? "landed" : live.airborne ? "in the air" : "on the ground");
	cards.innerHTML = card("Time", since(el)) + card("Altitude", fmtInt(live.alt) + " ft", fmtInt(live.agl) + " ft above ground") + card("Airspeed", fmtInt(live.ias) + " kt", fmtInt(live.gs) + " kt over the ground") +
		card("Vertical speed", fmtInt(live.vs) + " fpm") + card("Heading", String(Math.round(n(live.hdg))).padStart(3, "0") + "°") + card("Distance", fmtInt(live.distNm) + " nm");
	if (liveMap && live.path) {
		liveMap.line.setLatLngs(live.path.map(p => [p[0], p[1]]));
		if (live.lat != null) {
			const ic = liveMap.L.divIcon({ className: "", html: '<div class="plane-ic" style="transform:translate(-11px,-11px) rotate(' + n(live.hdg) + 'deg)">' + PLANE + "</div>", iconSize: [0, 0] });
			if (!livePlane) livePlane = liveMap.L.marker([live.lat, live.lon], { icon: ic, interactive: false }).addTo(liveMap.map);
			else { livePlane.setLatLng([live.lat, live.lon]); livePlane.setIcon(ic); }
		}
	}
}

/* ------------------------------------------------------------------ stats */
function renderStats() {
	const t = totals(flights);
	let h = '<div class="head"><div class="grow"><h1>Stats</h1><p>Everything you\'ve flown, added up.</p></div></div>';
	h += '<div class="cards">' + card("Flight hours", hours(t.blockMin), hours(t.airMin) + " h in the air") + card("Flights", t.flights) + card("Airports", t.apts.size) +
		card("Aircraft", Object.keys(t.ac).length) + card("Distance", fmtInt(t.dist) + " nm", t.dist ? "≈ " + (t.dist / 21639).toFixed(2) + " × around the world" : "") + "</div>";
	if (!flights.length) {
		main.innerHTML = h + '<div class="panel"><div class="empty"><b>Nothing to add up yet</b>' + simHint() + "</div></div>";
		return;
	}
	// Hours per aircraft (the 8 most flown, the rest together).
	let ac = Object.entries(t.ac).sort((a, b) => b[1] - a[1]);
	if (ac.length > 8) ac = ac.slice(0, 7).concat([["Other aircraft", ac.slice(7).reduce((s, x) => s + x[1], 0)]]);
	const maxAc = Math.max(1, ...ac.map(x => x[1]));
	h += '<div class="stats-grid"><div class="panel"><h2>Hours per aircraft</h2><div class="bars">' + ac.map(x =>
		'<div class="bar-row"><span title="' + esc(x[0]) + '">' + esc(x[0]) + '</span><div class="track"><div class="fill" style="width:' + (x[1] / maxAc * 100).toFixed(1) + '%"></div></div><b>' + hours(x[1]) + " h</b></div>").join("") + "</div></div>";
	// Flights per month, the last 12 months.
	const now = new Date(), months = [];
	for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push({ y: d.getFullYear(), m: d.getMonth(), n: 0, min: 0 }); }
	flights.forEach(f => { const d = new Date(n(f.start)); const m = months.find(x => x.y === d.getFullYear() && x.m === d.getMonth()); if (m) { m.n++; m.min += n(f.blockMin); } });
	const maxM = Math.max(1, ...months.map(m => m.n));
	h += '<div class="panel"><h2>Flights per month</h2><div class="cols">' + months.map((m, i) =>
		'<div class="col' + (m.n ? "" : " zero") + '" data-i="' + i + '"><div class="c" style="height:' + (m.n / maxM * 100).toFixed(1) + '%"></div></div>').join("") +
		'</div><div class="col-labels">' + months.map(m => "<span>" + new Date(m.y, m.m, 1).toLocaleDateString("en-GB", { month: "short" }) + "</span>").join("") + "</div></div></div>";
	// Airports.
	const count = {};
	flights.forEach(f => { [f.from, f.to].forEach(a => { if (a) count[a] = (count[a] || 0) + 1; }); });
	const apts = Object.entries(count).sort((a, b) => b[1] - a[1]);
	h += '<div class="panel" style="margin-top:16px"><h2>Airports (' + apts.length + ')</h2><div class="chips">' + apts.map(a => '<span class="chip"><b>' + esc(a[0]) + "</b><span>" + a[1] + "×</span></span>").join("") + "</div></div>";
	main.innerHTML = h;
	document.querySelectorAll(".col").forEach(c => {
		const m = months[+c.dataset.i];
		c.addEventListener("mousemove", e => showTip(e.clientX, e.clientY, "<b>" + new Date(m.y, m.m, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" }) + "</b><div><span>Flights</span><span>" + m.n + "</span></div><div><span>Hours</span><span>" + hours(m.min) + "</span></div>"));
		c.addEventListener("mouseleave", hideTip);
	});
}

/* ------------------------------------------------------------------ data */
async function loadLogbook() {
	try {
		const d = await get("/api/fl/logbook");
		flights = (d.flights || []).sort((a, b) => n(b.start) - n(a.start));
	} catch (e) { flights = []; }
}

let lastRecording = null;
async function poll() {
	try {
		const d = await get("/api/fl/live");
		sim = d.sim || null;
		live = d.rec || null;
	} catch (e) { sim = null; live = null; }
	const s = $("#sim"), rec = !!(live && live.recording);
	s.className = "sim" + (rec ? " rec" : sim && sim.connected ? " on" : "");
	s.querySelector("span").textContent = rec ? "Recording a flight" : !sim ? "Control Hub isn't running" : sim.connected ? "MSFS connected" : sim.running ? "MSFS is starting…" : "MSFS isn't running";
	const nl = $("#navLive");
	nl.hidden = !rec;
	nl.classList.toggle("rec", rec);
	// A flight just ended: it's in the logbook now.
	if (lastRecording === true && !rec) { setTimeout(async () => { await loadLogbook(); if (view === "logbook" || view === "stats") render(); }, 2500); }
	lastRecording = rec;
	if (view === "session") Session.tick();
	if (view === "live") { if (!rec || !$("#liveCards")) render(); else updateLive(); }
	else if (view === "logbook") {
		const b = $("#liveBtn");
		if (rec !== !!b) render();
		else if (b) b.outerHTML = liveBanner(), wireLive();
	}
}

(async function start() {
	await loadLogbook();
	await poll();
	render();
	setInterval(() => { if (!document.hidden) poll(); }, 3000);
})();
