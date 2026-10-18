/* Control Panel — settings, iCUE plugins and the helper app connection. */

/* ======================================================================= settings + theme */
var Cfg = {
	read: function () {
		var port = String(U.getProp("helperPort", "39812")).replace(/[^0-9]/g, "");
		var media = U.getProp("backgroundMedia", null);
		Cfg.theme = String(U.getProp("theme", "navy"));
		// The XENEON EDGE has very small pixels, so everything is drawn bigger than on a normal monitor.
		Cfg.scale = { small: 1.0, medium: 1.3, large: 1.6, huge: 2.0 }[String(U.getProp("tileSize", "large"))] || 1.6;
		Cfg.backgroundStyle = String(U.getProp("backgroundStyle", "lines"));
		Cfg.showEditButton = U.getProp("showEditButton", true) !== false;
		Cfg.clock24h = U.getProp("clock24h", true) !== false;
		Cfg.onlineLogos = U.getProp("onlineLogos", true) !== false;
		Cfg.port = port && +port > 0 && +port < 65536 ? port : "39812";
		Cfg.accent = U.getProp("accentColor", "#2BB3A3");
		Cfg.bgImage = media && typeof media === "object" && media.pathToAsset ? String(media.pathToAsset) : "";
		Cfg.transparency = Number(U.getProp("transparency", 0)) || 0;
		Cfg.tileStyle = String(U.getProp("tileStyle", "solid"));
		Cfg.glassStrength = Number(U.getProp("glassStrength", 50));
		if (isNaN(Cfg.glassStrength)) Cfg.glassStrength = 50;
		Cfg.nightMode = U.getProp("nightMode", false) === true;
		Cfg.nightStart = String(U.getProp("nightStart", "22:00"));
		Cfg.nightEnd = String(U.getProp("nightEnd", "07:00"));
		Cfg.nightDim = Number(U.getProp("nightDim", 50));
		if (isNaN(Cfg.nightDim)) Cfg.nightDim = 50;
		Cfg.screensaver = parseInt(U.getProp("screensaver", "0"), 10) || 0;
		Cfg.coverAccent = U.getProp("coverAccent", true) !== false;
		Cfg.tapSound = U.getProp("tapSound", false) === true;
	},

	apply: function () {
		var b = document.body;
		["navy", "dark", "teal", "light"].forEach(function (t) {
			b.classList.toggle("theme-" + t, Cfg.theme === t);
		});
		if (!/^(navy|dark|teal|light)$/.test(Cfg.theme)) b.classList.add("theme-navy");
		var a = U.hexToRgb(Cfg.accent, [43, 179, 163]);
		var r = document.documentElement.style;
		r.setProperty("--accent", "rgb(" + a.join(",") + ")");
		r.setProperty("--accent-rgb", a.join(","));
		r.setProperty("--ui", String(Cfg.scale));
		r.setProperty("--bg-alpha", String(U.clamp(1 - Cfg.transparency / 100, 0, 1)));
		b.classList.toggle("no-edit-btn", !Cfg.showEditButton);
		var bg = document.getElementById("bg");
		bg.className = "bg bg-" + (Cfg.backgroundStyle === "image" && Cfg.bgImage ? "image" : Cfg.backgroundStyle === "plain" ? "plain" : "lines");
		bg.style.backgroundImage = Cfg.backgroundStyle === "image" && Cfg.bgImage ? 'url("' + Cfg.bgImage.replace(/"/g, "") + '")' : "";
		if (typeof Look !== "undefined") Look.apply();
	},
};

