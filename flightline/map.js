/* FlightLine — a small map of its own (no outside script needed): dark map tiles, lines, dots, labels and icons,
   drag to move, mouse wheel / + − to zoom. It understands the few Leaflet-style calls FlightLine uses
   (map, tileLayer, polyline, circleMarker, marker, divIcon, latLngBounds), so the rest of the code stays the same.
   Tiles: CARTO's dark map, from OpenStreetMap data. Without the internet the lines and dots still show. */
"use strict";

const MiniL = (function () {
	const TILE = 256;
	const SUBS = ["a", "b", "c", "d"];

	function project(lat, lon, z) {
		const s = TILE * Math.pow(2, z), la = Math.max(-85.05, Math.min(85.05, lat)) * Math.PI / 180;
		return [(lon + 180) / 360 * s, (1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2 * s];
	}
	function unproject(x, y, z) {
		const s = TILE * Math.pow(2, z), lon = x / s * 360 - 180, n = Math.PI - 2 * Math.PI * y / s;
		return [180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lon];
	}
	const ll = p => Array.isArray(p) ? p : [p.lat, p.lng];

	function Bounds(pts) {
		this.s = 90; this.n = -90; this.w = 180; this.e = -180;
		(pts || []).forEach(p => this.extend(p));
	}
	Bounds.prototype.extend = function (p) {
		p = ll(p);
		this.s = Math.min(this.s, p[0]); this.n = Math.max(this.n, p[0]); this.w = Math.min(this.w, p[1]); this.e = Math.max(this.e, p[1]);
		return this;
	};
	Bounds.prototype.valid = function () { return this.n >= this.s && this.e >= this.w; };

	/* ------------------------------------------------------------------ the map */
	function Map(el, opts) {
		this.el = el;
		this.z = 5; this.cx = 0; this.cy = 0; // centre in world pixels at zoom z
		this.layers = [];
		this.tileUrl = null;
		this.tileOk = 0; this.tileBad = 0;
		el.innerHTML = "";
		el.classList.add("mm");
		this.tiles = document.createElement("div"); this.tiles.className = "mm-tiles";
		this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); this.svg.setAttribute("class", "mm-svg");
		this.html = document.createElement("div"); this.html.className = "mm-html";
		this.note = document.createElement("div"); this.note.className = "mm-note"; this.note.hidden = true;
		this.attr = document.createElement("div"); this.attr.className = "mm-attr";
		const zoom = document.createElement("div"); zoom.className = "mm-zoom";
		zoom.innerHTML = '<button type="button" data-z="1" aria-label="Zoom in">+</button><button type="button" data-z="-1" aria-label="Zoom out">−</button>';
		zoom.addEventListener("click", e => { const b = e.target.closest("[data-z]"); if (b) this.zoomBy(+b.dataset.z); });
		[this.tiles, this.svg, this.html, zoom, this.note, this.attr].forEach(x => el.appendChild(x));
		this.wire();
		this.ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => this.draw()) : null;
		if (this.ro) this.ro.observe(el);
	}

	Map.prototype.size = function () { return [this.el.clientWidth || 600, this.el.clientHeight || 300]; };

	Map.prototype.wire = function () {
		let drag = null;
		this.el.addEventListener("pointerdown", e => {
			if (e.target.closest(".mm-zoom")) return;
			drag = { x: e.clientX, y: e.clientY, cx: this.cx, cy: this.cy };
			try { this.el.setPointerCapture(e.pointerId); } catch (x) {}
			this.el.classList.add("dragging");
		});
		this.el.addEventListener("pointermove", e => {
			if (!drag) return;
			this.cx = drag.cx - (e.clientX - drag.x);
			this.cy = drag.cy - (e.clientY - drag.y);
			this.draw();
		});
		const end = () => { drag = null; this.el.classList.remove("dragging"); };
		this.el.addEventListener("pointerup", end);
		this.el.addEventListener("pointercancel", end);
		this.el.addEventListener("wheel", e => {
			e.preventDefault();
			const r = this.el.getBoundingClientRect();
			this.zoomBy(e.deltaY < 0 ? 1 : -1, e.clientX - r.left, e.clientY - r.top);
		}, { passive: false });
		this.el.addEventListener("dblclick", e => {
			const r = this.el.getBoundingClientRect();
			this.zoomBy(1, e.clientX - r.left, e.clientY - r.top);
		});
	};

	/* Zoom by one step, keeping the point under the mouse (or the centre) where it is. */
	Map.prototype.zoomBy = function (d, px, py) {
		const nz = Math.max(1.5, Math.min(17, Math.round((this.z + d) * 2) / 2));
		if (nz === this.z) return;
		const [w, h] = this.size();
		px = px == null ? w / 2 : px; py = py == null ? h / 2 : py;
		const wx = this.cx - w / 2 + px, wy = this.cy - h / 2 + py, f = Math.pow(2, nz - this.z);
		this.cx = wx * f - px + w / 2;
		this.cy = wy * f - py + h / 2;
		this.z = nz;
		this.draw();
	};

	Map.prototype.setView = function (p, z) {
		p = ll(p);
		this.z = z == null ? this.z : z;
		const c = project(p[0], p[1], this.z);
		this.cx = c[0]; this.cy = c[1];
		this.draw();
		return this;
	};

	Map.prototype.fitBounds = function (b, o) {
		if (!(b instanceof Bounds)) b = new Bounds(b);
		if (!b.valid()) return this;
		const pad = (o && o.padding ? o.padding[0] : 20) * 2, maxZ = o && o.maxZoom != null ? o.maxZoom : 14;
		const [w, h] = this.size();
		// The zoom (also in between whole steps) at which everything just fits.
		const a0 = project(b.n, b.w, 0), c0 = project(b.s, b.e, 0);
		const fx = (w - pad) / Math.max(1e-9, c0[0] - a0[0]), fy = (h - pad) / Math.max(1e-9, c0[1] - a0[1]);
		const z = Math.max(1.5, Math.min(maxZ, Math.log2(Math.min(fx, fy))));
		const a = project(b.n, b.w, z), c = project(b.s, b.e, z);
		this.z = z; this.cx = (a[0] + c[0]) / 2; this.cy = (a[1] + c[1]) / 2;
		this.draw();
		return this;
	};

	/* World pixel → spot in the box. */
	Map.prototype.pt = function (p) {
		p = ll(p);
		const [w, h] = this.size(), q = project(p[0], p[1], this.z);
		return [q[0] - this.cx + w / 2, q[1] - this.cy + h / 2];
	};

	Map.prototype.add = function (layer) { this.layers.push(layer); layer.map = this; this.draw(); return this; };
	Map.prototype.removeLayer = function (layer) { this.layers = this.layers.filter(l => l !== layer); layer.map = null; this.draw(); };

	Map.prototype.draw = function () {
		if (this._raf) return;
		this._raf = requestAnimationFrame(() => { this._raf = 0; this.paint(); });
	};

	Map.prototype.paint = function () {
		const [w, h] = this.size();
		this.svg.setAttribute("viewBox", "0 0 " + w + " " + h);
		this.svg.setAttribute("width", w); this.svg.setAttribute("height", h);
		// Tiles
		if (this.tileUrl) {
			// Pictures from the whole zoom step below, shown a little bigger in between steps.
			const tz = Math.max(0, Math.floor(this.z + 1e-9)), T = TILE * Math.pow(2, this.z - tz), n = Math.pow(2, tz);
			const x0 = Math.floor((this.cx - w / 2) / T), y0 = Math.floor((this.cy - h / 2) / T);
			const x1 = Math.floor((this.cx + w / 2) / T), y1 = Math.floor((this.cy + h / 2) / T);
			const want = {};
			for (let ty = Math.max(0, y0); ty <= Math.min(n - 1, y1); ty++)
				for (let tx = x0; tx <= x1; tx++) {
					const wx = ((tx % n) + n) % n, key = tz + "/" + wx + "/" + ty + "/" + tx;
					want[key] = [tx * T - this.cx + w / 2, ty * T - this.cy + h / 2, wx, ty, tz, T];
				}
			const have = {};
			[].slice.call(this.tiles.children).forEach(img => { if (want[img.dataset.k]) have[img.dataset.k] = img; else img.remove(); });
			Object.keys(want).forEach(k => {
				const v = want[k];
				let img = have[k];
				if (!img) {
					img = new Image();
					img.dataset.k = k;
					img.alt = "";
					img.draggable = false;
					img.onload = () => { this.tileOk++; this.note.hidden = true; };
					img.onerror = () => { this.tileBad++; img.style.visibility = "hidden"; if (!this.tileOk) { this.note.hidden = false; this.note.textContent = "The map pictures couldn't load (no internet?). The routes still show."; } };
					img.src = this.tileUrl.replace("{s}", SUBS[(v[2] + v[3]) % 4]).replace("{z}", v[4]).replace("{x}", v[2]).replace("{y}", v[3]).replace("{r}", "");
					this.tiles.appendChild(img);
				}
				img.style.transform = "translate(" + v[0].toFixed(1) + "px," + v[1].toFixed(1) + "px)";
				img.style.width = img.style.height = (v[5] + 0.5).toFixed(1) + "px";
			});
		}
		// Lines, dots, labels
		let svg = "";
		this.layers.forEach(l => { if (l.svg) svg += l.svg(this); });
		this.svg.innerHTML = svg;
		this.layers.forEach(l => { if (l.place) l.place(this); });
	};

	/* ------------------------------------------------------------------ layers */
	function TileLayer(url, o) { this.url = url; this.o = o || {}; }
	TileLayer.prototype.addTo = function (m) {
		m.tileUrl = this.url;
		m.tiles.classList.toggle("dark", !!this.o.dark);
		m.attr.innerHTML = this.o.attribution || "";
		m.draw();
		return this;
	};

	function Polyline(pts, o) { this.pts = (pts || []).map(ll); this.o = Object.assign({ color: "#2dd4bf", weight: 3, opacity: 1 }, o || {}); this.front = 0; }
	Polyline.prototype.addTo = function (m) { m.add(this); return this; };
	Polyline.prototype.getBounds = function () { return new Bounds(this.pts); };
	Polyline.prototype.setLatLngs = function (p) { this.pts = (p || []).map(ll); if (this.map) this.map.draw(); return this; };
	Polyline.prototype.setStyle = function (o) { Object.assign(this.o, o); if (this.map) this.map.draw(); return this; };
	Polyline.prototype.bringToFront = function () { if (this.map) { this.map.layers = this.map.layers.filter(l => l !== this).concat([this]); this.map.draw(); } return this; };
	Polyline.prototype.remove = function () { if (this.map) this.map.removeLayer(this); };
	Polyline.prototype.svg = function (m) {
		if (this.pts.length < 2) return "";
		const d = this.pts.map((p, i) => { const q = m.pt(p); return (i ? "L" : "M") + q[0].toFixed(1) + " " + q[1].toFixed(1); }).join("");
		return '<path d="' + d + '" fill="none" stroke="' + this.o.color + '" stroke-width="' + this.o.weight + '" stroke-opacity="' + this.o.opacity + '" stroke-linejoin="round" stroke-linecap="round"/>';
	};

	function CircleMarker(p, o) { this.p = ll(p); this.o = Object.assign({ radius: 5, color: "#0b111b", weight: 2, fillColor: "#e6ecf5", fillOpacity: 1 }, o || {}); }
	CircleMarker.prototype.addTo = function (m) { m.add(this); return this; };
	CircleMarker.prototype.bindTooltip = function (t) { this.tip = t; return this; };
	CircleMarker.prototype.remove = function () { if (this.map) this.map.removeLayer(this); };
	CircleMarker.prototype.svg = function (m) {
		const q = m.pt(this.p), o = this.o;
		return '<circle cx="' + q[0].toFixed(1) + '" cy="' + q[1].toFixed(1) + '" r="' + o.radius + '" fill="' + o.fillColor + '" fill-opacity="' + o.fillOpacity +
			'" stroke="' + o.color + '" stroke-width="' + o.weight + '">' + (this.tip ? "<title>" + String(this.tip).replace(/[<&]/g, "") + "</title>" : "") + "</circle>";
	};

	function DivIcon(o) { this.html = (o && o.html) || ""; }

	function Marker(p, o) { this.p = ll(p); this.icon = (o && o.icon) || new DivIcon({}); this.node = null; }
	Marker.prototype.addTo = function (m) { m.add(this); return this; };
	Marker.prototype.setLatLng = function (p) { this.p = ll(p); if (this.map) this.place(this.map); return this; };
	Marker.prototype.setIcon = function (i) { this.icon = i; if (this.node) this.node.innerHTML = i.html; return this; };
	Marker.prototype.remove = function () { if (this.node) this.node.remove(); this.node = null; if (this.map) this.map.removeLayer(this); };
	Marker.prototype.place = function (m) {
		if (!this.node) { this.node = document.createElement("div"); this.node.className = "mm-marker"; this.node.innerHTML = this.icon.html; m.html.appendChild(this.node); }
		const q = m.pt(this.p);
		this.node.style.transform = "translate(" + q[0].toFixed(1) + "px," + q[1].toFixed(1) + "px)";
	};

	/* The Leaflet-style calls FlightLine uses. */
	return {
		map: (el, o) => new Map(el, o),
		tileLayer: (url, o) => new TileLayer(url, o),
		polyline: (p, o) => new Polyline(p, o),
		circleMarker: (p, o) => new CircleMarker(p, o),
		marker: (p, o) => new Marker(p, o),
		divIcon: o => new DivIcon(o),
		latLngBounds: p => new Bounds(p),
	};
})();
