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
	var HUB = "http://127.0.0.1:" + port + "/widget/";
	var settled = false;

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
		function fail() {
			if (failed) return;
			failed = true;
			if (onFail) onFail();
		}
		(files.styles || []).forEach(function (href) {
			var l = document.createElement("link");
			l.rel = "stylesheet";
			l.href = base + href + bust;
			if (onFail) l.onerror = fail;
			document.head.appendChild(l);
		});
		(files.scripts || []).forEach(function (src) {
			var s = document.createElement("script");
			s.src = base + src + bust;
			s.async = false;
			if (onFail) s.onerror = fail;
			document.body.appendChild(s);
		});
	}

	function builtIn() {
		if (settled) return;
		settled = true;
		loadAll("", BUILT_IN, "built-in", BUILT_IN.version, null);
	}

	/* Something from Control Hub didn't load: start once more, with the built-in copy (the #cp-local mark). */
	function fallback() {
		try { history.replaceState(null, "", location.href.split("#")[0] + "#cp-local"); } catch (e) {}
		location.reload();
	}

	if (location.hash === "#cp-local" || !window.fetch || !window.DOMParser) return builtIn();
	var timer = setTimeout(builtIn, 1500);

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
					list.onerror = fallback;
					document.body.appendChild(list);
				});
		})
		.catch(function () {
			clearTimeout(timer);
			// Already switched over to Control Hub's copy when it failed: start again with the built-in one.
			if (settled && !window.CP_SOURCE) fallback();
			else builtIn();
		});
})();
