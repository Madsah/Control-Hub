/* Control Panel — pop-out panels.
 * A button opens a panel over the page:
 *   Sound: every app's volume, the output (headset / speakers) and the microphone.
 *   Power: lock, sleep, sign out, restart, shut down (hold to be sure).
 * Opened by the quick actions "Sound (pop-out)" and "Power (pop-out)", by a Power tile showing only its icon,
 * and by button steps (Quick action). Tap outside or ✕ to close; it closes by itself after a while.
 */

var Popout = (function () {
	var el = U.el, svg = U.svg;
	var box = null, kind = null, tiles = [], updaters = [], idleT = null;
	var IDLE_MS = 45000;

	/* The pop-out's tiles are drawn and kept up to date like tiles on the page. */
	var baseUpdate = Editor.updateAll, baseVisible = Editor.visibleTiles;
	Editor.updateAll = function () {
		baseUpdate();
		if (box && !document.hidden) runUpdaters();
	};
	Editor.visibleTiles = function () {
		var list = baseVisible();
		return tiles.length ? list.concat(tiles) : list;
	};
	function runUpdaters() {
		for (var i = 0; i < updaters.length; i++) {
			try { updaters[i](); } catch (e) {}
		}
	}

	function armIdle() {
		clearTimeout(idleT);
		idleT = setTimeout(close, IDLE_MS);
	}

	function close() {
		clearTimeout(idleT);
		if (!box) return;
		var b = box;
		box = null;
		kind = null;
		tiles = [];
		updaters = [];
		b.classList.remove("in");
		setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 180);
		App.refreshNeeds();
	}

	function shell(title, icon, cls) {
		box = el("div", "pop " + cls);
		box.innerHTML =
			'<div class="pop-card"><div class="pop-head"><span class="pop-ic">' + svg(icon) + '</span><b class="pop-title"></b><span class="pop-extra"></span>' +
			'<button type="button" class="pop-x" aria-label="Close">' + svg("x") + '</button></div><div class="pop-body"></div></div>';
		box.querySelector(".pop-title").textContent = title;
		box.addEventListener("click", function (e) { if (e.target === box) close(); });
		box.querySelector(".pop-x").addEventListener("click", close);
		box.addEventListener("pointerdown", armIdle, true);
		document.body.appendChild(box);
		void box.offsetWidth;
		box.classList.add("in");
		armIdle();
		return box.querySelector(".pop-body");
	}

	/* A real tile inside the pop-out. The spot it sits in decides its size. */
	function vtile(parent, type, w, h, cls) {
		var def = T.types[type];
		if (!def) return null;
		var t = { id: "pop-" + type, type: type, x: 0, y: 0, w: w, h: h, cfg: def.defaults ? def.defaults() : {} };
		var node = el("div", "tile pop-tile t-" + type + (cls ? " " + cls : ""));
		node.dataset.w = w;
		node.dataset.h = h;
		var body = el("div", "tile-in");
		node.appendChild(body);
		parent.appendChild(node);
		var r = node.getBoundingClientRect();
		if (r.width && r.height) node.style.setProperty("--u", Math.min(r.width, r.height).toFixed(1) + "px");
		tiles.push(t);
		try {
			var upd = def.build({ node: node, body: body, tile: t, w: w, h: h });
			if (typeof upd === "function") updaters.push(upd);
		} catch (e) {
			body.innerHTML = '<div class="notice"><b>Couldn\'t show this</b></div>';
		}
		return node;
	}

	/* ------------------------------------------------------------------ Sound */
	function openSound() {
		var body = shell("Sound", "mixer", "pop-sound");
		var extra = box.querySelector(".pop-extra");
		var settings = el("button", "pill pop-pill", svg("settings") + "<span>Windows sound settings</span>");
		settings.type = "button";
		settings.addEventListener("click", function () {
			close();
			if (Helper.online) Helper.act({ action: "quick", what: "sound" });
			else if (!Icue.openLink("ms-settings:sound")) U.toast("Start Control Hub for this");
		});
		extra.appendChild(settings);
		var grid = el("div", "pop-grid");
		body.appendChild(grid);
		var left = el("div", "pop-col");
		grid.appendChild(left);
		vtile(left, "speakers", 4, 1);
		vtile(left, "output", 4, 1);
		vtile(left, "mic", 4, 1);
		vtile(grid, "mixer", 6, 3, "pop-mixer");
	}

	/* ------------------------------------------------------------------ Power */
	var POWER = [
		["lock", "Lock", "lock", false],
		["sleep", "Sleep", "moon", true],
		["signout", "Sign out", "signout", true],
		["restart", "Restart", "restart", true],
		["shutdown", "Shut down", "power", true],
	];
	var HOLD_MS = 700;

	function openPower() {
		var body = shell("Power", "power", "pop-power");
		var row = el("div", "pop-pw");
		body.appendChild(row);
		POWER.forEach(function (p) {
			var b = el("button", "pop-pw-btn" + (p[0] === "shutdown" || p[0] === "restart" ? " danger" : ""),
				'<i class="pop-fill"></i>' + svg(p[2]) + "<b></b><em></em>");
			b.type = "button";
			b.querySelector("b").textContent = p[1];
			b.querySelector("em").textContent = p[3] ? "Hold" : "Tap";
			row.appendChild(b);
			if (!p[3]) {
				b.addEventListener("click", function () { go(p); });
				return;
			}
			var t = null;
			function cancel() {
				clearTimeout(t);
				t = null;
				b.classList.remove("holding");
			}
			b.addEventListener("pointerdown", function (e) {
				try { b.setPointerCapture(e.pointerId); } catch (x) {}
				b.classList.add("holding");
				t = setTimeout(function () {
					t = null;
					b.classList.remove("holding");
					go(p);
				}, HOLD_MS);
			});
			b.addEventListener("pointerup", function () { if (t) { cancel(); U.toast("Hold " + p[1] + " for a moment"); } });
			b.addEventListener("pointercancel", cancel);
			b.addEventListener("pointerleave", function () { if (t) cancel(); });
		});
		body.appendChild(el("p", "pop-hint", "Hold a button for a moment so nothing happens by accident. Save your work before restarting or shutting down."));
	}

	function go(p) {
		if (!Helper.online) return U.toast("Start Control Hub for power buttons");
		close();
		if (p[0] !== "lock") U.toast(p[0] === "sleep" ? "Going to sleep…" : p[0] === "signout" ? "Signing out…" : p[0] === "restart" ? "Restarting…" : "Shutting down…");
		Helper.act({ action: "power", what: p[0] });
	}

	/* ------------------------------------------------------------------ open */
	function open(what) {
		if (App.editing) return;
		close();
		kind = what;
		if (what === "sound") openSound();
		else if (what === "power") openPower();
		else { kind = null; return; }
		App.refreshNeeds();
		runUpdaters();
		if (Helper.poll && Helper.online) Helper.poll();
	}

	// Closing when editing starts, a page changes, or the panel goes to sleep.
	document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });

	/* Look window: keep the game in front when you touch the panel (Control Hub Service does it). */
	function lookSection(sec, toggleRow, again) {
		var s = sec("Games", "Touching the panel can take the focus away from a game for a moment, so the mouse shows up on your main screen. Control Hub gives the focus straight back to the game.");
		if (!Helper.online || Helper.state.gameFocus === undefined) {
			s.appendChild(el("p", "hint", "Needs Control Hub to be running (and up to date)."));
			return;
		}
		var on = Helper.state.gameFocus !== false;
		toggleRow(s, on, "Keep the game in front when I touch the panel", function () {
			Helper.state.gameFocus = !on;
			Helper.act({ action: "gameFocus", value: !on }).then(again, again);
		});
	}

	return {
		lookSection: lookSection,
		open: open,
		close: close,
		isOpen: function () { return !!box; },
		kind: function () { return kind; },
	};
})();
