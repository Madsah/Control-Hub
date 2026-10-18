/* Control Panel — Round 10: lots of ready-made pages, App search, and a page slideshow. */

var Round10 = (function () {
	var el = U.el, svg = U.svg, esc = U.esc, setText = U.setText, setHtml = U.setHtml;
	var types = T.types, helperGate = T.helperGate;

	function L() { return Editor.layout(); }
	function O() { var l = L(); return l.opts || (l.opts = {}); }

	/* ================================================================== ready-made pages */
	/* [type, x, y, w, h, cfg] on the Edge's usual 15 × 4 grid. Other sizes: scaled, then the nearest free spot. */
	/* Shortcut tiles for ready-made pages: apps are found by name on this PC the first time (see T.runShortcut). */
	var BROWSER = ["Google Chrome", "Brave", "Microsoft Edge", "Firefox", "Opera GX", "Opera"];
	function A(x, y, name, find, w, h, steam) { var c = { kind: "app", name: name, find: find || [name] }; if (steam) c.steam = steam; return ["shortcut", x, y, w || 1, h || 1, c]; }
	function Q(x, y, what, name) { return ["shortcut", x, y, 1, 1, { kind: "quick", what: what, name: name }]; }
	function W(x, y, name, url, domain) { return ["shortcut", x, y, 1, 1, { kind: "url", name: name, url: url, domain: domain }]; }

	var PAGES = [
		{ group: "Flight sim", name: "Flight planning", sub: "Your OFP, SimBrief, weather, scenery and day/night before you fly", theme: "cockpit", tiles: [
			["ofp", 0, 0, 5, 4], ["simbrief", 5, 0, 4, 2], ["metar", 9, 0, 3, 2], ["scenery", 12, 0, 3, 2],
			["routewx", 5, 2, 5, 2], ["daynight", 10, 2, 5, 1], ["fuelplan", 10, 3, 2, 1], ["flightmode", 12, 3, 3, 1]] },
		{ group: "Flight sim", name: "Approach and landing", sub: "Briefing, descent, frequencies, taxi map, checklist and landing grade", theme: "cockpit", auto: { phase: "approach", name: "Descent and approach" }, tiles: [
			["briefing", 0, 0, 5, 2], ["tod", 5, 0, 4, 1], ["fdash", 5, 1, 4, 1], ["freqs", 9, 0, 3, 2], ["landing", 12, 0, 3, 1], ["lreplay", 12, 1, 3, 2],
			["taxi", 0, 2, 5, 2], ["sifreqs", 5, 2, 4, 2], ["checklist", 9, 2, 3, 2], ["radio", 12, 3, 3, 1]] },
		{ group: "Flight sim", name: "Big map", sub: "A large live map with flight data, next waypoint and SayIntentions", theme: "midnight", tiles: [
			["flightmap", 0, 0, 6, 4], ["fdash", 6, 0, 4, 2], ["sayintentions", 10, 0, 5, 2], ["nextwpt", 6, 2, 9, 1],
			["tod", 6, 3, 4, 1], ["fuelchk", 10, 3, 3, 1], ["ftimer", 13, 3, 2, 1]] },
		{ group: "Flight sim", name: "Airline and logbook", sub: "Logbook, airports map, landing trend and airline stats", theme: "navy", tiles: [
			["logbook", 0, 0, 5, 4], ["logmap", 5, 0, 6, 3], ["flightlog", 5, 3, 6, 1], ["ldgtrend", 11, 0, 4, 2], ["fstats", 11, 2, 4, 2]] },
		{ group: "Flight sim", name: "Flight replay", sub: "Replay your last flight on a big map, with your landing", theme: "cockpit", tiles: [
			["freplay", 0, 0, 10, 4], ["lreplay", 10, 0, 5, 2], ["ldgtrend", 10, 2, 5, 2]] },
		{ group: "Games", name: "Gaming hub", sub: "Game covers, Steam friends and downloads, Discord, game modes and temperatures", theme: "neon", tiles: [
			["launcher", 0, 0, 8, 2], ["steam", 0, 2, 5, 2, { show: "games" }], ["flightmode", 5, 2, 3, 1], ["cs2mode", 5, 3, 3, 1],
			["steamdl", 8, 0, 4, 1], ["nowplaying", 12, 0, 3, 1], ["discord", 8, 1, 5, 2], ["fps", 13, 1, 2, 1], ["gameclean", 13, 2, 2, 1],
			["graph", 8, 3, 4, 1], ["tempalert", 12, 3, 3, 1]] },
		{ group: "Games", name: "Voice and streaming", sub: "Discord, push-to-talk, app volumes, sound profiles, mic test, on air and Twitch", theme: "midnight", tiles: [
			["discord", 0, 0, 5, 2], ["ptt", 0, 2, 2, 2], ["soundprof", 2, 2, 3, 1], ["mictest", 2, 3, 3, 1], ["mixer", 5, 0, 4, 4],
			["onair", 9, 0, 3, 1], ["micmeter", 12, 0, 3, 1], ["speakers", 9, 1, 3, 1], ["mic", 12, 1, 3, 1], ["twitch", 9, 2, 6, 2]] },
		{ group: "Music", name: "Spotify", sub: "The big player, recently played, search and save song", theme: "dark", tiles: [
			["spnow", 0, 0, 10, 4], ["sprecent", 10, 0, 5, 3], ["spsearch", 10, 3, 3, 1], ["spsave", 13, 3, 2, 1]] },
		{ group: "Everyday", name: "Work and focus", sub: "Calendar, note, Pomodoro, timers, copy board, files, Do Not Disturb and on air", theme: "nordic", tiles: [
			["calendar", 0, 0, 4, 4], ["notes", 4, 0, 3, 2], ["recentfiles", 4, 2, 4, 2], ["pomodoro", 7, 0, 3, 1], ["timer", 10, 0, 2, 1],
			["copyboard", 7, 1, 5, 1], ["downloads", 8, 2, 4, 2], ["worldclock", 12, 0, 3, 2], ["dnd", 12, 2, 1, 1], ["onair", 13, 2, 2, 1], ["clipboard", 12, 3, 3, 1]] },
		{ group: "Everyday", name: "Morning", sub: "Your day, weather, rain radar, news and the power price", theme: "nordic", tiles: [
			["dayview", 0, 0, 4, 2], ["weather", 4, 0, 5, 2], ["radar", 9, 0, 6, 4], ["news", 0, 2, 5, 2], ["elprice", 5, 2, 4, 2]] },
		{ group: "Everyday", name: "Tools", sub: "Calculator, currency, timer, stopwatch, countdown, note, doodle and world clock", theme: "teal", tiles: [
			["calc", 0, 0, 3, 4], ["currency", 3, 0, 4, 2], ["worldclock", 3, 2, 4, 2], ["timer", 7, 0, 3, 1], ["stopwatch", 10, 0, 3, 1], ["countdown", 13, 0, 2, 1],
			["notes", 7, 1, 4, 3], ["doodle", 11, 1, 4, 3]] },
		{ group: "Everyday", name: "Night clock", sub: "A big clock with weather and world time, dimmed for the evening", theme: "midnight", tiles: [
			["clock", 0, 0, 6, 3, { style: "flip" }], ["weather", 6, 0, 5, 3], ["worldclock", 11, 0, 4, 4], ["brightness", 0, 3, 6, 1], ["media", 6, 3, 5, 1]] },
		{ group: "PC", name: "PC monitor", sub: "Hardware dashboard, what's using your PC, health, disks, network and temperatures", theme: "dark", tiles: [
			["hwdash", 0, 0, 6, 2], ["pcusage", 6, 0, 6, 2], ["health", 12, 0, 3, 2], ["topapps", 0, 2, 3, 2], ["disk", 3, 2, 3, 2], ["storage", 6, 2, 3, 2],
			["ping", 9, 2, 3, 1], ["network", 9, 3, 3, 1], ["tempalert", 12, 2, 3, 1], ["uptime", 12, 3, 3, 1]] },
		{ group: "PC", name: "Desk", sub: "Window switcher, notifications, screenshots, downloads, sound and power", theme: "navy", tiles: [
			["windows", 0, 0, 4, 2], ["notifs", 4, 0, 4, 2], ["screenshots", 8, 0, 4, 2], ["output", 12, 0, 3, 1], ["keepawake", 12, 1, 1, 1], ["dnd", 13, 1, 1, 1], ["micstatus", 14, 1, 1, 1],
			["downloads", 0, 2, 4, 2], ["speakers", 4, 2, 4, 1], ["mic", 4, 3, 4, 1], ["appsearch", 8, 2, 4, 1], ["cleanup", 8, 3, 4, 1], ["power", 12, 2, 3, 2]] },
	];

	/* Flight mode / CS2 mode buttons on a ready-made page fill in their steps by themselves on first start. */
	function buttonCfg(name) {
		var tp = (Buttons.TEMPLATES || []).filter(function (x) { return x.name === name; })[0];
		if (!tp) return null;
		return { name: tp.name, look: JSON.parse(JSON.stringify(tp.look)), color: tp.color, mode: tp.mode || "press", steps: [], offSteps: [], pendingTemplate: tp.name };
	}
	var MODE_BUTTONS = { flightmode: "Flight mode", cs2mode: "CS2 mode" };

	/* Stretch tiles made for one grid (usually 15×4) to fill another. Edges are scaled, not sizes,
	   so tiles that touched still touch and nothing is left empty. */
	function fit(tiles, fromCols, fromRows) {
		var g = Editor.gridInfo() || { cols: 15, rows: 4 };
		fromCols = fromCols || 15; fromRows = fromRows || 4;
		if (g.cols === fromCols && g.rows === fromRows) return tiles;
		var fx = g.cols / fromCols, fy = g.rows / fromRows;
		return tiles.map(function (t) {
			var def = T.types[t.type] || {}, c = JSON.parse(JSON.stringify(t));
			var x0 = Math.round(t.x * fx), x1 = Math.round((t.x + t.w) * fx), y0 = Math.round(t.y * fy), y1 = Math.round((t.y + t.h) * fy);
			c.x = x0; c.y = y0;
			c.w = U.clamp(Math.max(1, x1 - x0), def.minW || 1, def.maxW || 40);
			c.h = U.clamp(Math.max(1, y1 - y0), def.minH || 1, def.maxH || 24);
			return c;
		});
	}

	function build(spec) {
		var tiles = [];
		spec.tiles.forEach(function (a) {
			var def = T.types[a[0]];
			if (!def) return;
			var t = Editor.makeTile(a[0], a[3], a[4], a[5] ? JSON.parse(JSON.stringify(a[5])) : undefined);
			if (!a[5] && def.defaults) t.cfg = def.defaults();
			if (MODE_BUTTONS[a[0]]) t.cfg = buttonCfg(MODE_BUTTONS[a[0]]) || t.cfg;
			t.x = a[1]; t.y = a[2];
			tiles.push(t);
		});
		return { name: spec.name, theme: spec.theme || "", auto: spec.auto || null, tiles: fit(tiles, 15, 4) };
	}


	/* "My Home" pages, each with its own tile size (big Extra large, or Medium), so they look the same on any panel. */
	var MY_HOME = [{"name":"My Home","sub":"Extra large tiles · Spotify and Discord on the right, Spotify volume, clock and power","theme":"navy","size":"huge","grid":{"cols":12,"rows":3},"tiles":[{"type":"clock","x":0,"y":0,"w":3,"h":1,"cfg":{"style":"flip"}},{"type":"weather","x":3,"y":0,"w":3,"h":1,"cfg":{"name":"Copenhagen","lat":55.6759,"lon":12.5655}},{"type":"shortcut","x":0,"y":1,"w":1,"h":1,"cfg":{"kind":"app","name":"Discord","find":["Discord"]}},{"type":"shortcut","x":1,"y":1,"w":1,"h":1,"cfg":{"kind":"app","name":"Spotify","find":["Spotify"]}},{"type":"shortcut","x":2,"y":1,"w":1,"h":1,"cfg":{"kind":"app","name":"Steam","find":["Steam"]}},{"type":"shortcut","x":3,"y":1,"w":1,"h":1,"cfg":{"kind":"app","name":"Browser","find":["Google Chrome","Brave","Microsoft Edge","Firefox","Opera GX","Opera"]}},{"type":"shortcut","x":4,"y":1,"w":1,"h":1,"cfg":{"kind":"quick","what":"explorer","name":"File Explorer"}},{"type":"shortcut","x":5,"y":1,"w":1,"h":1,"cfg":{"kind":"quick","what":"settings","name":"Settings"}},{"type":"launcher","x":0,"y":2,"w":4,"h":1,"cfg":{}},{"type":"power","x":4,"y":2,"w":2,"h":1,"cfg":{}},{"type":"spotify","x":6,"y":0,"w":3,"h":2,"cfg":{}},{"type":"discord","x":9,"y":0,"w":3,"h":2,"cfg":{}},{"type":"spvolume","x":6,"y":2,"w":3,"h":1,"cfg":{"vertical":false}},{"type":"speakers","x":9,"y":2,"w":3,"h":1,"cfg":{}}]},{"name":"My Home · Big","sub":"Extra large tiles · Spotify and Discord on the right, Spotify volume, clock and power","theme":"dark","size":"huge","grid":{"cols":12,"rows":3},"tiles":[{"type":"clock","x":0,"y":0,"w":5,"h":1,"cfg":{"style":"flip"}},{"type":"weather","x":0,"y":1,"w":3,"h":1,"cfg":{"name":"Copenhagen","lat":55.6759,"lon":12.5655}},{"type":"dnd","x":3,"y":1,"w":1,"h":1,"cfg":{}},{"type":"keepawake","x":4,"y":1,"w":1,"h":1,"cfg":{}},{"type":"power","x":0,"y":2,"w":3,"h":1,"cfg":{}},{"type":"appsearch","x":3,"y":2,"w":2,"h":1,"cfg":{}},{"type":"spotify","x":5,"y":0,"w":4,"h":2,"cfg":{}},{"type":"discord","x":9,"y":0,"w":3,"h":2,"cfg":{}},{"type":"spvolume","x":5,"y":2,"w":4,"h":1,"cfg":{"vertical":false}},{"type":"speakers","x":9,"y":2,"w":3,"h":1,"cfg":{}}]},{"name":"My Home · Clean","sub":"Extra large tiles · Spotify and Discord on the right, Spotify volume, clock and power","theme":"midnight","size":"huge","grid":{"cols":12,"rows":3},"tiles":[{"type":"clock","x":0,"y":0,"w":4,"h":2,"cfg":{"style":"flip"}},{"type":"power","x":0,"y":2,"w":4,"h":1,"cfg":{}},{"type":"spotify","x":4,"y":0,"w":4,"h":2,"cfg":{}},{"type":"discord","x":8,"y":0,"w":4,"h":2,"cfg":{}},{"type":"spvolume","x":4,"y":2,"w":4,"h":1,"cfg":{"vertical":false}},{"type":"speakers","x":8,"y":2,"w":4,"h":1,"cfg":{}}]},{"name":"My Home · Apps","sub":"Extra large tiles · Spotify and Discord on the right, Spotify volume, clock and power","theme":"teal","size":"huge","grid":{"cols":12,"rows":3},"tiles":[{"type":"shortcut","x":0,"y":0,"w":1,"h":1,"cfg":{"kind":"app","name":"Discord","find":["Discord"]}},{"type":"shortcut","x":1,"y":0,"w":1,"h":1,"cfg":{"kind":"app","name":"Spotify","find":["Spotify"]}},{"type":"shortcut","x":2,"y":0,"w":1,"h":1,"cfg":{"kind":"app","name":"Steam","find":["Steam"]}},{"type":"shortcut","x":3,"y":0,"w":1,"h":1,"cfg":{"kind":"app","name":"Browser","find":["Google Chrome","Brave","Microsoft Edge","Firefox","Opera GX","Opera"]}},{"type":"shortcut","x":4,"y":0,"w":1,"h":1,"cfg":{"kind":"app","name":"OBS","find":["OBS Studio"]}},{"type":"shortcut","x":5,"y":0,"w":1,"h":1,"cfg":{"kind":"app","name":"iCUE","find":["iCUE","CORSAIR iCUE"]}},{"type":"shortcut","x":0,"y":1,"w":1,"h":1,"cfg":{"kind":"quick","what":"explorer","name":"File Explorer"}},{"type":"shortcut","x":1,"y":1,"w":1,"h":1,"cfg":{"kind":"quick","what":"settings","name":"Settings"}},{"type":"shortcut","x":2,"y":1,"w":1,"h":1,"cfg":{"kind":"quick","what":"taskmanager","name":"Task Manager"}},{"type":"shortcut","x":3,"y":1,"w":1,"h":1,"cfg":{"kind":"quick","what":"calculator","name":"Calculator"}},{"type":"shortcut","x":4,"y":1,"w":1,"h":1,"cfg":{"kind":"quick","what":"screenshot","name":"Screenshot"}},{"type":"shortcut","x":5,"y":1,"w":1,"h":1,"cfg":{"kind":"quick","what":"sound","name":"Sound"}},{"type":"clock","x":0,"y":2,"w":2,"h":1,"cfg":{}},{"type":"weather","x":2,"y":2,"w":2,"h":1,"cfg":{"name":"Copenhagen","lat":55.6759,"lon":12.5655}},{"type":"power","x":4,"y":2,"w":2,"h":1,"cfg":{}},{"type":"spotify","x":6,"y":0,"w":3,"h":2,"cfg":{}},{"type":"discord","x":9,"y":0,"w":3,"h":2,"cfg":{}},{"type":"spvolume","x":6,"y":2,"w":3,"h":1,"cfg":{"vertical":false}},{"type":"speakers","x":9,"y":2,"w":3,"h":1,"cfg":{}}]},{"name":"My Home","sub":"Medium tiles · Spotify and Discord on the right, Spotify volume, clock and power","theme":"navy","size":"medium","grid":{"cols":19,"rows":5},"tiles":[{"type":"clock","x":0,"y":0,"w":4,"h":2,"cfg":{"style":"flip"}},{"type":"weather","x":4,"y":0,"w":4,"h":2,"cfg":{"name":"Copenhagen","lat":55.6759,"lon":12.5655}},{"type":"dnd","x":8,"y":0,"w":2,"h":1,"cfg":{}},{"type":"keepawake","x":8,"y":1,"w":2,"h":1,"cfg":{}},{"type":"shortcut","x":0,"y":2,"w":1,"h":1,"cfg":{"kind":"app","name":"Discord","find":["Discord"]}},{"type":"shortcut","x":1,"y":2,"w":1,"h":1,"cfg":{"kind":"app","name":"Spotify","find":["Spotify"]}},{"type":"shortcut","x":2,"y":2,"w":1,"h":1,"cfg":{"kind":"app","name":"Steam","find":["Steam"]}},{"type":"shortcut","x":3,"y":2,"w":1,"h":1,"cfg":{"kind":"app","name":"Browser","find":["Google Chrome","Brave","Microsoft Edge","Firefox","Opera GX","Opera"]}},{"type":"shortcut","x":4,"y":2,"w":1,"h":1,"cfg":{"kind":"app","name":"OBS","find":["OBS Studio"]}},{"type":"shortcut","x":5,"y":2,"w":1,"h":1,"cfg":{"kind":"quick","what":"explorer","name":"File Explorer"}},{"type":"shortcut","x":6,"y":2,"w":1,"h":1,"cfg":{"kind":"quick","what":"settings","name":"Settings"}},{"type":"shortcut","x":7,"y":2,"w":1,"h":1,"cfg":{"kind":"quick","what":"taskmanager","name":"Task Manager"}},{"type":"shortcut","x":8,"y":2,"w":1,"h":1,"cfg":{"kind":"quick","what":"calculator","name":"Calculator"}},{"type":"shortcut","x":9,"y":2,"w":1,"h":1,"cfg":{"kind":"quick","what":"screenshot","name":"Screenshot"}},{"type":"launcher","x":0,"y":3,"w":6,"h":2,"cfg":{}},{"type":"power","x":6,"y":3,"w":4,"h":2,"cfg":{}},{"type":"spotify","x":10,"y":0,"w":5,"h":3,"cfg":{}},{"type":"discord","x":15,"y":0,"w":4,"h":3,"cfg":{}},{"type":"spvolume","x":10,"y":3,"w":5,"h":1,"cfg":{"vertical":false}},{"type":"speakers","x":10,"y":4,"w":5,"h":1,"cfg":{}},{"type":"mic","x":15,"y":3,"w":4,"h":1,"cfg":{}},{"type":"output","x":15,"y":4,"w":4,"h":1,"cfg":{}}]},{"name":"My Home · Big","sub":"Medium tiles · Spotify and Discord on the right, Spotify volume, clock and power","theme":"dark","size":"medium","grid":{"cols":19,"rows":5},"tiles":[{"type":"clock","x":0,"y":0,"w":6,"h":2,"cfg":{"style":"flip"}},{"type":"weather","x":6,"y":0,"w":2,"h":2,"cfg":{"name":"Copenhagen","lat":55.6759,"lon":12.5655}},{"type":"dnd","x":0,"y":2,"w":2,"h":1,"cfg":{}},{"type":"keepawake","x":2,"y":2,"w":2,"h":1,"cfg":{}},{"type":"appsearch","x":4,"y":2,"w":4,"h":1,"cfg":{}},{"type":"power","x":0,"y":3,"w":4,"h":2,"cfg":{}},{"type":"dayview","x":4,"y":3,"w":4,"h":2,"cfg":{}},{"type":"spotify","x":8,"y":0,"w":6,"h":3,"cfg":{}},{"type":"discord","x":14,"y":0,"w":5,"h":3,"cfg":{}},{"type":"spvolume","x":8,"y":3,"w":6,"h":1,"cfg":{"vertical":false}},{"type":"speakers","x":8,"y":4,"w":3,"h":1,"cfg":{}},{"type":"output","x":11,"y":4,"w":3,"h":1,"cfg":{}},{"type":"mic","x":14,"y":3,"w":5,"h":1,"cfg":{}},{"type":"micmeter","x":14,"y":4,"w":5,"h":1,"cfg":{}}]},{"name":"My Home · Clean","sub":"Medium tiles · Spotify and Discord on the right, Spotify volume, clock and power","theme":"midnight","size":"medium","grid":{"cols":19,"rows":5},"tiles":[{"type":"clock","x":0,"y":0,"w":6,"h":3,"cfg":{"style":"flip"}},{"type":"power","x":0,"y":3,"w":4,"h":2,"cfg":{}},{"type":"dnd","x":4,"y":3,"w":2,"h":1,"cfg":{}},{"type":"keepawake","x":4,"y":4,"w":2,"h":1,"cfg":{}},{"type":"spotify","x":6,"y":0,"w":6,"h":3,"cfg":{}},{"type":"discord","x":12,"y":0,"w":6,"h":3,"cfg":{}},{"type":"micstatus","x":18,"y":0,"w":1,"h":2,"cfg":{}},{"type":"ptt","x":18,"y":2,"w":1,"h":1,"cfg":{"combo":"","mode":"hold","label":""}},{"type":"spvolume","x":6,"y":3,"w":6,"h":1,"cfg":{"vertical":false}},{"type":"speakers","x":6,"y":4,"w":6,"h":1,"cfg":{}},{"type":"mic","x":12,"y":3,"w":4,"h":1,"cfg":{}},{"type":"output","x":12,"y":4,"w":4,"h":1,"cfg":{}},{"type":"weather","x":16,"y":3,"w":3,"h":2,"cfg":{"name":"Copenhagen","lat":55.6759,"lon":12.5655}}]},{"name":"My Home · Apps","sub":"Medium tiles · Spotify and Discord on the right, Spotify volume, clock and power","theme":"teal","size":"medium","grid":{"cols":19,"rows":5},"tiles":[{"type":"shortcut","x":0,"y":0,"w":1,"h":1,"cfg":{"kind":"app","name":"Discord","find":["Discord"]}},{"type":"shortcut","x":1,"y":0,"w":1,"h":1,"cfg":{"kind":"app","name":"Spotify","find":["Spotify"]}},{"type":"shortcut","x":2,"y":0,"w":1,"h":1,"cfg":{"kind":"app","name":"Steam","find":["Steam"]}},{"type":"shortcut","x":3,"y":0,"w":1,"h":1,"cfg":{"kind":"app","name":"Browser","find":["Google Chrome","Brave","Microsoft Edge","Firefox","Opera GX","Opera"]}},{"type":"shortcut","x":4,"y":0,"w":1,"h":1,"cfg":{"kind":"app","name":"Flight Sim","find":["Microsoft Flight Simulator 2024","Microsoft Flight Simulator"],"steam":"2537590"}},{"type":"shortcut","x":5,"y":0,"w":1,"h":1,"cfg":{"kind":"app","name":"CS2","find":["Counter-Strike 2"],"steam":"730"}},{"type":"shortcut","x":6,"y":0,"w":1,"h":1,"cfg":{"kind":"app","name":"OBS","find":["OBS Studio"]}},{"type":"shortcut","x":7,"y":0,"w":1,"h":1,"cfg":{"kind":"app","name":"iCUE","find":["iCUE","CORSAIR iCUE"]}},{"type":"shortcut","x":0,"y":1,"w":1,"h":1,"cfg":{"kind":"quick","what":"explorer","name":"File Explorer"}},{"type":"shortcut","x":1,"y":1,"w":1,"h":1,"cfg":{"kind":"quick","what":"settings","name":"Settings"}},{"type":"shortcut","x":2,"y":1,"w":1,"h":1,"cfg":{"kind":"quick","what":"taskmanager","name":"Task Manager"}},{"type":"shortcut","x":3,"y":1,"w":1,"h":1,"cfg":{"kind":"quick","what":"calculator","name":"Calculator"}},{"type":"shortcut","x":4,"y":1,"w":1,"h":1,"cfg":{"kind":"quick","what":"screenshot","name":"Screenshot"}},{"type":"shortcut","x":5,"y":1,"w":1,"h":1,"cfg":{"kind":"quick","what":"sound","name":"Sound"}},{"type":"shortcut","x":6,"y":1,"w":1,"h":1,"cfg":{"kind":"url","name":"SimBrief","url":"https://dispatch.simbrief.com","domain":"simbrief.com"}},{"type":"shortcut","x":7,"y":1,"w":1,"h":1,"cfg":{"kind":"url","name":"Navigraph","url":"https://charts.navigraph.com","domain":"navigraph.com"}},{"type":"shortcut","x":0,"y":2,"w":1,"h":1,"cfg":{"kind":"url","name":"YouTube","url":"https://www.youtube.com","domain":"youtube.com"}},{"type":"shortcut","x":1,"y":2,"w":1,"h":1,"cfg":{"kind":"url","name":"Twitch","url":"https://www.twitch.tv","domain":"twitch.tv"}},{"type":"shortcut","x":2,"y":2,"w":1,"h":1,"cfg":{"kind":"url","name":"Gmail","url":"https://mail.google.com","domain":"mail.google.com"}},{"type":"shortcut","x":3,"y":2,"w":1,"h":1,"cfg":{"kind":"url","name":"Netflix","url":"https://www.netflix.com","domain":"netflix.com"}},{"type":"shortcut","x":4,"y":2,"w":1,"h":1,"cfg":{"kind":"url","name":"Flightradar24","url":"https://www.flightradar24.com","domain":"flightradar24.com"}},{"type":"shortcut","x":5,"y":2,"w":1,"h":1,"cfg":{"kind":"quick","what":"desktop","name":"Desktop"}},{"type":"shortcut","x":6,"y":2,"w":1,"h":1,"cfg":{"kind":"quick","what":"lock","name":"Lock PC"}},{"type":"appsearch","x":7,"y":2,"w":1,"h":1,"cfg":{}},{"type":"weather","x":8,"y":0,"w":2,"h":2,"cfg":{"name":"Copenhagen","lat":55.6759,"lon":12.5655}},{"type":"dnd","x":8,"y":2,"w":1,"h":1,"cfg":{}},{"type":"keepawake","x":9,"y":2,"w":1,"h":1,"cfg":{}},{"type":"clock","x":0,"y":3,"w":4,"h":2,"cfg":{}},{"type":"power","x":4,"y":3,"w":4,"h":2,"cfg":{}},{"type":"launcher","x":8,"y":3,"w":2,"h":2,"cfg":{}},{"type":"spotify","x":10,"y":0,"w":5,"h":3,"cfg":{}},{"type":"discord","x":15,"y":0,"w":4,"h":3,"cfg":{}},{"type":"spvolume","x":10,"y":3,"w":5,"h":1,"cfg":{"vertical":false}},{"type":"speakers","x":10,"y":4,"w":5,"h":1,"cfg":{}},{"type":"mic","x":15,"y":3,"w":4,"h":1,"cfg":{}},{"type":"output","x":15,"y":4,"w":4,"h":1,"cfg":{}}]}];

	function presets() {
		return PAGES.map(function (p) { return { group: p.group, name: p.name, sub: p.sub, make: function () { return build(p); } }; })
			.concat(MY_HOME.map(function (p) {
				return { group: "My Home", name: p.name, sub: p.sub, make: function () { return JSON.parse(JSON.stringify({ name: p.name, theme: p.theme, size: p.size, grid: p.grid, tiles: p.tiles })); } };
			}));
	}

	/* ================================================================== App search (apps, Steam games, files) */
	var steamList = null, filesList = null;
	function gather() {
		var jobs = [Helper.loadApps(false).then(null, function () { return []; })];
		jobs.push(steamList ? Promise.resolve(steamList) : Helper.fetch("/api/steam", { cache: "no-store" }, 20000).then(function (r) { return (steamList = (r && r.games) || []); }, function () { return []; }));
		var newHelper = (function () { var v = String(Helper.state.version || ""); var m = /^(\d+)\.(\d+)/.exec(v); return v === "mock" || (m && (+m[1] > 2 || (+m[1] === 2 && +m[2] >= 4))); })();
		jobs.push(!newHelper ? Promise.resolve([]) : Promise.all([
			Helper.fetch("/api/files?which=recent", { cache: "no-store" }, 10000).then(function (r) { return (r && r.items) || []; }, function () { return []; }),
			Helper.fetch("/api/files?which=downloads", { cache: "no-store" }, 10000).then(function (r) { return (r && r.items) || []; }, function () { return []; }),
		]).then(function (a) { return (filesList = a[0].concat(a[1])); }));
		return Promise.all(jobs);
	}
	var SETTINGS = [
		["Sound settings", "ms-settings:sound"], ["Display settings", "ms-settings:display"], ["Bluetooth", "ms-settings:bluetooth"], ["Windows Update", "ms-settings:windowsupdate"],
		["Apps", "ms-settings:appsfeatures"], ["Wi-Fi and network", "ms-settings:network-status"], ["Storage", "ms-settings:storagesense"], ["Notifications", "ms-settings:notifications"],
		["Mouse", "ms-settings:mousetouchpad"], ["Power and battery", "ms-settings:powersleep"], ["Default apps", "ms-settings:defaultapps"], ["Graphics", "ms-settings:display-advancedgraphics"],
	];
	function score(name, q) {
		var n = name.toLowerCase();
		if (n === q) return 100;
		if (n.indexOf(q) === 0) return 80;
		if (n.split(/[\s\-_.]+/).some(function (w) { return w.indexOf(q) === 0; })) return 60;
		if (n.indexOf(q) >= 0) return 40;
		// Letters in order ("msfs" → "Microsoft Flight Simulator").
		var i = 0;
		for (var k = 0; k < n.length && i < q.length; k++) if (n[k] === q[i]) i++;
		var initials = n.split(/[\s\-_.]+/).map(function (w) { return w[0] || ""; }).join("");
		if (initials.indexOf(q) === 0) return 50;
		return i === q.length && q.length >= 3 ? 15 : 0;
	}
	function searchWindow() {
		if (!Helper.online) return U.toast("Start Control Hub for this");
		var w = el("div", "sps aps");
		w.innerHTML = '<div class="sps-left"><div class="sps-bar"><span class="sps-ic aps-ic">' + svg("search") + '</span><input class="sps-in" placeholder="App, game, file or setting" /></div></div><div class="sps-res"></div>';
		var inp = w.querySelector(".sps-in"), res = w.querySelector(".sps-res"), left = w.querySelector(".sps-left");
		U.dragScroll(res);
		var data = { apps: [], games: [], files: [] };
		function results(q) {
			q = (q || "").trim().toLowerCase();
			var out = [];
			function add(kind, name, sub, item, icon, extra) { var s = q ? score(name, q) + (extra || 0) : 0; if (!q || s > 0) out.push({ kind: kind, name: name, sub: sub, item: item, icon: icon, s: s }); }
			data.apps.forEach(function (a) { add(a.kind === "url" ? "web" : "app", a.name, a.kind === "url" ? "Website" : a.kind === "file" ? "Added by you" : "App", a, a.icon, 5); });
			data.games.forEach(function (g) { add("steam", g.name, "Steam game", g, null, 8); });
			data.files.forEach(function (f) { add("file", f.name, f.folder ? "Folder" : "File", f, f.icon, 0); });
			SETTINGS.forEach(function (s) { add("setting", s[0], "Windows setting", s, null, 0); });
			if (!q) {
				// Nothing typed: your most used games first, then apps.
				out = out.filter(function (x) { return x.kind === "steam" || x.kind === "app"; }).slice(0, 14);
			}
			out.sort(function (a, b) { return b.s - a.s; });
			return out.slice(0, 24);
		}
		function draw() {
			var list = results(inp.value);
			res.innerHTML = "";
			if (!list.length) { res.innerHTML = '<div class="notice small"><span>Nothing found</span></div>'; return; }
			list.forEach(function (x) {
				var r = el("button", "aps-row");
				r.innerHTML = '<span class="aps-art"></span><span class="spr-tx"><b></b><em></em></span>';
				r.querySelector("b").textContent = x.name;
				r.querySelector("em").textContent = x.sub;
				var art = r.querySelector(".aps-art");
				if (x.kind === "steam") art.innerHTML = '<img alt="" src="https://cdn.cloudflare.steamstatic.com/steam/apps/' + esc(x.item.id) + '/capsule_184x69.jpg" onerror="this.remove()" />';
				else if (x.kind === "setting") art.innerHTML = svg("settings");
				else Round6.iconInto(art, x.icon, x.kind === "web" ? "globe" : x.kind === "file" ? "note" : "apps");
				r.addEventListener("click", function () { open(x); });
				res.appendChild(r);
			});
		}
		function open(x) {
			var body = x.kind === "steam" ? { action: "steamRun", id: x.item.id } : x.kind === "file" ? { action: "fileOpen", id: x.item.id } : x.kind === "setting" ? { action: "openSettings", page: x.item[1] } : { action: "launch", id: x.item.id };
			Helper.act(body, true).then(function (ok) { U.toast(ok ? "Opening " + x.name : "Couldn't open " + x.name); if (ok) Editor.closeModal(); });
		}
		left.appendChild(Round8b.keyboard(inp, draw, function () { var l = results(inp.value); if (l[0]) open(l[0]); }, "Open"));
		Editor.modal("Search", w);
		res.innerHTML = '<div class="notice small"><span>Loading your apps and games…</span></div>';
		gather().then(function (a) { data.apps = a[0] || []; data.games = a[1] || []; data.files = a[2] || []; draw(); });
	}
	types.appsearch = {
		name: "App search", desc: "Find and open apps, Steam games, files and settings with the on-screen keyboard", icon: "search", group: "shortcuts", helper: true,
		w: 2, h: 1, minW: 1, minH: 1, maxW: 4, maxH: 2,
		build: function (ctx) {
			ctx.node.classList.add("press");
			ctx.node.addEventListener("click", function () { if (!App.editing) searchWindow(); });
			ctx.body.innerHTML = '<div class="sps1"><span class="sps1-ic aps-ic">' + svg("search") + '</span><span class="sps1-tx"><b>Search</b><em>Apps, games, files</em></span></div>';
			return function () {};
		},
	};

	/* ================================================================== page slideshow */
	/* While nobody touches the panel, the pages you pick take turns (stops on the first touch; not while a game page is up). */
	var show = { idleT: null, stepT: null, running: false, idx: 0 };
	function cfg() { return O().slideshow || {}; }
	function stopShow() {
		clearTimeout(show.idleT);
		clearInterval(show.stepT);
		show.stepT = null;
		show.running = false;
		document.body.classList.remove("slideshow");
	}
	function canShow() {
		var gaming = Pages._auto && Pages._auto().active;
		return !App.editing && !gaming && document.getElementById("modal").hidden && !(typeof Look !== "undefined" && Look.sleeping);
	}
	function step() {
		var c = cfg(), l = L();
		var ids = (c.pages || []).filter(function (id) { return l.pages.some(function (p) { return p.id === id; }); });
		if (ids.length < 1 || !canShow()) return;
		var curId = l.pages[l.current] && l.pages[l.current].id;
		var at = ids.indexOf(curId);
		var nextId = ids[(at + 1) % ids.length];
		for (var i = 0; i < l.pages.length; i++) if (l.pages[i].id === nextId && i !== l.current) { Editor.goPage(i, "auto"); break; }
	}
	function armShow() {
		stopShow();
		var c = cfg();
		if (!c.on || !(c.pages || []).length) return;
		show.idleT = setTimeout(function () {
			if (!canShow()) return armShow();
			show.running = true;
			document.body.classList.add("slideshow");
			step();
			show.stepT = setInterval(step, Math.max(5, +c.secs || 20) * 1000);
		}, Math.max(0.5, +c.after || 2) * 60000);
	}
	document.addEventListener("pointerdown", function () { if (show.running) stopShow(); armShow(); }, true);

	/* Look window section (called by Round 8's Look window). */
	function lookSection(sec, chooser, toggleRow, again) {
		var c = cfg();
		var s = sec("Slideshow", "When you haven't touched the panel for a while, the pages you pick take turns. The first touch stops it. Not during a game.");
		toggleRow(s, !!c.on, "Slideshow when the panel is idle", function () { O().slideshow = Object.assign({}, c, { on: !c.on }); Editor.save(); armShow(); again(); });
		if (!c.on) return;
		chooser(s, [[1, "Start after 1 min"], [2, "2 min"], [5, "5 min"], [10, "10 min"]], +c.after || 2, function (v) { O().slideshow = Object.assign({}, c, { after: v }); Editor.save(); armShow(); again(); });
		chooser(s, [[10, "New page every 10 s"], [20, "20 s"], [30, "30 s"], [60, "1 min"], [300, "5 min"]], +c.secs || 20, function (v) { O().slideshow = Object.assign({}, c, { secs: v }); Editor.save(); armShow(); again(); });
		var ch = el("div", "chips");
		L().pages.forEach(function (p) {
			var on = (c.pages || []).indexOf(p.id) >= 0;
			var b = el("button", "chip" + (on ? " on" : ""), esc(p.name));
			b.addEventListener("click", function () {
				var list = (c.pages || []).slice();
				if (on) list.splice(list.indexOf(p.id), 1); else list.push(p.id);
				O().slideshow = Object.assign({}, c, { pages: list });
				Editor.save();
				armShow();
				again();
			});
			ch.appendChild(b);
		});
		s.appendChild(ch);
		if (!(c.pages || []).length) s.appendChild(el("p", "hint", "Tap the pages that should take turns."));
	}

	setTimeout(armShow, 3000);

	return {
		presets: presets,
		fit: fit,
		lookSection: lookSection,
		searchWindow: searchWindow,
		_score: score,
		_pages: PAGES,
	};
})();
