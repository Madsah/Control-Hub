/* Control Panel — the starter. This is the part that lives in iCUE.

   It asks Control Hub Service on this PC which version of the panel it has. When that's the same or newer than the
   copy built into this widget, the panel's layout, styles and scripts are loaded from Control Hub — so panel updates
   arrive with Control Hub's Update button, without importing the widget into iCUE again.
   If Control Hub isn't running, is older, or anything fails to load, the built-in copy is used instead.

   Change this file, index.html or manifest.json only when really needed: those changes do need a new import in iCUE
   (the installer then opens the widget in iCUE by itself). */

/* iCUE hooks, set before anything else so no event is missed while the panel loads.
   They must be plain global assignments (no var/let/const) so iCUE can see them. */
icueEvents = {
	onICUEInitialized: function () { if (window.App && App.onIcueInitialized) App.onIcueInitialized(); },
	onDataUpdated: function () { if (window.App && App.onIcueDataUpdated) App.onIcueDataUpdated(); },
};
pluginSensorsdataproviderEvents = { onInitialized: function () { if (window.Icue) Icue.initSensors(); } };
pluginMediadataproviderEvents = { onInitialized: function () { if (window.Icue) Icue.initMedia(); } };
pluginFpsdataproviderEvents = { onInitialized: function () { if (window.Icue) Icue.initFps(); } };
pluginLinkproviderEvents = { onInitialized: function () {} };