/* ======================================================================= iCUE plugins */
var Icue = {
	preview: false,
	sensors: {}, // id -> {name, device, type, units, value}
	sensorList: null,
	media: { song: "", artist: "", thumb: "", playing: false, hasState: false },
	fps: { available: false, fps: 0, process: "" },
	_sensors: null,
	_media: null,
	_fps: null,

	initSensors: function () {
		var p = window.plugins && window.plugins.Sensorsdataprovider;
		if (Icue._sensors || !p) return;
		Icue._sensors = U.asyncCaller(p);
		p.sensorValueChanged.connect(function (id, value) {
			var s = Icue.sensors[id];
			if (s) {
				s.value = value;
				App.dirty();
			}
		});
		if (p.sensorUnitsChanged)
			p.sensorUnitsChanged.connect(function (id, units) {
				if (Icue.sensors[id]) Icue.sensors[id].units = units;
			});
		if (p.sensorAdded) p.sensorAdded.connect(function () { Icue.sensorList = null; });
		if (p.sensorRemoved) p.sensorRemoved.connect(function () { Icue.sensorList = null; });
		Icue.loadSensors().then(function () { App.render(); });
		setInterval(Icue.refreshWatched, 3000);
	},

	/* All sensors with their names. */
	loadSensors: function () {
		if (Icue.preview) return Promise.resolve(Icue.sensorList);
		if (!Icue._sensors) return Promise.resolve([]);
		var call = Icue._sensors;
		return call("getAllSensorIds").then(function (ids) {
			ids = Array.isArray(ids) ? ids : [];
			return Promise.all(ids.map(function (id) {
				return Promise.all([call("getSensorName", id), call("getSensorDeviceName", id), call("getSensorType", id), call("getSensorUnits", id), call("getSensorValue", id)]).then(function (r) {
					var s = { id: id, name: r[0] || id, device: r[1] || "", type: r[2] || "", units: r[3] || "", value: r[4] };
					Icue.sensors[id] = s;
					return s;
				});
			}));
		}).then(function (list) {
			Icue.sensorList = list;
			App.dirty();
			return list;
		});
	},

	sensorsOfType: function (type) {
		return (Icue.sensorList || []).filter(function (s) {
			return s.type === type;
		});
	},

	/* First sensor that matches a type and (optionally) one of the kinds/name hints. */
	findSensor: function (type, nameHint) {
		var list = Icue.sensorList || [];
		var re = nameHint ? new RegExp(nameHint, "i") : null;
		for (var i = 0; i < list.length; i++) if (list[i].type === type && (!re || re.test(list[i].name + " " + list[i].device))) return list[i];
		return null;
	},

	/* Ask iCUE for values of sensors that visible tiles use (backup for missed change signals). */
	refreshWatched: function () {
		if (!Icue._sensors) return;
		Object.keys(App.watchedSensors || {}).forEach(function (id) {
			Icue._sensors("getSensorValue", id).then(function (v) {
				if (v !== undefined && Icue.sensors[id] && Icue.sensors[id].value !== v) {
					Icue.sensors[id].value = v;
					App.dirty();
				}
			});
		});
	},

	initMedia: function () {
		var p = window.plugins && window.plugins.Mediadataprovider;
		if (Icue._media || !p) return;
		Icue._media = U.asyncCaller(p);
		Icue.media.hasState = typeof p.getIsPlaying === "function";
		if (p.songNameChanged) p.songNameChanged.connect(Icue.pollMedia);
		if (p.artistChanged) p.artistChanged.connect(Icue.pollMedia);
		Icue.pollMedia();
		setInterval(Icue.pollMedia, 2000);
	},

	_thumbFor: null,
	pollMedia: function () {
		var call = Icue._media;
		var p = window.plugins && window.plugins.Mediadataprovider;
		if (!call || !p) return;
		Promise.all([call("getSongName"), call("getArtist")]).then(function (r) {
			var song = r[0] ? String(r[0]) : "";
			var artist = r[1] ? String(r[1]) : "";
			if (song !== Icue.media.song || artist !== Icue.media.artist) {
				Icue.media.song = song;
				Icue.media.artist = artist;
				App.dirty();
			}
			var key = song + "|" + artist;
			if (!song) {
				Icue.media.thumb = "";
				Icue._thumbFor = null;
				if (typeof Look !== "undefined") Look.onCover("");
			}
			else if (typeof p.getThumbnail === "function" && key !== Icue._thumbFor) {
				Icue._thumbFor = key;
				call("getThumbnail").then(function (url) {
					Icue.media.thumb = typeof url === "string" && /^data:image\//.test(url) ? url : "";
					if (typeof Look !== "undefined") Look.onCover(Icue.media.thumb);
					App.dirty();
				});
			}
		});
		if (Icue.media.hasState)
			call("getIsPlaying").then(function (v) {
				if (v !== undefined && v !== null && !!v !== Icue.media.playing) {
					Icue.media.playing = !!v;
					App.dirty();
				}
			});
	},

	mediaCommand: function (fn) {
		var p = window.plugins && window.plugins.Mediadataprovider;
		if (Icue.preview) {
			if (fn === "triggerPlayPause") Icue.media.playing = !Icue.media.playing;
			App.dirty();
			return;
		}
		if (p && typeof p[fn] === "function") {
			p[fn]();
			if (fn === "triggerPlayPause" && Icue.media.hasState) Icue.media.playing = !Icue.media.playing;
			App.dirty();
			setTimeout(Icue.pollMedia, 500);
		} else U.toast("Media controls aren't available");
	},

	initFps: function () {
		var p = window.plugins && window.plugins.Fpsdataprovider;
		if (Icue._fps || !p) return;
		var call = (Icue._fps = U.asyncCaller(p));
		p.fpsUpdated.connect(function (f) { Icue.fps.fps = f; App.dirty(); });
		p.fpsAvailabilityChanged.connect(function (a) { Icue.fps.available = !!a; App.dirty(); });
		p.processChanged.connect(function (n) { Icue.fps.process = n || ""; App.dirty(); });
		call("getFpsAvailable").then(function (a) { Icue.fps.available = !!a; });
		call("getCurrentFps").then(function (f) { if (f != null) Icue.fps.fps = f; });
		call("getCurrentProcess").then(function (n) { if (n) Icue.fps.process = n; });
	},

	/* Opens a link through iCUE (used when the helper isn't running). */
	openLink: function (url) {
		var p = window.plugins && window.plugins.Linkprovider;
		if (p && typeof p.open === "function") {
			p.open(url);
			return true;
		}
		if (Icue.preview) {
			console.log("[preview] open", url);
			return true;
		}
		return false;
	},

	checkPlugins: function () {
		if (U.flag("pluginSensorsdataprovider_initialized")) Icue.initSensors();
		if (U.flag("pluginMediadataprovider_initialized")) Icue.initMedia();
		if (U.flag("pluginFpsdataprovider_initialized")) Icue.initFps();
	},

	/* Outside iCUE (browser preview): sample data so the layout can be tried. */
	startPreview: function () {
		Icue.preview = true;
		var list = [
			{ id: "p-cpu-t", name: "CPU Package", device: "CPU", type: "temperature", units: "°C", value: 58 },
			{ id: "p-gpu-t", name: "GPU Temperature", device: "GPU", type: "temperature", units: "°C", value: 51 },
			{ id: "p-gpu-l", name: "GPU Load", device: "GPU", type: "load", units: "%", value: 36 },
			{ id: "p-cpu-l", name: "CPU Load", device: "CPU", type: "load", units: "%", value: 21 },
			{ id: "p-pump", name: "Pump", device: "AIO", type: "pump", units: "RPM", value: 2280 },
			{ id: "p-bat1", name: "Battery", device: "Wireless headset", type: "battery-charge", units: "%", value: 82 },
			{ id: "p-bat2", name: "Battery", device: "Wireless mouse", type: "battery-charge", units: "%", value: 46 },
		];
		list.forEach(function (s) { Icue.sensors[s.id] = s; });
		Icue.sensorList = list;
		Icue.media = { song: "Clair de Lune", artist: "Claude Debussy", thumb: "", playing: true, hasState: true };
		Icue.fps = { available: true, fps: 58, process: "Microsoft Flight Simulator 2024" };
		setInterval(function () {
			Icue.sensors["p-cpu-t"].value = 55 + Math.round(Math.random() * 8);
			Icue.sensors["p-gpu-l"].value = 25 + Math.round(Math.random() * 30);
			Icue.sensors["p-cpu-l"].value = 12 + Math.round(Math.random() * 20);
			Icue.fps.fps = 52 + Math.round(Math.random() * 10);
			App.dirty();
		}, 1500);
	},
};

