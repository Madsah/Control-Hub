/* Control Panel — start-up and the update loop. */

var App = {
	editing: false,
	started: false,
	watchedSensors: {},
	_dirtyTimer: null,

	/* Something changed: redraw values soon (batched, at most ~4 times a second). */
	dirty: function () {
		if (App._dirtyTimer) return;
		App._dirtyTimer = setTimeout(function () {
			App._dirtyTimer = null;
			Editor.updateAll();
			if (typeof Extra !== "undefined") Extra.check();
			if (typeof Flight !== "undefined") Flight.check();
			if (typeof Round6 !== "undefined") Round6.check();
			if (typeof Round7 !== "undefined") Round7.check();
		}, 250);
	},

	render: function () {
		if (!App.started) return;
		Editor.render();
		App.refreshNeeds();
	},

	/* Work out which helper data and iCUE sensors the visible tiles need. */
	_parts: [],
	refreshNeeds: function () {
		var parts = {}, sensors = {}, seconds = false, tick = 0;
		App.pingTarget = "";
		Editor.visibleTiles().forEach(function (t) {
			var def = T.types[t.type];
			if (!def) return;
			if (def.usesSeconds && def.usesSeconds(t)) seconds = true;
			var tm = typeof def.tickMs === "function" ? def.tickMs(t) : def.tickMs;
			if (tm && (!tick || tm < tick)) tick = tm;
			if (def.pingTarget && !App.pingTarget) App.pingTarget = def.pingTarget(t);
			(typeof def.parts === "function" ? def.parts(t) : def.parts || []).forEach(function (p) { parts[p] = true; });
			if (def.sourcesOf) {
				def.sourcesOf(t).forEach(function (src) {
					if (T.sourceUsesHelper(src)) parts.system = true;
					var real = T.resolve(src);
					if (real && real.indexOf("helper:") !== 0) sensors[real] = true;
				});
			}
		});
		// Screensaver on: nothing on screen needs fresh values.
		if (typeof Look !== "undefined" && Look.sleeping) {
			parts = {};
			sensors = {};
			seconds = false;
		}
		// Games starting / closing come through the helper's live channel; older helpers are asked every few seconds.
		if (Pages.watchList().length && !(typeof Round7 !== "undefined" && Round7.live())) parts.running = true;
		if (typeof Flight !== "undefined" && Flight.phaseRules()) parts.sim = true;
		// Tiles that watch something on every page (temperature alert).
		if (typeof Extra !== "undefined") Extra.alwaysSensors().forEach(function (s) { sensors[s] = true; });
		App._parts = Object.keys(parts);
		App.watchedSensors = sensors;
		if (typeof Round7 !== "undefined") Round7.needsChanged();
		// A clock with seconds needs a redraw every second; otherwise nothing ticks.
		if (seconds) tick = 1000;
		if (tick !== App._tickMs) {
			clearInterval(App._secTimer);
			App._secTimer = tick ? setInterval(function () { Editor.updateAll(); }, tick) : null;
			App._tickMs = tick;
		}
	},

	helperParts: function () {
		return App._parts;
	},

	start: function () {
		if (App.started) return;
		App.started = true;
		Cfg.read();
		Cfg.apply();
		Editor.wire();
		Look.wire();
		if (typeof Round8 !== "undefined") Round8.wire();
		Editor.load();
		Helper.warmStart();
		if (typeof Everyday !== "undefined") Everyday.ensureTicker();
		App.render();
		Helper.poll();
		var queued = false;
		function onResize() {
			if (queued) return;
			queued = true;
			requestAnimationFrame(function () {
				queued = false;
				App.render();
			});
		}
		window.addEventListener("resize", onResize);
		// Back on screen after iCUE hid the panel: show fresh values right away.
		document.addEventListener("visibilitychange", function () { if (!document.hidden) App.dirty(); });
		syncClock();
	},

	onIcueInitialized: function () {
		App.start();
		Icue.checkPlugins();
		App.onIcueDataUpdated();
	},

	onIcueDataUpdated: function () {
		if (!App.started) return;
		var before = { theme: Cfg.theme, edit: Cfg.showEditButton, port: Cfg.port, logos: Cfg.onlineLogos, scale: Cfg.scale };
		Cfg.read();
		Cfg.apply();
		if (before.port !== Cfg.port) Helper.poll();
		if (before.edit !== Cfg.showEditButton || before.logos !== Cfg.onlineLogos || before.scale !== Cfg.scale) App.render();
		else App.dirty();
	},
};

/* Redraw the clock right when the minute changes, then once a minute. */
function syncClock() {
	var ms = 60000 - (Date.now() % 60000) + 50;
	setTimeout(function () {
		App.dirty();
		setInterval(App.dirty, 60000);
	}, ms);
}

/* iCUE injects its globals on its own schedule: wait a moment before deciding this is a plain browser. */
(function boot() {
	var tries = 0;
	(function check() {
		if (U.flag("iCUE_initialized")) return App.onIcueInitialized();
		if (tries++ < 15) return setTimeout(check, 100);
		if (typeof iCUE === "undefined") Icue.startPreview();
		App.start();
		Icue.checkPlugins();
	})();
})();
