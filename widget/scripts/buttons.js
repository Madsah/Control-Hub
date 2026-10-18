/* Control Panel — custom buttons.
 * A button runs one or more steps: open apps or links, press key combos, set volume,
 * switch audio output, keep awake, power plan, media keys, wait.
 * "On/Off" buttons run one list of steps when switched on and another when switched off.
 */

var Buttons = (function () {
	var el = U.el, svg = U.svg, esc = U.esc;

	var COLORS = ["#2BB3A3", "#3B82F6", "#5865F2", "#8B5CF6", "#EC4899", "#EF4444", "#F97316", "#F59E0B", "#22C55E", "#0EA5E9", "#64748B", "#1F2937"];
	var GLYPHS = ["bolt", "headset", "micOff", "mic", "speaker", "speakerOff", "gamepad", "rocket", "record", "clip", "stream", "camera", "screenshot",
		"keyboard", "music", "list", "chat", "moon", "sun", "lock", "power", "restart", "plane", "trophy", "star", "heart", "home", "folder", "globe", "settings", "crosshair", "wand", "bell", "radar"];

	/* ------------------------------------------------------------------ key presets */
	var KEY_PRESETS = [
		["Discord: mute mic", "Ctrl+Shift+M"],
		["Discord: deafen", "Ctrl+Shift+D"],
		["Game Bar: save last 30 s", "Win+Alt+G"],
		["Game Bar: record on/off", "Win+Alt+R"],
		["Game Bar: screenshot", "Win+Alt+PrintScreen"],
		["Game Bar: open", "Win+G"],
		["NVIDIA: save replay", "Alt+F10"],
		["NVIDIA: record on/off", "Alt+F9"],
		["NVIDIA: overlay", "Alt+Z"],
		["OBS: record (set in OBS)", "Ctrl+Shift+F9"],
		["OBS: stream (set in OBS)", "Ctrl+Shift+F10"],
		["Snipping tool", "Win+Shift+S"],
		["Show desktop", "Win+D"],
		["Task Manager", "Ctrl+Shift+Esc"],
		["Switch window", "Alt+Tab"],
		["Close window", "Alt+F4"],
		["Copy", "Ctrl+C"],
		["Paste", "Ctrl+V"],
		["Play / pause", "MediaPlayPause"],
		["Next track", "MediaNext"],
	];

	/* ------------------------------------------------------------------ templates */
	function k(combo) { return { type: "keys", combo: combo }; }
	var TEMPLATES = [
		{ name: "Discord mute", desc: "Mute on/off (Discord connected)", look: { kind: "glyph", name: "micOff" }, color: "#5865F2", steps: [{ type: "discord", what: "mute" }] },
		{ name: "Discord deafen", desc: "Deafen on/off (Discord connected)", look: { kind: "glyph", name: "headset" }, color: "#5865F2", steps: [{ type: "discord", what: "deaf" }] },
		{ name: "Save clip", desc: "Game Bar: last 30 seconds", look: { kind: "glyph", name: "clip" }, color: "#22C55E", steps: [k("Win+Alt+G")] },
		{ name: "Record", desc: "Game Bar: record on/off", look: { kind: "glyph", name: "record" }, color: "#EF4444", steps: [k("Win+Alt+R")] },
		{ name: "NVIDIA clip", desc: "Save instant replay (Alt+F10)", look: { kind: "glyph", name: "clip" }, color: "#76B900", steps: [k("Alt+F10")] },
		{ name: "OBS record", desc: "Ctrl+Shift+F9 (set the same key in OBS)", look: { kind: "glyph", name: "record" }, color: "#302E31", steps: [k("Ctrl+Shift+F9")] },
		{ name: "OBS stream", desc: "Ctrl+Shift+F10 (set the same key in OBS)", look: { kind: "glyph", name: "stream" }, color: "#8B5CF6", steps: [k("Ctrl+Shift+F10")] },
		{
			name: "Game mode", desc: "On/off: keep awake + high performance", look: { kind: "glyph", name: "gamepad" }, color: "#F97316", mode: "toggle",
			steps: [{ type: "keepAwake", value: true }, { type: "powerPlan", plan: "high" }],
			offSteps: [{ type: "keepAwake", value: false }, { type: "powerPlan", plan: "balanced" }],
		},
		{ name: "Gaming volume", desc: "Speakers 70%, mic on", look: { kind: "glyph", name: "gamepad" }, color: "#3B82F6", steps: [{ type: "volume", mic: false, device: "", value: 70 }, { type: "mute", mic: true, device: "", mode: "off" }] },
		{ name: "Discord call", desc: "Speakers 45%, mic on", look: { kind: "glyph", name: "chat" }, color: "#5865F2", steps: [{ type: "volume", mic: false, device: "", value: 45 }, { type: "mute", mic: true, device: "", mode: "off" }] },
		{ name: "Night", desc: "Speakers 20%, mic muted", look: { kind: "glyph", name: "moon" }, color: "#1F2937", steps: [{ type: "volume", mic: false, device: "", value: 20 }, { type: "mute", mic: true, device: "", mode: "on" }] },
		{ name: "Start my apps", desc: "Opens several apps at once", look: { kind: "glyph", name: "rocket" }, color: "#2BB3A3", steps: [], startWith: "launch" },
		{ name: "Spotify playlist", desc: "Add the link in Control Hub first", look: { kind: "glyph", name: "music" }, color: "#1DB954", steps: [], startWith: "url" },
		{
			name: "Flight mode", desc: "On: MSFS, SimBrief, SayIntentions, Do Not Disturb, headphones, flight page. Off: back to normal", look: { kind: "glyph", name: "plane" }, color: "#0EA5E9", mode: "toggle",
			make: function () { return flightSteps(); },
		},
		{
			name: "CS2 mode", desc: "On: start CS2, Do Not Disturb, high performance, CS2 page. Off: back to normal", look: { kind: "glyph", name: "crosshair" }, color: "#F59E0B", mode: "toggle",
			make: function () { return withOutputs().then(cs2Steps); },
		},
	];

	/* Suggested Flight mode steps, from what's installed on this PC. */
	function headsetOut() {
		return T.endpoints(false).filter(function (d) { return /head|ear|buds|arctis|hyperx|virtuoso|void|hs\d|wireless/i.test(d.name || ""); })[0];
	}
	function pageFor(re, nameRe) {
		var pages = Editor.layout().pages;
		return pages.filter(function (p) { return p.auto && re.test(p.auto.exe || ""); })[0] || pages.filter(function (p) { return nameRe.test(p.name); })[0];
	}
	function flightSteps() {
		var load = Helper.online ? Helper.loadApps(false).then(null, function () { return []; }) : Promise.resolve([]);
		return withOutputs().then(function () { return load; }).then(function (apps) {
			function app(re) { return (apps || []).filter(function (a) { return a.kind !== "url" && re.test(a.name); })[0]; }
			var on = [{ type: "remember" }];
			var msfs = app(/flight simulator 2024/i) || app(/flight simulator/i);
			if (msfs) on.push({ type: "launch", id: msfs.id, name: msfs.name, icon: msfs.icon });
			on.push({ type: "url", url: "https://dispatch.simbrief.com/home", name: "SimBrief", id: "" });
			var si = app(/sayintentions/i);
			if (si) on.push({ type: "launch", id: si.id, name: si.name, icon: si.icon });
			on.push({ type: "dnd", value: true });
			var hs = headsetOut();
			if (hs) on.push({ type: "output", mic: false, device: hs.id, name: hs.name });
			var fp = pageFor(/^flightsimulator/, /flight/i);
			if (fp) on.push({ type: "page", id: fp.id, name: fp.name });
			return { steps: on, offSteps: [{ type: "dnd", value: false }, { type: "restore" }] };
		});
	}
	/* The sound devices, also when no tile on screen asked the helper for them. */
	function withOutputs() {
		if ((Helper.state.outputs || []).length || !Helper.online) return Promise.resolve();
		return Helper.fetch("/api/state?parts=audio", { cache: "no-store" }, 4000).then(function (r) {
			if (r && r.outputs) { Helper.state.outputs = r.outputs; Helper.state.inputs = r.inputs; }
		}, function () {});
	}
	function cs2Steps() {
		var on = [{ type: "remember" }, { type: "steam", id: "730", name: "Counter-Strike 2" }, { type: "dnd", value: true }, { type: "powerPlan", plan: "high" }];
		var hs = headsetOut();
		if (hs) on.push({ type: "output", mic: false, device: hs.id, name: hs.name });
		var cp = pageFor(/^cs2\.exe$/, /cs|counter|gaming/i);
		if (cp) on.push({ type: "page", id: cp.id, name: cp.name });
		return { steps: on, offSteps: [{ type: "dnd", value: false }, { type: "powerPlan", plan: "balanced" }, { type: "restore" }] };
	}

	/* ------------------------------------------------------------------ step types */
	var STEP_TYPES = [
		["launch", "Open an app", "apps"],
		["url", "Open a website or link", "globe"],
		["quick", "Quick action", "bolt"],
		["keys", "Press keys", "keyboard"],
		["volume", "Set volume", "speaker"],
		["mute", "Mute / unmute", "micOff"],
		["output", "Switch audio output", "headset"],
		["appVolume", "App volume", "mixer"],
		["keepAwake", "Keep awake", "sun"],
		["powerPlan", "Power plan", "plan"],
		["media", "Media control", "music"],
		["discord", "Discord", "chat"],
		["dcjoin", "Join a Discord voice channel", "speaker"],
		["sound", "Sound profile", "mixer"],
		["dnd", "Do Not Disturb", "moon"],
		["page", "Show a page", "pages"],
		["steam", "Start a Steam game", "gamepad"],
		["remember", "Remember output and page", "check"],
		["restore", "Go back to the remembered output and page", "back"],
		["wait", "Wait", "hourglass"],
	];
	/* Step types added by other parts (Round 8C): { type: { label, icon, describe(st), run(st), edit(cur, finish, w, back), local } } */
	var EXTRA = {};
	function addStepType(type, def) {
		EXTRA[type] = def;
		if (!STEP_TYPES.some(function (s) { return s[0] === type; })) STEP_TYPES.push([type, def.label, def.icon]);
	}
	var PLANS = { balanced: "Balanced", high: "High performance", saver: "Power saver" };
	var MEDIA = { triggerPlayPause: "Play / pause", triggerNextTrack: "Next track", triggerPreviousTrack: "Previous track" };

	function deviceName(isMic, id) {
		if (!id) return isMic ? "default mic" : "default output";
		var d = T.endpoints(isMic).filter(function (x) { return x.id === id; })[0];
		return d ? d.name : isMic ? "a microphone" : "an output";
	}

	function describe(st) {
		if (EXTRA[st.type]) return EXTRA[st.type].describe(st);
		switch (st.type) {
			case "launch": return "Open " + (st.name || "app");
			case "url": return "Open " + (st.name || st.url || "link");
			case "quick": return (T.QUICK[st.what] || {}).name || "Quick action";
			case "keys": return "Press " + st.combo;
			case "volume": return (st.mic ? "Mic" : "Volume") + " to " + st.value + "% (" + deviceName(st.mic, st.device) + ")";
			case "mute": return (st.mode === "on" ? "Mute " : st.mode === "off" ? "Unmute " : "Mute on/off: ") + (st.mic ? "microphone" : "speakers");
			case "output": return "Switch " + (st.mic ? "microphone" : "output") + " to " + (st.name || deviceName(st.mic, st.device));
			case "appVolume": return (st.name || "App") + " volume to " + st.value + "%";
			case "keepAwake": return "Keep awake " + (st.value ? "on" : "off");
			case "powerPlan": return "Power plan: " + (PLANS[st.plan] || st.plan);
			case "media": return MEDIA[st.what] || "Media";
			case "wait": return "Wait " + st.seconds + " s";
			case "discord": return st.what === "deaf" ? "Discord: deafen on/off" : st.what === "leave" ? "Discord: leave the call" : "Discord: mute on/off";
			case "dnd": return "Do Not Disturb " + (st.value ? "on" : "off");
			case "dcjoin": return "Join " + (st.name || "a voice channel");
			case "sound": return "Sound profile: " + (st.name || "?");
			case "page": return "Show the page " + (st.name || "");
			case "steam": return "Start " + (st.name || "a Steam game");
			case "remember": return "Remember the sound output and page";
			case "restore": return "Go back to the remembered sound output and page";
			default: return "Step";
		}
	}

	function stepIcon(st) {
		for (var i = 0; i < STEP_TYPES.length; i++) if (STEP_TYPES[i][0] === st.type) return STEP_TYPES[i][2];
		return "bolt";
	}

	function needsHelper(st) {
		if (EXTRA[st.type]) return !EXTRA[st.type].local;
		return !(st.type === "media" || st.type === "wait" || st.type === "page" || st.type === "remember" || (st.type === "url" && st.url && !st.id) || (st.type === "quick" && (T.QUICK[st.what] || {}).uri));
	}

	/* ------------------------------------------------------------------ running */
	function delay(ms) {
		return new Promise(function (r) { setTimeout(r, ms); });
	}

	function runStep(st) {
		if (EXTRA[st.type]) return Promise.resolve(EXTRA[st.type].run(st));
		switch (st.type) {
			case "launch": return Helper.act({ action: "launch", id: st.id }, true);
			case "url":
				if (st.id) return Helper.act({ action: "launch", id: st.id }, true);
				if (Helper.online) return Helper.act({ action: "openUrl", url: st.url }, true);
				Icue.openLink(st.url);
				return Promise.resolve();
			case "quick": T.runShortcut({ kind: "quick", what: st.what }); return Promise.resolve();
			case "keys": return Helper.act({ action: "keys", combo: st.combo }, true);
			case "volume": return Helper.act({ action: st.mic ? "micVolume" : "speakersVolume", device: st.device || "", value: st.value }, true);
			case "mute": {
				var ep = T.endpointFor(st.mic, st.device || "");
				var muted = st.mode === "on" ? true : st.mode === "off" ? false : !(ep && ep.muted);
				if (ep) ep.muted = muted;
				return Helper.act({ action: st.mic ? "micMute" : "speakersMute", device: st.device || (ep ? ep.id : ""), value: muted }, true);
			}
			case "output": return Helper.act({ action: "setDefaultDevice", mic: !!st.mic, device: st.device }, true);
			case "appVolume": return Helper.act({ action: "appVolume", key: st.key, value: st.value }, true);
			case "keepAwake":
				Helper.state.keepAwake = !!st.value;
				return Helper.act({ action: "keepAwake", value: !!st.value }, true);
			case "powerPlan": return Helper.act({ action: "powerPlan", plan: st.plan }, true);
			case "media": Icue.mediaCommand(st.what); return Promise.resolve();
			case "wait": return delay(U.clamp(Number(st.seconds) || 1, 0.1, 30) * 1000);
			case "discord": return Helper.act({ action: "discord", what: st.what || "mute" }, true);
			case "dnd":
				Helper.state.dnd = !!st.value;
				Helper.hold("dnd", 3000);
				return Helper.act({ action: "dnd", on: !!st.value }, true);
			case "steam": return Helper.act({ action: "steamRun", id: st.id }, true);
			case "dcjoin": return Helper.act({ action: "discord", what: "join", channel: st.id }, true);
			case "sound": return Round8b.applyProfile(Round8b.profileById(st.id) || null);
			case "page": return goToPage(st.id);
			case "remember": {
				var L = Editor.layout(), out = T.endpointFor(false, "");
				Editor.storeSet("cpRemember", { output: out ? out.id : "", page: L.pages[L.current] ? L.pages[L.current].id : "" });
				return Promise.resolve();
			}
			case "restore": {
				var m = Editor.storeGet("cpRemember") || {};
				var p = m.page ? goToPage(m.page) : Promise.resolve();
				if (!m.output) return p;
				Helper.hold("outputs", 2500);
				return Helper.act({ action: "setDefaultDevice", mic: false, device: m.output }, true);
			}
			default: return Promise.resolve();
		}
	}

	function goToPage(id) {
		var L = Editor.layout();
		for (var i = 0; i < L.pages.length; i++) if (L.pages[i].id === id) { if (L.current !== i) Editor.goPage(i, "user"); break; }
		return Promise.resolve();
	}

	function run(steps, label) {
		steps = steps || [];
		if (!steps.length) return U.toast("This button has no steps yet. Tap Edit, then ✏");
		if (!Helper.online && steps.some(needsHelper)) return U.toast("Start Control Hub for this button");
		var chain = Promise.resolve();
		steps.forEach(function (st) {
			chain = chain.then(function () { return runStep(st); }).then(function () { return delay(60); }, function () {});
		});
		chain.then(function () {
			setTimeout(Helper.poll, 200);
			App.dirty();
		});
		if (label) U.toast(label);
	}

	/* ------------------------------------------------------------------ look (icon) */
	function lookEl(cfg, cls) {
		var look = cfg.look || { kind: "glyph", name: "bolt" };
		var box = el("span", "blogo " + (cls || ""));
		box.style.setProperty("--c", U.hexToRgb(cfg.color, [43, 179, 163]).join(","));
		var glyph = function () { box.innerHTML = look.kind === "letter" ? '<b class="bl-letter"></b>' : svg(look.name || "bolt"); if (look.kind === "letter") box.querySelector("b").textContent = (cfg.name || "?").trim().charAt(0).toUpperCase(); };
		if (look.kind === "app" || look.kind === "picture") {
			box.innerHTML = svg(look.kind === "app" ? "apps" : "image");
			var img = new Image();
			img.alt = "";
			img.onload = function () {
				box.innerHTML = "";
				box.classList.add(look.kind === "app" ? "has-app" : "has-pic");
				box.appendChild(img);
			};
			img.src = look.kind === "app" ? Helper.iconUrl(look.icon) : Helper.base() + "/api/picture?name=" + encodeURIComponent(look.name || "");
		} else glyph();
		return box;
	}

	/* ------------------------------------------------------------------ the tile */
	var tileType = {
		name: "Custom button", desc: "Key combos, several actions, templates", icon: "keyboard", group: "shortcuts",
		w: 1, h: 1, minW: 1, minH: 1, maxW: 3, maxH: 3,
		build: function (ctx) {
			var cfg = ctx.tile.cfg || {};
			// A button from a ready-made page: fill in its template's steps (they depend on what's on this PC).
			if (cfg.pendingTemplate && Helper.online && !cfg.__filling) {
				var tp = TEMPLATES.filter(function (x) { return x.name === cfg.pendingTemplate; })[0];
				if (tp && tp.make) {
					cfg.__filling = true;
					tp.make().then(function (r) {
						var steps = r.steps || [], off = r.offSteps || [];
						if (r.choose) r.choose.forEach(function (it) { if (it.on) { steps = steps.concat(it.steps || []); off = off.concat(it.offSteps || []); } });
						cfg.steps = steps;
						cfg.offSteps = off;
						delete cfg.pendingTemplate;
						delete cfg.__filling;
						Editor.save();
					}, function () { delete cfg.__filling; });
				} else delete cfg.pendingTemplate;
			}
			ctx.node.classList.add("press", "cbtn");
			var wrap = el("div", "sc");
			wrap.appendChild(lookEl(cfg, "sc-ic"));
			var nm = el("span", "nm");
			nm.textContent = cfg.name || "New button";
			wrap.appendChild(nm);
			if (cfg.mode === "toggle") {
				var pill = el("span", "cb-state");
				wrap.appendChild(pill);
			}
			ctx.body.appendChild(wrap);
			var rgb = U.hexToRgb(cfg.color, [43, 179, 163]).join(",");
			function paint() {
				var on = cfg.mode === "toggle" && cfg.on;
				ctx.node.classList.toggle("on", !!on);
				ctx.node.style.background = on ? "linear-gradient(160deg, rgba(" + rgb + ",0.55), rgba(" + rgb + ",0.25))" : "";
				if (pill) pill.textContent = on ? "ON" : "OFF";
			}
			paint();
			ctx.node.addEventListener("click", function () {
				if (App.editing) return;
				ctx.node.classList.remove("ran");
				void ctx.node.offsetWidth;
				ctx.node.classList.add("ran");
				if (cfg.mode === "toggle") {
					var turningOn = !cfg.on;
					run(turningOn ? cfg.steps : cfg.offSteps, (cfg.name || "Button") + (turningOn ? " on" : " off"));
					cfg.on = turningOn;
					ctx.tile.cfg = cfg;
					Editor.save();
					paint();
				} else run(cfg.steps);
			});
			return null;
		},
		edit: function (t, back) { openEditor(t, back); },
	};

	/* ------------------------------------------------------------------ editor */
	function clone(o) { return JSON.parse(JSON.stringify(o || {})); }

	function openEditor(t, back, startWith) {
		var work = clone(t.cfg);
		if (!work.steps) work.steps = [];
		if (!work.offSteps) work.offSteps = [];
		if (!work.mode) work.mode = "press";
		if (!work.color) work.color = COLORS[0];
		if (!work.look) work.look = { kind: "glyph", name: "bolt" };
		var isNew = !t.cfg || (!t.cfg.steps || !t.cfg.steps.length) && (!t.cfg.name || !!startWith);

		function save() {
			if (!work.name) work.name = work.steps.length ? describe(work.steps[0]).replace(/^Open |^Press /, "") : "Button";
			t.cfg = work;
			Editor.saveTile(t, back);
		}

		function main() {
			var w = el("div", "bed");
			// Preview + name
			var top = el("div", "bed-top");
			var prev = el("div", "bed-prev");
			prev.appendChild(lookEl(work, "sc-ic"));
			top.appendChild(prev);
			var fields = el("div", "bed-fields");
			fields.innerHTML = '<label>Name</label><input class="search" maxlength="28" placeholder="Button name" />';
			var input = fields.querySelector("input");
			input.value = work.name || "";
			input.addEventListener("input", function () { work.name = input.value.trim(); });
			var lookBtn = el("button", "pill", svg("image") + " Icon and color");
			lookBtn.addEventListener("click", function () { lookPicker(); });
			var tplBtn = el("button", "pill", svg("star") + " Templates");
			tplBtn.addEventListener("click", function () { templates(); });
			var row = el("div", "bed-row");
			row.appendChild(lookBtn);
			row.appendChild(tplBtn);
			fields.appendChild(row);
			top.appendChild(fields);
			w.appendChild(top);

			// Mode
			var modeSec = el("div", "opt", "<h4>When tapped</h4>");
			var chips = el("div", "chips");
			[["press", "Run the steps"], ["toggle", "Switch on / off"]].forEach(function (m) {
				var c = el("button", "chip" + (work.mode === m[0] ? " on" : ""), esc(m[1]));
				c.addEventListener("click", function () { work.mode = m[0]; main(); });
				chips.appendChild(c);
			});
			modeSec.appendChild(chips);
			w.appendChild(modeSec);

			w.appendChild(stepList(work.steps, work.mode === "toggle" ? "When switched on" : "Steps", "steps"));
			if (work.mode === "toggle") w.appendChild(stepList(work.offSteps, "When switched off", "offSteps"));

			var bar = el("div", "bed-bar");
			var test = el("button", "pill", "Test");
			test.addEventListener("click", function () { run(work.steps, "Testing " + (work.name || "button")); });
			var ok = el("button", "pill accent", "Save");
			ok.addEventListener("click", save);
			bar.appendChild(test);
			bar.appendChild(ok);
			w.appendChild(bar);
			Editor.modal(isNew ? "New button" : "Edit button", w, back);
		}

		function stepList(list, title, which) {
			var sec = el("div", "opt", "<h4>" + esc(title) + "</h4>");
			var box = el("div", "steps");
			list.forEach(function (st, i) {
				var r = el("div", "step");
				r.innerHTML = '<span class="step-n">' + (i + 1) + "</span>" + svg(stepIcon(st)) + '<span class="step-tx"></span><button class="icon-btn up" aria-label="Move up">↑</button><button class="icon-btn del" aria-label="Remove">' + svg("x") + "</button>";
				r.querySelector(".step-tx").textContent = describe(st);
				r.querySelector(".up").disabled = i === 0;
				r.querySelector(".up").addEventListener("click", function () {
					if (i > 0) { var x = list[i - 1]; list[i - 1] = list[i]; list[i] = x; main(); }
				});
				r.querySelector(".del").addEventListener("click", function () { list.splice(i, 1); main(); });
				r.querySelector(".step-tx").addEventListener("click", function () {
					editStep(st.type, st, function (ns) { list[i] = ns; main(); });
				});
				box.appendChild(r);
			});
			if (!list.length) box.appendChild(el("p", "hint", "No steps yet."));
			var add = el("button", "pill accent add-step", "+ Add step");
			add.addEventListener("click", function () {
				addStep(function (ns) { list.push(ns); main(); });
			});
			sec.appendChild(box);
			sec.appendChild(add);
			return sec;
		}

		function addStep(onDone) {
			var g = el("div", "pick-grid");
			STEP_TYPES.forEach(function (s) {
				var b = el("button", "dr-item", svg(s[2]) + "<span><b>" + esc(s[1]) + "</b></span>");
				b.addEventListener("click", function () { editStep(s[0], null, onDone); });
				g.appendChild(b);
			});
			Editor.modal("Add a step", g, main);
		}

		/* Configure one step. st = existing step or null. */
		function editStep(type, st, onDone) {
			var cur = clone(st || { type: type });
			cur.type = type;
			var w = el("div", "stepcfg");
			function finish() { onDone(cur); }
			function chips(title, items, key, after) {
				var sec = el("div", "opt", "<h4>" + esc(title) + "</h4>");
				var c = el("div", "chips");
				items.forEach(function (it) {
					var b = el("button", "chip" + (cur[key] === it[0] ? " on" : ""), esc(it[1]));
					b.addEventListener("click", function () { cur[key] = it[0]; if (after) after(); else draw(); });
					c.appendChild(b);
				});
				sec.appendChild(c);
				w.appendChild(sec);
			}
			function okBar(enabled) {
				var b = el("button", "pill accent save-btn", st ? "Save step" : "Add step");
				b.disabled = !enabled;
				b.addEventListener("click", finish);
				w.appendChild(b);
			}
			function valueSlider(title) {
				if (cur.value == null) cur.value = 50;
				var sec = el("div", "opt", "<h4>" + esc(title) + ' <b class="sv">' + cur.value + "%</b></h4>");
				var sv = sec.querySelector(".sv");
				var sl = T.slider(sec, function (v) { cur.value = v; sv.textContent = v + "%"; });
				sl.set(cur.value);
				w.appendChild(sec);
			}
			function deviceList(isMic, key, allowDefault) {
				var sec = el("div", "opt", "<h4>" + (isMic ? "Microphone" : "Output") + "</h4>");
				var list = el("div", "opt-list");
				var items = (allowDefault ? [{ id: "", name: "Windows default", sub: "whatever Windows uses" }] : []).concat(T.endpoints(isMic));
				items.forEach(function (d) {
					var b = el("button", "opt-row" + ((cur[key] || "") === (d.id || "") ? " on" : ""), '<span class="src-check">' + svg("check") + "</span><span><b></b><em></em></span>");
					b.querySelector("b").textContent = d.name || "Audio device";
					b.querySelector("em").textContent = d.sub || (d.isDefault ? "Windows default right now" : "");
					b.addEventListener("click", function () { cur[key] = d.id || ""; cur.name = d.name; draw(); });
					list.appendChild(b);
				});
				if (!items.length) list.appendChild(el("p", "hint", "Start Control Hub to see your devices."));
				sec.appendChild(list);
				w.appendChild(sec);
			}
			function pickList(items, onPick, emptyText) {
				var g = el("div", "pick-grid");
				items.forEach(function (it) {
					var b = el("button", "pick");
					b.appendChild(it.logo);
					var tx = el("span", "pick-tx", "<b></b><em></em>");
					tx.querySelector("b").textContent = it.name;
					tx.querySelector("em").textContent = it.sub || "";
					b.appendChild(tx);
					b.addEventListener("click", function () { onPick(it); });
					g.appendChild(b);
				});
				if (!items.length) g.appendChild(el("p", "hint", emptyText || "Nothing here yet."));
				w.appendChild(g);
			}

			function draw() {
				w.innerHTML = "";
				var title = (STEP_TYPES.filter(function (s) { return s[0] === type; })[0] || [0, "Step"])[1];
				if (EXTRA[type]) {
					if (EXTRA[type].edit(cur, finish, w, main, okBar) === false) return;
					Editor.modal(title, w, main);
					return;
				}
				switch (type) {
					case "launch":
						if (!Helper.online) { w.appendChild(el("div", "notice", "<b>Start Control Hub</b><span>Your apps are listed by Control Hub.</span>")); break; }
						w.appendChild(el("p", "hint", "Loading your apps…"));
						Helper.loadApps(false).then(function (apps) {
							w.innerHTML = "";
							var search = el("input", "search");
							search.placeholder = "Search apps";
							w.appendChild(search);
							var holder = el("div");
							w.appendChild(holder);
							function fill(q) {
								holder.innerHTML = "";
								var saved = w;
								w = holder;
								pickList(apps.filter(function (a) { return a.kind !== "url" && (!q || a.name.toLowerCase().indexOf(q) >= 0); }).map(function (a) {
									return { name: a.name, logo: T.shortcutLogo({ kind: "app", icon: a.icon }, "pick-logo"), a: a };
								}), function (it) { cur.id = it.a.id; cur.name = it.a.name; cur.icon = it.a.icon; finish(); });
								w = saved;
							}
							search.addEventListener("input", function () { fill(search.value.toLowerCase()); });
							fill("");
						});
						break;
					case "url":
						var custom = (Helper.apps || []).filter(function (a) { return a.kind === "url"; });
						pickList(custom.map(function (a) {
							return { name: a.name, sub: "Added by you", logo: T.shortcutLogo({ kind: "url", domain: a.domain }, "pick-logo"), a: a };
						}).concat(T.SITES.map(function (s2) {
							return { name: s2.name, sub: s2.domain, logo: T.shortcutLogo({ kind: "url", domain: s2.domain }, "pick-logo"), s: s2 };
						})), function (it) {
							if (it.a) { cur.id = it.a.id; cur.url = ""; cur.name = it.a.name; }
							else { cur.id = ""; cur.url = it.s.url; cur.name = it.s.name; }
							finish();
						});
						w.appendChild(el("p", "hint", "Add your own websites and Spotify playlists in Control Hub → Panel → Add a website"));
						if (Helper.online && !Helper.apps) Helper.loadApps(false).then(draw);
						break;
					case "quick":
						pickList(Object.keys(T.QUICK).map(function (q) {
							var b = el("span", "logo pick-logo", svg(T.QUICK[q].icon));
							return { name: T.QUICK[q].name, logo: b, q: q };
						}), function (it) { cur.what = it.q; finish(); });
						break;
					case "keys":
						keyPicker(cur, draw, finish);
						return;
					case "volume":
						cur.mic = !!cur.mic;
						chips("Change", [[false, "Speakers / headphones"], [true, "Microphone"]], "mic");
						deviceList(cur.mic, "device", true);
						valueSlider("Volume");
						okBar(true);
						break;
					case "mute":
						cur.mic = cur.mic === undefined ? true : cur.mic;
						if (!cur.mode) cur.mode = "toggle";
						chips("What", [[true, "Microphone"], [false, "Speakers / headphones"]], "mic");
						chips("Do", [["toggle", "Switch mute on/off"], ["on", "Mute"], ["off", "Unmute"]], "mode");
						deviceList(cur.mic, "device", true);
						okBar(true);
						break;
					case "output":
						cur.mic = !!cur.mic;
						if (cur.device === undefined) cur.device = "";
						chips("Switch", [[false, "Output (headphones / speakers)"], [true, "Microphone"]], "mic");
						deviceList(cur.mic, "device", false);
						okBar(!!cur.device);
						break;
					case "appVolume":
						var mixer = Helper.state.mixer || [];
						var sec = el("div", "opt", "<h4>App (only apps playing sound right now are listed)</h4>");
						w.appendChild(sec);
						var list = el("div", "opt-list");
						mixer.forEach(function (a) {
							var b = el("button", "opt-row" + (cur.key === a.key ? " on" : ""), '<span class="src-check">' + svg("check") + "</span><span><b></b></span>");
							b.querySelector("b").textContent = a.name;
							b.addEventListener("click", function () { cur.key = a.key; cur.name = a.name; draw(); });
							list.appendChild(b);
						});
						if (!mixer.length) list.appendChild(el("p", "hint", "Start the app and play some sound in it, then come back. Add an App mixer tile to see them."));
						sec.appendChild(list);
						valueSlider("Volume");
						okBar(!!cur.key);
						break;
					case "keepAwake":
						if (cur.value === undefined) cur.value = true;
						chips("Keep awake", [[true, "On"], [false, "Off"]], "value");
						okBar(true);
						break;
					case "powerPlan":
						if (!cur.plan) cur.plan = "high";
						chips("Power plan", [["high", "High performance"], ["balanced", "Balanced"], ["saver", "Power saver"]], "plan");
						okBar(true);
						break;
					case "media":
						if (!cur.what) cur.what = "triggerPlayPause";
						chips("Media", Object.keys(MEDIA).map(function (m) { return [m, MEDIA[m]]; }), "what");
						okBar(true);
						break;
					case "discord":
						if (!cur.what) cur.what = "mute";
						chips("Do", [["mute", "Mute on/off"], ["deaf", "Deafen on/off"], ["leave", "Leave the call"]], "what");
						w.appendChild(el("p", "hint", "Works when Discord is connected (Control Hub → Connections → Discord). No keybinds needed."));
						okBar(true);
						break;
					case "dnd":
						if (cur.value === undefined) cur.value = true;
						chips("Do Not Disturb", [[true, "On (no Windows notifications)"], [false, "Off"]], "value");
						okBar(true);
						break;
					case "page":
						pickList(Editor.layout().pages.map(function (pg) {
							return { name: pg.name, sub: pg.tiles.length + " tiles", logo: el("span", "logo pick-logo", svg("pages")), pg: pg };
						}), function (it) { cur.id = it.pg.id; cur.name = it.pg.name; finish(); });
						break;
					case "steam":
						if (!Helper.online) { w.appendChild(el("div", "notice", "<b>Start Control Hub</b><span>Your Steam games are listed by Control Hub.</span>")); break; }
						w.appendChild(el("p", "hint", "Loading your Steam games…"));
						Helper.fetch("/api/steam", { cache: "no-store" }, 20000).then(function (r) {
							w.innerHTML = "";
							pickList(((r && r.games) || []).map(function (g) {
								var logo = el("span", "logo pick-logo has-img");
								logo.innerHTML = '<img alt="" src="https://cdn.cloudflare.steamstatic.com/steam/apps/' + esc(g.id) + '/capsule_184x69.jpg" onerror="this.remove()" />';
								return { name: g.name, sub: g.minutes ? Math.round(g.minutes / 60) + " h played" : "", logo: logo, g: g };
							}), function (it) { cur.id = it.g.id; cur.name = it.g.name; finish(); }, "No Steam games found on this PC.");
						}, function () { w.innerHTML = '<p class="hint">Couldn\'t load your Steam games.</p>'; });
						break;
					case "dcjoin":
						Round8b.pickChannel(function (ch) { cur.id = ch.id; cur.name = ch.name; finish(); }, main);
						return;
					case "sound":
						var profs = Round8b.profiles();
						pickList(profs.map(function (pf) {
							return { name: pf.name, sub: pf.out ? pf.out.name : "", logo: el("span", "logo pick-logo", svg(pf.icon || "headset")), pf: pf };
						}), function (it) { cur.id = it.pf.id; cur.name = it.pf.name; finish(); }, "No sound profiles yet. Add a Sound profiles tile and make one first.");
						break;
					case "remember":
					case "restore":
						w.appendChild(el("p", "hint", type === "remember"
							? "Remembers which sound output and which page you use right now. Put it first in the On steps."
							: "Switches the sound output and the page back to what “Remember” saved. Put it in the Off steps."));
						okBar(true);
						break;
					case "wait":
						if (!cur.seconds) cur.seconds = 1;
						chips("Wait", [[0.5, "½ second"], [1, "1 second"], [2, "2 seconds"], [3, "3 seconds"], [5, "5 seconds"], [10, "10 seconds"]], "seconds");
						okBar(true);
						break;
				}
				Editor.modal(title, w, main);
			}
			draw();
		}

		/* Key combo: presets, or build one with modifier toggles + a key grid. */
		function keyPicker(cur, redraw, finish) {
			var w = el("div", "keys");
			var parts = String(cur.combo || "").split("+").filter(Boolean);
			var mods = { Ctrl: false, Shift: false, Alt: false, Win: false }, key = "";
			parts.forEach(function (p) { if (mods.hasOwnProperty(p)) mods[p] = true; else key = p; });
			var tab = "presets";
			function combo() {
				var out = Object.keys(mods).filter(function (m) { return mods[m]; });
				if (key) out.push(key);
				return out.join("+");
			}
			function draw() {
				w.innerHTML = "";
				var tabs = el("div", "tabs");
				[["presets", "Ready-made"], ["build", "Build my own"]].forEach(function (t2) {
					var b = el("button", tab === t2[0] ? "on" : "", esc(t2[1]));
					b.addEventListener("click", function () { tab = t2[0]; draw(); });
					tabs.appendChild(b);
				});
				w.appendChild(tabs);
				if (tab === "presets") {
					var list = el("div", "opt-list");
					KEY_PRESETS.forEach(function (p) {
						var b = el("button", "opt-row", '<span class="kbd"></span><span><b></b></span>');
						b.querySelector(".kbd").textContent = p[1];
						b.querySelector("b").textContent = p[0];
						b.addEventListener("click", function () { cur.combo = p[1]; finish(); });
						list.appendChild(b);
					});
					w.appendChild(list);
					w.appendChild(el("p", "hint", "These use each app's normal keys. If you changed them in Discord or OBS, build your own instead."));
				} else {
					var pv = el("div", "key-preview");
					pv.textContent = combo() || "Pick keys below";
					w.appendChild(pv);
					var mrow = el("div", "chips");
					Object.keys(mods).forEach(function (m) {
						var b = el("button", "chip" + (mods[m] ? " on" : ""), m);
						b.addEventListener("click", function () { mods[m] = !mods[m]; draw(); });
						mrow.appendChild(b);
					});
					w.appendChild(mrow);
					var groups = [
						["Letters", "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")],
						["Numbers", "1234567890".split("")],
						["F keys", ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12", "F13", "F14", "F15", "F16", "F17", "F18", "F19", "F20", "F21", "F22", "F23", "F24"]],
						["Other", ["Esc", "Enter", "Space", "Tab", "Backspace", "Delete", "Insert", "Home", "End", "PageUp", "PageDown", "Up", "Down", "Left", "Right", "PrintScreen", "Pause", "Num0", "Num1", "Num2", "Num3", "Num4", "Num5", "Num6", "Num7", "Num8", "Num9", "-", "=", ",", ".", "/", ";", "[", "]", "`"]],
						["Media", ["MediaPlayPause", "MediaNext", "MediaPrev", "MediaStop", "VolumeUp", "VolumeDown", "VolumeMute"]],
					];
					groups.forEach(function (g) {
						w.appendChild(el("h4", "", esc(g[0])));
						var grid = el("div", "keygrid");
						g[1].forEach(function (kname) {
							var b = el("button", "key" + (key === kname ? " on" : "") + (kname.length > 3 ? " wide" : ""), esc(kname.replace(/^Media/, "").replace(/^Volume/, "Vol ")));
							b.addEventListener("click", function () { key = key === kname ? "" : kname; draw(); });
							grid.appendChild(b);
						});
						w.appendChild(grid);
					});
					var ok = el("button", "pill accent save-btn", "Use " + (combo() || "…"));
					ok.disabled = !key;
					ok.addEventListener("click", function () { cur.combo = combo(); finish(); });
					w.appendChild(ok);
				}
			}
			draw();
			Editor.modal("Press keys", w, main);
		}

		function lookPicker() {
			var w = el("div", "look");
			var tab = (work.look && work.look.kind) || "glyph";
			if (tab === "letter") tab = "glyph";
			function draw() {
				w.innerHTML = "";
				var prev = el("div", "bed-prev center");
				prev.appendChild(lookEl(work, "sc-ic"));
				w.appendChild(prev);
				w.appendChild(el("h4", "", "Color"));
				var colors = el("div", "colors");
				COLORS.forEach(function (c) {
					var b = el("button", "color" + (work.color === c ? " on" : ""));
					b.style.background = c;
					b.addEventListener("click", function () { work.color = c; draw(); });
					colors.appendChild(b);
				});
				w.appendChild(colors);
				var tabs = el("div", "tabs");
				[["glyph", "Symbols"], ["app", "App icons"], ["picture", "My pictures"]].forEach(function (t2) {
					var b = el("button", tab === t2[0] ? "on" : "", esc(t2[1]));
					b.addEventListener("click", function () { tab = t2[0]; draw(); });
					tabs.appendChild(b);
				});
				w.appendChild(tabs);
				var grid = el("div", "glyphs");
				if (tab === "glyph") {
					var lb = el("button", "glyph" + (work.look.kind === "letter" ? " on" : ""), '<b class="bl-letter">' + esc((work.name || "A").charAt(0).toUpperCase()) + "</b>");
					lb.addEventListener("click", function () { work.look = { kind: "letter" }; draw(); });
					grid.appendChild(lb);
					GLYPHS.forEach(function (g) {
						var b = el("button", "glyph" + (work.look.kind === "glyph" && work.look.name === g ? " on" : ""), svg(g));
						b.addEventListener("click", function () { work.look = { kind: "glyph", name: g }; draw(); });
						grid.appendChild(b);
					});
					w.appendChild(grid);
				} else if (tab === "app") {
					if (!Helper.online) w.appendChild(el("p", "hint", "Start Control Hub to use app icons."));
					else {
						var holder = el("div", "glyphs");
						w.appendChild(holder);
						Helper.loadApps(false).then(function (apps) {
							apps.filter(function (a) { return a.icon; }).forEach(function (a) {
								var b = el("button", "glyph app" + (work.look.kind === "app" && work.look.icon === a.icon ? " on" : ""));
								var img = new Image();
								img.alt = a.name;
								img.src = Helper.iconUrl(a.icon);
								b.appendChild(img);
								b.title = a.name;
								b.addEventListener("click", function () { work.look = { kind: "app", icon: a.icon }; draw(); });
								holder.appendChild(b);
							});
						});
					}
				} else {
					if (!Helper.online) w.appendChild(el("p", "hint", "Start Control Hub to use your pictures."));
					else {
						var ph = el("div", "glyphs");
						w.appendChild(ph);
						Helper.fetch("/api/pictures", { cache: "no-store" }, 4000).then(function (r) {
							(r.pictures || []).forEach(function (n) {
								var b = el("button", "glyph pic" + (work.look.kind === "picture" && work.look.name === n ? " on" : ""));
								var img = new Image();
								img.alt = n;
								img.src = Helper.base() + "/api/picture?name=" + encodeURIComponent(n);
								b.appendChild(img);
								b.addEventListener("click", function () { work.look = { kind: "picture", name: n }; draw(); });
								ph.appendChild(b);
							});
							if (!(r.pictures || []).length) ph.appendChild(el("p", "hint", "No pictures yet."));
						}, function () {});
						w.appendChild(el("p", "hint", "Add pictures in Control Hub → Panel → Add a button picture"));
					}
				}
				var ok = el("button", "pill accent save-btn", "Done");
				ok.addEventListener("click", main);
				w.appendChild(ok);
			}
			draw();
			Editor.modal("Icon and color", w, main);
		}

		function useTemplate(tp) {
			work = clone(tp);
			delete work.desc;
			delete work.startWith;
			delete work.make;
			work.mode = tp.mode || "press";
			work.steps = work.steps || [];
			work.offSteps = work.offSteps || [];
			work.on = false;
			if (tp.make) {
				Editor.modal(tp.name, el("p", "hint", "Looking at what's on your PC…"), null);
				tp.make().then(function (r) {
					if (r.choose) return chooseSteps(tp, r.choose);
					work.steps = r.steps || [];
					work.offSteps = r.offSteps || [];
					main();
				});
			} else if (tp.startWith) editStep(tp.startWith, null, function (ns) { work.steps.push(ns); main(); });
			else main();
		}

		/* A template with a list of suggested steps: you switch on the ones you want. */
		function chooseSteps(tp, items) {
			var w = el("div", "opts tpl-choose");
			w.appendChild(el("p", "hint", "Pick what this button should do. You can change the order and details afterwards."));
			items.forEach(function (it) {
				var b = el("button", "opt-toggle" + (it.on ? " on" : ""), '<span class="switch"><i></i></span><span><b></b><em></em></span>');
				b.querySelector("b").textContent = it.label;
				b.querySelector("em").textContent = it.sub || "";
				b.addEventListener("click", function () { it.on = !it.on; b.classList.toggle("on", it.on); });
				w.appendChild(b);
			});
			var ok = el("button", "pill accent save-btn", "Make the button");
			ok.addEventListener("click", function () {
				work.steps = [];
				work.offSteps = [];
				items.forEach(function (it) {
					if (!it.on) return;
					(it.steps || []).forEach(function (x) { work.steps.push(x); });
					(it.offSteps || []).forEach(function (x) { work.offSteps.push(x); });
				});
				// "Remember" goes first, "go back" last.
				work.steps.sort(function (a, b) { return (b.type === "remember") - (a.type === "remember"); });
				work.offSteps.sort(function (a, b) { return (a.type === "restore") - (b.type === "restore"); });
				main();
			});
			w.appendChild(ok);
			Editor.modal(tp.name, w, templates);
		}

		function templates() {
			var g = el("div", "pick-grid");
			TEMPLATES.forEach(function (tp) {
				var b = el("button", "pick");
				b.appendChild(lookEl(tp, "pick-logo blogo-sm"));
				var tx = el("span", "pick-tx", "<b></b><em></em>");
				tx.querySelector("b").textContent = tp.name;
				tx.querySelector("em").textContent = tp.desc;
				b.appendChild(tx);
				b.addEventListener("click", function () { useTemplate(tp); });
				g.appendChild(b);
			});
			var empty = el("button", "pick", '<span class="logo pick-logo">' + svg("plus") + '</span><span class="pick-tx"><b>Start empty</b><em>Build it step by step</em></span>');
			empty.addEventListener("click", main);
			g.appendChild(empty);
			Editor.modal("Pick a template", g, isNew ? null : main);
		}

		var named = startWith && TEMPLATES.filter(function (x) { return x.name === startWith; })[0];
		if (isNew && named) useTemplate(named);
		else if (isNew) templates();
		else main();
	}

	T.types.button = tileType;

	return {
		run: run, describe: describe, lookEl: lookEl, tileType: tileType, openEditor: openEditor,
		addStepType: addStepType, TEMPLATES: TEMPLATES, headsetOut: headsetOut, pageFor: pageFor, withOutputs: withOutputs,
	};
})();