/* ======================================================================= helper app */
var Helper = {
	online: false,
	everOnline: false,
	state: {},
	apps: null,
	_timer: null,
	_busyUntil: {}, // part -> time: don't overwrite a slider the user is dragging

	base: function () {
		return "http://127.0.0.1:" + Cfg.port;
	},

	iconUrl: function (id) {
		return id ? Helper.base() + "/api/icon?id=" + encodeURIComponent(id) : "";
	},

	fetch: function (path, opts, ms) {
		var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
		opts = opts || {};
		if (ctrl) opts.signal = ctrl.signal;
		var t = setTimeout(function () { if (ctrl) ctrl.abort(); }, ms || 2000);
		return fetch(Helper.base() + path, opts).then(function (r) {
			clearTimeout(t);
			return r.json();
		}, function (e) {
			clearTimeout(t);
			throw e;
		});
	},

	/* How often (ms) parts that change slowly are asked for, and where they land in the state. */
	EVERY: { storage: 60000, running: 4500, uptime: 60000, brightness: 15000 },
	KEY: { brightness: "monitors" },
	_at: {},
	bootAt: 0,
	pending: false,
	_cachedAt: 0,

	/* At start: show the last known values right away while the helper answers (no "Control Hub not running" flash). */
	warmStart: function () {
		var c = Editor.storeGet("cpHelperCache");
		if (!c || !c.state || Date.now() - c.at > 15 * 60000) return;
		Helper.state = c.state;
		Helper.bootAt = c.boot || 0;
		Helper.pending = true;
	},
	poll: function () {
		clearTimeout(Helper._timer);
		// Drive space barely changes: ask for it once a minute only. Running programs (automatic pages): every 5 seconds.
		var parts = App.helperParts().filter(function (p) {
			var every = Helper.EVERY[p];
			if (!every) return true;
			if (Date.now() - (Helper._at[p] || 0) < every && Helper.state[Helper.KEY[p] || p] !== undefined) return false;
			Helper._at[p] = Date.now();
			return true;
		});
		var watch = parts.indexOf("running") >= 0 ? "&watch=" + encodeURIComponent(Pages.watchList().join(",")) : "";
		if (parts.indexOf("ping") >= 0) watch += "&ping=" + encodeURIComponent(App.pingTarget || "cloudflare");
		// Brightness answers can take a moment (the monitors are asked over the cable).
		var slow = parts.indexOf("brightness") >= 0 ? 8000 : 4000;
		Helper.fetch("/api/state?parts=" + parts.join(",") + watch, { cache: "no-store" }, slow)
			.then(function (s) {
				if (!s || !s.ok) throw new Error("bad");
				// Only a fresh answer about running programs counts (the copy kept below is old news).
				var freshRunning = Array.isArray(s.running) ? s.running : null;
				var now = Date.now();
				Object.keys(Helper._busyUntil).forEach(function (k) {
					if (Helper._busyUntil[k] > now && Helper.state[k] !== undefined) s[k] = Helper.state[k];
				});
				var was = Helper.online;
				// Parts that are only asked for now and then keep their last answer.
				Object.keys(Helper.EVERY).forEach(function (p) {
					var k = Helper.KEY[p] || p;
					if (s[k] === undefined && Helper.state[k] !== undefined) s[k] = Helper.state[k];
				});
				if (typeof s.uptime === "number" && parts.indexOf("uptime") >= 0) Helper.bootAt = Date.now() - s.uptime * 1000;
				if (Helper.state.network) s.network = Helper.state.network;
				if (Helper.state.networkPeak) s.networkPeak = Helper.state.networkPeak;
				Helper.state = s;
				Helper.pending = false;
				if (Date.now() - Helper._cachedAt > 30000) {
					Helper._cachedAt = Date.now();
					try {
						var keep = {};
						["outputs", "inputs", "speakers", "mic", "mixer", "storage", "cpu", "memory", "monitors", "uptime", "keepAwake", "powerPlan"].forEach(function (k) { if (s[k] !== undefined) keep[k] = s[k]; });
						Editor.storeSet("cpHelperCache", { at: Date.now(), state: keep, boot: Helper.bootAt });
					} catch (e) {}
				}
				Helper.online = true;
				Helper.everOnline = true;
				if (typeof Pages !== "undefined" && Pages.onHelper) Pages.onHelper();
				if (freshRunning) Pages.onRunning(freshRunning);
				if (!was) App.render();
				else App.dirty();
			})
			.catch(function () {
				var was = Helper.online || Helper.pending;
				Helper.online = false;
				Helper.pending = false;
				if (was) App.render();
			})
			.then(function () {
				var busy = parts.filter(function (p) { return p !== "running"; }).length;
				var delay = !Helper.online ? 5000 : busy ? 2000 : App.helperParts().indexOf("running") >= 0 ? 5000 : 6000;
				if (Helper.online && Helper.state.speedtest && Helper.state.speedtest.running) delay = 700;
				// Flying: the dashboard and map update every second.
				if (Helper.online && parts.indexOf("sim") >= 0 && Helper.state.sim && Helper.state.sim.connected) delay = 1000;
				Helper._timer = setTimeout(Helper.poll, delay);
			});
	},

	/* Mark a part as being changed by the user, so polling doesn't fight the slider. */
	hold: function (part, ms) {
		Helper._busyUntil[part] = Date.now() + (ms || 1500);
	},

	act: function (body, quiet) {
		return Helper.fetch("/api/action", {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-Control-Panel": "1" },
			body: JSON.stringify(body),
		}, 4000).then(function (r) {
			if (!r || !r.ok) {
				if (!quiet) U.toast("That didn't work");
				return false;
			}
			setTimeout(Helper.poll, 150);
			return true;
		}, function () {
			if (!quiet) U.toast("Control Hub isn't running");
			return false;
		});
	},

	/* Network speed is only measured when you tap the tile: about 8 seconds, then it stops. */
	netMeasuring: false,
	measureNetwork: function () {
		if (Helper.netMeasuring) return;
		Helper.netMeasuring = true;
		var n = 0;
		App.dirty();
		(function step() {
			Helper.fetch("/api/state?parts=network", { cache: "no-store" }, 2500).then(function (s) {
				// The first answer only starts the measurement.
				if (n > 0 && s && s.network) {
					Helper.state.network = s.network;
					Helper.state.networkAt = Date.now();
					var pk = Helper.state.networkPeak || { down: 0, up: 0 };
					if (n === 1) pk = { down: 0, up: 0 };
					pk.down = Math.max(pk.down, s.network.down || 0);
					pk.up = Math.max(pk.up, s.network.up || 0);
					Helper.state.networkPeak = pk;
				}
			}).catch(function () {}).then(function () {
				n++;
				App.dirty();
				if (n < 9) setTimeout(step, 1000);
				else {
					Helper.netMeasuring = false;
					App.dirty();
				}
			});
		})();
	},

	loadApps: function (refresh) {
		return Helper.fetch("/api/apps" + (refresh ? "?refresh=1" : ""), { cache: "no-store" }, 20000).then(function (r) {
			Helper.apps = r && r.apps ? r.apps : [];
			return Helper.apps;
		});
	},
};
