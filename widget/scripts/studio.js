/* Control Panel — Studio look (5.3): accent colour choice and the black home pages.
 * The styles are in styles/studio.css (only with body.studio). */

var Studio = (function () {
	var BR = ["Google Chrome", "Brave", "Microsoft Edge", "Firefox", "Opera GX", "Opera"];
	var WX = { name: "Copenhagen", lat: 55.6759, lon: 12.5655 };

	/* ------------------------------------------------------------------ accent colour */
	var ACCENTS = [["", "Like iCUE"], ["#22C55E", "Green"], ["#2BB3A3", "Teal"], ["#3B82F6", "Blue"], ["#8B5CF6", "Purple"], ["#EC4899", "Pink"], ["#F97316", "Orange"], ["#EF4444", "Red"]];

	function lookSection(sec, chooser, again) {
		if (!document.body.classList.contains("studio")) return;
		var s = sec("Accent colour", "The colour of sliders, buttons and highlights in the Studio look.");
		chooser(s, ACCENTS, Editor.storeGet("cpAccent") || "", function (v) {
			Editor.storeSet("cpAccent", v);
			Look.apply();
			again();
		});
	}

	/* ------------------------------------------------------------------ the black home pages (Medium tiles, 19 × 5) */
	function t(type, x, y, w, h, cfg) { return { type: type, x: x, y: y, w: w, h: h, cfg: cfg || {} }; }
	var B = {
		discord: { kind: "app", name: "Discord", find: ["Discord"] },
		spotify: { kind: "app", name: "Spotify", find: ["Spotify"] },
		steam: { kind: "app", name: "Steam", find: ["Steam"] },
		msfs: { kind: "app", name: "Flight Sim", find: ["Microsoft Flight Simulator 2024", "Microsoft Flight Simulator"], steam: "2537590" },
		cs2: { kind: "app", name: "CS2", find: ["Counter-Strike 2"], steam: "730" },
		browser: { kind: "app", name: "Browser", find: BR },
		obs: { kind: "app", name: "OBS", find: ["OBS Studio"] },
		simbrief: { kind: "url", name: "SimBrief", url: "https://dispatch.simbrief.com", domain: "simbrief.com" },
		navigraph: { kind: "url", name: "Navigraph", url: "https://charts.navigraph.com", domain: "navigraph.com" },
		youtube: { kind: "url", name: "YouTube", url: "https://www.youtube.com", domain: "youtube.com" },
		files: { kind: "quick", what: "explorer", name: "Files" },
		settings: { kind: "quick", what: "settings", name: "Settings" },
		taskman: { kind: "quick", what: "taskmanager", name: "Task Manager" },
		shot: { kind: "quick", what: "screenshot", name: "Screenshot" },
		sound: { kind: "quick", what: "sound", name: "Sound" },
		flightline: { kind: "quick", what: "flightline", name: "FlightLine" },
		session: { kind: "quick", what: "flsession", name: "Start session" },
	};
	/* A row (or block) of 1×1 buttons. "dnd" and "power" are their own tiles. */
	function buttons(names, x, y, cols) {
		cols = cols || names.length;
		return names.map(function (n, i) {
			var bx = x + (i % cols), by = y + Math.floor(i / cols);
			if (n === "dnd") return t("dnd", bx, by, 1, 1);
			if (n === "power") return t("power", bx, by, 1, 1, { style: "icon" });
			return t("shortcut", bx, by, 1, 1, JSON.parse(JSON.stringify(B[n])));
		});
	}
	var SUB = "Medium tiles · black";
	var BLACK = [
		{ name: "Black · Centre stage", sub: SUB + " · Spotify in the middle, clock and apps left, Discord right", tiles: [
			t("clock", 0, 0, 5, 2, { style: "flip" }), t("weather", 0, 2, 5, 1, WX),
			t("spotify", 5, 0, 8, 4), t("spvolume", 5, 4, 8, 1, { vertical: false }),
			t("discord", 13, 0, 6, 3), t("speakers", 13, 3, 6, 1),
		].concat(buttons(["discord", "spotify", "steam", "msfs", "cs2", "browser", "simbrief", "navigraph", "files", "settings"], 0, 3, 5),
			buttons(["dnd", "shot", "taskman", "obs", "sound", "power"], 13, 4)) },
		{ name: "Black · Big clock", sub: SUB + " · a big thin clock, the next hours, Spotify and Discord", tiles: [
			t("clock", 0, 0, 7, 3, { style: "big" }), t("weather", 0, 3, 4, 2, { name: WX.name, lat: WX.lat, lon: WX.lon, fc: "hours" }),
			t("spotify", 7, 0, 7, 3), t("spvolume", 7, 3, 7, 1, { vertical: false }), t("speakers", 7, 4, 7, 1),
			t("discord", 14, 0, 5, 3),
		].concat(buttons(["discord", "spotify", "steam", "msfs", "cs2", "browser"], 4, 3, 3),
			buttons(["obs", "simbrief", "navigraph", "files", "settings", "taskman", "shot", "dnd", "sound", "power"], 14, 3, 5)) },
		{ name: "Black · Music", sub: SUB + " · a big player, your playlists as covers and Discord", tiles: [
			t("clock", 0, 0, 5, 2, { style: "big" }), t("spplaylists", 0, 2, 5, 3),
			t("spotify", 5, 0, 8, 4), t("spvolume", 5, 4, 8, 1, { vertical: false }),
			t("discord", 13, 0, 6, 3), t("speakers", 13, 3, 6, 1),
		].concat(buttons(["spotify", "discord", "steam", "msfs", "sound", "power"], 13, 4)) },
		{ name: "Black · Flight", sub: SUB + " · your SimBrief flight, airport weather, FlightLine and music", tiles: [
			t("clock", 0, 0, 4, 2, { style: "big", format: "24" }), t("metar", 0, 2, 4, 3),
			t("ofp", 4, 0, 6, 4),
			t("spotify", 10, 0, 5, 3), t("discord", 15, 0, 4, 3), t("spvolume", 10, 3, 5, 1, { vertical: false }), t("speakers", 15, 3, 4, 1),
		].concat(buttons(["msfs", "simbrief", "navigraph", "flightline", "session", "youtube"], 4, 4),
			buttons(["discord", "spotify", "steam", "browser", "files", "shot", "dnd", "sound", "power"], 10, 4)) },
		{ name: "Black · Calm", sub: SUB + " · few, big tiles: clock, weather, Spotify, Discord and six buttons", tiles: [
			t("clock", 0, 0, 7, 3, { style: "big" }), t("weather", 0, 3, 7, 2, WX),
			t("spotify", 7, 0, 6, 4), t("spvolume", 7, 4, 6, 1, { vertical: false }),
			t("discord", 13, 0, 6, 3),
			t("shortcut", 13, 3, 2, 1, B.steam), t("shortcut", 15, 3, 2, 1, B.msfs), t("shortcut", 17, 3, 2, 1, B.cs2),
			t("shortcut", 13, 4, 2, 1, B.browser), t("shortcut", 15, 4, 2, 1, B.sound), t("power", 17, 4, 2, 1, { style: "icon" }),
		] },
	];

	function presets() {
		return BLACK.map(function (p) {
			return { group: "Black", name: p.name, sub: p.sub, make: function () {
				return JSON.parse(JSON.stringify({ name: p.name.replace("Black · ", ""), theme: "midnight", size: "medium", grid: { cols: 19, rows: 5 }, tiles: p.tiles }));
			} };
		});
	}

	// Add them to the page presets (Edit → Pages → New page), first in the list.
	if (window.Round10 && Round10.presets) {
		var old = Round10.presets;
		Round10.presets = function () { return presets().concat(old.apply(this, arguments)); };
	}

	/* ------------------------------------------------------------------ tell Control Hub the accent colour and the page showing
	   (the Control Hub app uses the same accent, and draws the page on its Overview) */
	var sentKey = "", sendTimer = null;
	function tellHub() {
		clearTimeout(sendTimer);
		sendTimer = setTimeout(function () {
			try {
				if (!window.Helper || !Helper.online) return;
				var rgb = getComputedStyle(document.documentElement).getPropertyValue("--accent-rgb").split(",").map(function (x) { return parseInt(x, 10); });
				var hex = rgb.length === 3 && rgb.every(function (x) { return x >= 0 && x <= 255; }) ? "#" + rgb.map(function (x) { return ("0" + x.toString(16)).slice(-2); }).join("") : null;
				var L = Editor.layout(), page = L.pages[L.current] || {};
				var key = hex + "|" + L.current + "|" + page.name;
				if (key === sentKey) return;
				sentKey = key;
				Helper.act({ action: "panelLook", accent: hex, page: L.current, pageName: page.name || "" });
			} catch (e) {}
		}, 800);
	}
	if (window.Round8 && Round8.applyLook) {
		var oldApply = Round8.applyLook;
		Round8.applyLook = function () { var r = oldApply.apply(this, arguments); tellHub(); return r; };
	}
	setInterval(function () { sentKey = ""; tellHub(); }, 60000); // again now and then (Control Hub may have restarted)

	return { lookSection: lookSection, presets: presets, BLACK: BLACK };
})();
