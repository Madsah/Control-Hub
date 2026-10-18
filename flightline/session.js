/* FlightLine — Session: one button starts your flight programs one at a time and switches the panel to your flight page.
   The list is edited here and saved by itself (Control Hub Service keeps it and runs it). */
"use strict";

const Session = (function () {
	const PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
	const STOP = '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
	const UP = '<svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg>';
	const DOWN = '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>';
	const X = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
	const PLUS = '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>';
	const GLOBE = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>';
	const APP = '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>';

	let cfg = null, state = null, pages = [], suggested = false, saveT = null, savedAt = 0, box = null;

	const STATES = {
		waiting: ["Waiting", ""], starting: ["Starting…", "acc"], started: ["Started", "ok"], already: ["Already running", "ok"],
		failed: ["Didn't start", "bad"], closing: ["Closing…", "acc"], closed: ["Closed", "ok"], notrunning: ["Wasn't running", ""],
		stillopen: ["Still open (it may be asking something)", "warn"], cantclose: ["Can't be closed from here", "warn"],
	};

	function api(body) {
		return fetch("/api/fl/session", { method: "POST", headers: { "Content-Type": "application/json", "X-Control-Panel": "1" }, body: JSON.stringify(body) })
			.then(r => r.json()).catch(() => null);
	}

	async function load() {
		const d = await get("/api/fl/session");
		cfg = d.config || { steps: [] };
		cfg.steps = cfg.steps || [];
		state = d.state || null;
		pages = d.pages || [];
		suggested = !!d.suggested;
	}

	function save() {
		clearTimeout(saveT);
		saveT = setTimeout(async () => {
			const r = await api({ what: "save", config: cfg });
			if (r && r.ok) { suggested = false; savedAt = Date.now(); const s = box && box.querySelector("#saved"); if (s) { s.textContent = "Saved"; setTimeout(() => { if (s.isConnected) s.textContent = ""; }, 2000); } }
		}, 400);
	}

	function icon(s) {
		if (s.kind === "url") return '<span class="s-ic">' + GLOBE + "</span>";
		if (s.kind === "steam") return '<span class="s-ic img"><img alt="" onerror="Session.noIcon(this)" src="https://cdn.cloudflare.steamstatic.com/steam/apps/' + encodeURIComponent(s.id) + '/capsule_184x69.jpg"></span>';
		if (s.icon) return '<span class="s-ic img"><img alt="" onerror="Session.noIcon(this)" src="/api/icon?id=' + encodeURIComponent(s.icon) + '"></span>';
		return '<span class="s-ic">' + APP + "</span>";
	}

	function kindText(s) { return s.kind === "steam" ? "Steam game" : s.kind === "url" ? s.url : "Program"; }

	/* ------------------------------------------------------------------ the page */
	async function render(main) {
		main.innerHTML = '<div class="head"><div class="grow"><h1>Session</h1><p>Loading…</p></div></div>';
		try { await load(); } catch (e) { main.innerHTML = '<div class="head"><div class="grow"><h1>Session</h1><p>Control Hub isn\'t answering.</p></div></div>'; return; }
		if (view !== "session") return;
		box = main;
		draw();
	}

	function draw() {
		if (!box || view !== "session") return;
		const running = state && (state.phase === "starting" || state.phase === "ending");
		const active = state && state.active;
		let h = '<div class="head"><div class="grow"><h1>Session</h1><p>One button starts your flight programs one after another and switches the panel to your flight page.</p></div>' +
			'<button class="btn" id="endBtn"' + (running && state.phase === "ending" ? " disabled" : "") + ">" + STOP + " End session</button>" +
			'<button class="btn accent big" id="startBtn"' + (running ? " disabled" : "") + ">" + PLAY + (running && state.phase === "starting" ? " Starting…" : active ? " Start again" : " Start session") + "</button></div>";
		if (state && state.steps && state.steps.length && (running || Date.now() - n(state.startedAt) < 10 * 60000 || state.phase === "")) {
			h += '<div class="panel side-panel run"><h3>' + (state.phase === "ending" || (!active && state.phase === "") ? "Ending the session" : "Starting the session") + '</h3><ul class="run-list">' +
				state.steps.map(s => { const st = STATES[s.state] || [s.state, ""]; return '<li class="st-' + esc(st[1]) + '"><i></i><b>' + esc(s.name) + "</b><span>" + esc(st[0]) + "</span></li>"; }).join("") + "</ul></div>";
		}
		if (suggested) h += '<div class="hint-box">This list is a suggestion from what\'s on your PC. Change it as you like: it\'s saved by itself.</div>';
		h += '<div class="panel"><div class="panel-head"><h2>Programs, in order</h2><span class="muted" id="saved"></span><button class="btn" id="addBtn">' + PLUS + " Add</button></div>";
		if (!cfg.steps.length) h += '<div class="empty"><b>Nothing to start yet</b><p>Add MSFS 2024 and the programs you use when you fly.</p></div>';
		h += '<ol class="steps">' + cfg.steps.map((s, i) =>
			'<li class="step' + (s.on === false ? " off" : "") + '" data-i="' + i + '">' +
			'<span class="num-badge">' + (i + 1) + "</span>" + icon(s) +
			'<div class="s-main"><b>' + esc(s.name) + '</b><span class="muted">' + esc(kindText(s)) + "</span></div>" +
			(i < cfg.steps.length - 1 ? '<label class="wait">then wait <input type="number" min="0" max="300" step="5" value="' + n(s.wait) + '" data-a="wait"> s</label>' : '<span class="wait muted">last</span>') +
			(s.kind !== "url" ? '<label class="chk" title="Close it when you end the session"><input type="checkbox" data-a="close"' + (s.close ? " checked" : "") + "> Close at end</label>" : '<span class="chk"></span>') +
			'<button class="tog' + (s.on === false ? "" : " on") + '" data-a="on" title="On / off"><i></i></button>' +
			'<span class="s-tools"><button data-a="up" title="Move up"' + (i ? "" : " disabled") + ">" + UP + '</button><button data-a="down" title="Move down"' + (i < cfg.steps.length - 1 ? "" : " disabled") + ">" + DOWN + '</button><button data-a="del" title="Remove">' + X + "</button></span></li>").join("") + "</ol></div>";
		const opt = (sel, none) => '<option value="">' + none + "</option>" + pages.map(p => '<option value="' + esc(p.id) + '"' + (p.id === sel ? " selected" : "") + ">" + esc(p.name) + "</option>").join("");
		h += '<div class="panel side-panel" style="margin-top:16px"><h3>The panel</h3><div class="page-pick">' +
			'<label>When the session starts, show<select id="pgStart">' + opt(cfg.page || "", "Don't switch") + "</select></label>" +
			'<label>When it ends, show<select id="pgEnd">' + opt(cfg.homePage || "", "Don't switch") + "</select></label></div>" +
			(pages.length ? "" : '<p class="muted">The panel\'s pages show up here once the panel has run with Control Hub.</p>') + "</div>";
		h += '<p class="muted foot">Also on the panel: any button → Quick actions → Start flight session / End flight session.</p>';
		box.innerHTML = h;
		wire();
	}

	function wire() {
		box.querySelector("#startBtn").addEventListener("click", async () => {
			clearTimeout(saveT);
			await api({ what: "save", config: cfg });
			const r = await api({ what: "start" });
			if (r) { state = r.state; draw(); }
		});
		box.querySelector("#endBtn").addEventListener("click", async () => {
			const r = await api({ what: "end" });
			if (r) { state = r.state; draw(); }
		});
		box.querySelector("#addBtn").addEventListener("click", picker);
		box.querySelector("#pgStart").addEventListener("change", e => { cfg.page = e.target.value; save(); });
		box.querySelector("#pgEnd").addEventListener("change", e => { cfg.homePage = e.target.value; save(); });
		box.querySelectorAll(".step").forEach(li => {
			const i = +li.dataset.i, s = cfg.steps[i];
			li.addEventListener("click", e => {
				const b = e.target.closest("button[data-a]");
				if (!b) return;
				const a = b.dataset.a;
				if (a === "on") s.on = s.on === false;
				else if (a === "del") cfg.steps.splice(i, 1);
				else if (a === "up" && i > 0) cfg.steps.splice(i - 1, 0, cfg.steps.splice(i, 1)[0]);
				else if (a === "down" && i < cfg.steps.length - 1) cfg.steps.splice(i + 1, 0, cfg.steps.splice(i, 1)[0]);
				save();
				draw();
			});
			const w = li.querySelector('[data-a="wait"]');
			if (w) w.addEventListener("change", () => { s.wait = Math.max(0, Math.min(300, Math.round(+w.value || 0))); save(); });
			const c = li.querySelector('[data-a="close"]');
			if (c) c.addEventListener("change", () => { s.close = c.checked; save(); });
		});
	}

	/* ------------------------------------------------------------------ adding a program */
	async function picker() {
		const d = $("#dialog");
		d.innerHTML = '<div class="box wide"><h3>Add to the session</h3><div class="tabs"><button data-t="apps" class="on">Programs</button><button data-t="steam">Steam games</button><button data-t="url">Website</button></div><div class="pick-body"></div><div class="row"><button class="btn" data-a="no">Close</button></div></div>';
		d.hidden = false;
		const body = d.querySelector(".pick-body");
		d.onclick = e => { if (e.target === d || e.target.closest('[data-a="no"]')) d.hidden = true; };
		d.querySelectorAll("[data-t]").forEach(b => b.addEventListener("click", () => {
			d.querySelectorAll("[data-t]").forEach(x => x.classList.toggle("on", x === b));
			show(b.dataset.t);
		}));
		function add(step) {
			step.on = true; step.close = false; step.wait = step.wait == null ? 5 : step.wait;
			cfg.steps.push(step);
			save();
			d.hidden = true;
			draw();
		}
		async function show(t) {
			if (t === "url") {
				body.innerHTML = '<label class="field">Name<input class="search" id="uName" placeholder="SimBrief"></label><label class="field">Address<input class="search" id="uUrl" placeholder="https://dispatch.simbrief.com"></label><button class="btn accent" id="uAdd">Add website</button>';
				body.querySelector("#uAdd").addEventListener("click", () => {
					let url = body.querySelector("#uUrl").value.trim();
					if (url && !/^https?:\/\//i.test(url)) url = "https://" + url;
					try { new URL(url); } catch (e) { return; }
					add({ kind: "url", name: body.querySelector("#uName").value.trim() || new URL(url).hostname, url: url, wait: 0 });
				});
				return;
			}
			body.innerHTML = '<p class="muted">Loading…</p>';
			let items = [];
			try {
				if (t === "apps") items = ((await get("/api/apps")).apps || []).filter(a => a.kind !== "url").map(a => ({ kind: "app", id: a.id, name: a.name, icon: a.icon }));
				else items = ((await get("/api/fl/steam")).games || []).map(g => ({ kind: "steam", id: String(g.id), name: g.name }));
			} catch (e) { body.innerHTML = '<p class="muted">Couldn\'t load the list. Is Control Hub running?</p>'; return; }
			body.innerHTML = '<input class="search" id="pq" placeholder="Search"><div class="pick-list"></div>';
			const list = body.querySelector(".pick-list"), q = body.querySelector("#pq");
			function fill() {
				const s = q.value.trim().toLowerCase();
				const shown = items.filter(it => !s || it.name.toLowerCase().includes(s)).slice(0, 200);
				list.innerHTML = shown.map((it, k) => '<button class="pick" data-k="' + items.indexOf(it) + '">' + icon(it) + "<span>" + esc(it.name) + "</span></button>").join("") || '<p class="muted">Nothing found.</p>';
				list.querySelectorAll(".pick").forEach(b => b.addEventListener("click", () => add(Object.assign({}, items[+b.dataset.k]))));
			}
			q.addEventListener("input", fill);
			fill();
			q.focus();
		}
		show("apps");
	}

	/* ------------------------------------------------------------------ while it runs */
	let ticking = false;
	async function tick() {
		if (view !== "session" || ticking || !box) return;
		ticking = true;
		try {
			const d = await get("/api/fl/session");
			const before = JSON.stringify(state);
			state = d.state || null;
			pages = d.pages || pages;
			if (JSON.stringify(state) !== before && !document.querySelector("#dialog:not([hidden])") && !(document.activeElement && document.activeElement.tagName === "INPUT")) draw();
		} catch (e) {}
		ticking = false;
	}

	/* A picture that didn't load: the plain program icon instead. */
	function noIcon(img) { const p = img.parentNode; if (p) { p.classList.remove("img"); p.innerHTML = APP; } }

	return { render: render, tick: tick, noIcon: noIcon };
})();