(function () {
	var BUILT_IN = window.CP_FILES || { version: "0", styles: [], scripts: [] };
	var port = 39812;
	try {
		var p = parseInt(window.helperPort, 10);
		if (p > 1023 && p < 65536) port = p;
	} catch (e) {}
	var BASE = "http://127.0.0.1:" + port + "/";
	var HUB = BASE + "widget/";
	var settled = false;
	var startedAt = Date.now();
	// "#cp-local=<file>": the last start from Control Hub failed on that file, so this start uses the built-in copy.
	var LOCAL = location.hash.indexOf("#cp-local") === 0;
	var failedFile = LOCAL ? decodeURIComponent(location.hash.split("=")[1] || "") : "";

	/* 1 if a is newer than b, -1 if older, 0 if the same ("5.10.0" is newer than "5.9.3"). */
	function cmp(a, b) {
		var x = String(a || "0").split("."), y = String(b || "0").split(".");
		for (var i = 0; i < Math.max(x.length, y.length); i++) {
			var p = parseInt(x[i], 10) || 0, q = parseInt(y[i], 10) || 0;
			if (p !== q) return p > q ? 1 : -1;
		}
		return 0;
	}

	/* Adds the styles and scripts in order. Scripts added this way still run one after another (async = false). */
	function loadAll(base, files, source, version, onFail) {
		window.CP_SOURCE = source;
		window.CP_VERSION = version;
		var failed = false;
		var bust = source === "hub" ? "?v=" + encodeURIComponent(version) : "";
		function fail(file) {
			if (failed) return;
			failed = true;
			if (onFail) onFail(file);
		}
		(files.styles || []).forEach(function (href) {
			var l = document.createElement("link");
			l.rel = "stylesheet";
			l.href = base + href + bust;
			if (onFail) l.onerror = function () { fail(href); };
			document.head.appendChild(l);
		});
		var scripts = files.scripts || [];
		scripts.forEach(function (src, i) {
			var s = document.createElement("script");
			s.src = base + src + bust;
			s.async = false;
			if (onFail) s.onerror = function () { fail(src); };
			// The last one has run: the panel is up. Tell Control Hub what runs, and start watching for updates.
			if (i === scripts.length - 1) s.onload = function () { if (!failed) { report(); watch(); } };
			document.body.appendChild(s);
		});
		if (!scripts.length) { report(); watch(); }
	}

	/* Tell Control Hub which panel code really runs (and what didn't load), for Control Hub → Help. */
	function report() {
		try {
			fetch(BASE + "widget-report?source=" + encodeURIComponent(window.CP_SOURCE || "") + "&version=" + encodeURIComponent(window.CP_VERSION || "") +
				(failedFile ? "&failed=" + encodeURIComponent(failedFile) : ""), { cache: "no-store" }).then(null, function () {});
		} catch (e) {}
	}

	/* Once a minute: has Control Hub got newer panel code (an update), or is it back after the built-in copy had to be used?
	   Then the panel starts again by itself — but only while nobody is using it. */
	var lastTouch = Date.now();
	document.addEventListener("pointerdown", function () { lastTouch = Date.now(); }, true);
	function busy() {
		var m = document.getElementById("modal");
		return Date.now() - lastTouch < 20000 || (window.App && App.editing) || (m && !m.hidden) || !!document.querySelector(".pop");
	}
	var watching = false;
	function watch() {
		if (watching || !window.fetch) return;
		watching = true;
		setInterval(function () {
			if (document.hidden) return;
			fetch(BASE + "widget-version", { cache: "no-store" })
				.then(function (r) { return r.json(); })
				.then(function (v) {
					if (!v || !v.ok || !v.version) return;
					var restart = window.CP_SOURCE === "hub"
						? cmp(v.version, window.CP_VERSION) > 0
						// Built-in copy: Control Hub is there now. After a failed load, wait 10 minutes before trying again.
						: cmp(v.version, BUILT_IN.version) >= 0 && (!LOCAL || Date.now() - startedAt > 600000);
					if (!restart) { report(); return; }
					(function tryNow() {
						if (busy()) return setTimeout(tryNow, 5000);
						location.replace(location.href.split("#")[0]);
					})();
				})
				.then(null, function () {});
		}, 60000);
	}

	function builtIn() {
		if (settled) return;
		settled = true;
		loadAll("", BUILT_IN, "built-in", BUILT_IN.version, null);
		// The built-in copy has no onload chain if it fails; make sure watching starts anyway.
		setTimeout(function () { report(); watch(); }, 8000);
	}

	/* Something from Control Hub didn't load: start once more, with the built-in copy (the #cp-local mark). */
	function fallback(file) {
		try { history.replaceState(null, "", location.href.split("#")[0] + "#cp-local=" + encodeURIComponent(file || "?")); } catch (e) {}
		location.reload();
	}

	if (LOCAL || !window.fetch || !window.DOMParser) return builtIn();
	// Control Hub may still be starting (right after Windows starts): give it a few seconds.
	var timer = setTimeout(builtIn, 4000);

	fetch(HUB.replace(/widget\/$/, "widget-version"), { cache: "no-store" })
		.then(function (r) { return r.json(); })
		.then(function (v) {
			if (settled) return;
			if (!v || !v.ok || !v.version || cmp(v.version, BUILT_IN.version) < 0) {
				clearTimeout(timer);
				return builtIn();
			}
			return fetch(HUB + "index.html?v=" + encodeURIComponent(v.version), { cache: "no-store" })
				.then(function (r) {
					if (!r.ok) throw new Error("no index");
					return r.text();
				})
				.then(function (html) {
					if (settled) return;
					settled = true;
					clearTimeout(timer);
					// The page's layout comes with Control Hub's copy too (its scripts are loaded below).
					var doc = new DOMParser().parseFromString(html, "text/html");
					[].slice.call(doc.body.querySelectorAll("script")).forEach(function (s) { s.parentNode.removeChild(s); });
					document.body.innerHTML = doc.body.innerHTML;
					// The newest file list, then the files.
					var list = document.createElement("script");
					list.src = HUB + "files.js?v=" + encodeURIComponent(v.version);
					list.onload = function () { loadAll(HUB, window.CP_FILES || BUILT_IN, "hub", v.version, fallback); };
					list.onerror = function () { fallback("files.js"); };
					document.body.appendChild(list);
				});
		})
		.catch(function () {
			clearTimeout(timer);
			// Already switched over to Control Hub's copy when it failed: start again with the built-in one.
			if (settled && !window.CP_SOURCE) fallback("index.html");
			else builtIn();
		});
})();
