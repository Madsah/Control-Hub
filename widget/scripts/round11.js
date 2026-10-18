/* Control Panel — Round 11 (Control Hub): Spotify playlists tile, and restoring a backup chosen in the Control Hub app. */

var Round11 = (function () {
	var el = U.el, svg = U.svg, esc = U.esc, setText = U.setText, setHtml = U.setHtml;
	var types = T.types, helperGate = T.helperGate;

	/* ================================================================== Spotify playlists */
	/* Your playlists as covers. Tap one and it plays, also when the Spotify app was closed: Control Hub starts it. */
	var plP = Round6.poller("/api/spotify/playlists", 300000, 20000);
	var spP = Round6.spotify;

	types.spplaylists = {
		name: "Spotify playlists", desc: "Your playlists as covers · tap one to play (starts Spotify if it's closed)", icon: "list", group: "media", helper: true,
		w: 4, h: 2, minW: 2, minH: 1, maxW: 12, maxH: 6, tickMs: 2000,
		defaults: function () { return { liked: true }; },
		options: function () { return [{ key: "liked", label: "Show Liked Songs", type: "toggle", "default": true }]; },
		build: function (ctx) {
			ctx.node.classList.add("sppl");
			ctx.body.innerHTML = '<div class="sppl-grid"></div><div class="sppl-msg notice small" hidden></div>';
			var grid = ctx.body.querySelector(".sppl-grid"), msg = ctx.body.querySelector(".sppl-msg");
			var shownKey = null, busyUri = null, busyAt = 0;
			grid.addEventListener("click", function (e) {
				var b = e.target.closest("[data-uri]");
				if (!b || App.editing) return;
				e.stopPropagation();
				busyUri = b.dataset.uri;
				busyAt = Date.now();
				shownKey = null;
				App.dirty();
				Helper.act({ action: "spotify", what: "playlist", uri: busyUri }, true).then(function (ok) {
					if (!ok) U.toast((spP.data && spP.data.error) || "Spotify didn't start that playlist");
					spP.soon();
				});
			});
			return function () {
				if (helperGate(ctx) === true) return;
				var s = spP.get(), cfg = ctx.tile.cfg || {};
				if (s && !s.connected) {
					grid.hidden = true; msg.hidden = false;
					setHtml(msg, "<b>Connect Spotify once</b><span>Open Control Hub → Connections → Spotify.</span>");
					return;
				}
				var d = plP.get();
				var lists = ((d && d.playlists) || []).filter(function (p) { return cfg.liked !== false || p.uri !== "liked"; });
				if (!d) { grid.hidden = true; msg.hidden = false; setHtml(msg, "<span>Loading your playlists…</span>"); return; }
				if (!lists.length) { grid.hidden = true; msg.hidden = false; setHtml(msg, "<span>No playlists yet. Make one in Spotify.</span>"); return; }
				grid.hidden = false; msg.hidden = true;
				// How many covers fit: about one per tile cell, as big as the tile allows.
				var cols = Math.max(1, ctx.w), rows = Math.max(1, ctx.h);
				// Few playlists: fewer rows, so the covers fill the tile.
				rows = Math.max(1, Math.min(rows, Math.ceil(lists.length / cols)));
				var max = cols * rows;
				var starting = !!(s && s.starting);
				// The tapped cover stays marked while Spotify starts, and a few seconds after.
				if (busyUri && !starting && Date.now() - busyAt > 4000) busyUri = null;
				if (starting) busyAt = Date.now();
				var key = lists.slice(0, max).map(function (p) { return p.uri; }).join("|") + "|" + cols + "x" + rows + "|" + busyUri + "|" + starting;
				if (key === shownKey) return;
				shownKey = key;
				grid.style.gridTemplateColumns = "repeat(" + cols + ", minmax(0, 1fr))";
				grid.style.gridTemplateRows = "repeat(" + rows + ", minmax(0, 1fr))";
				setHtml(grid, lists.slice(0, max).map(function (p) {
					var busy = p.uri === busyUri;
					var img = p.image ? ' style="background-image:url(&quot;' + esc(String(p.image).replace(/"/g, "")) + '&quot;)"' : "";
					return '<button class="sppl-it' + (p.image ? " has-img" : "") + (p.uri === "liked" ? " liked" : "") + (busy ? " busy" : "") + '" data-uri="' + esc(p.uri) + '"' + img + ">" +
						(p.image ? "" : '<span class="sppl-ic">' + svg(p.uri === "liked" ? "heart" : "music") + "</span>") +
						'<b>' + esc(busy && starting ? "Starting Spotify…" : p.name) + "</b></button>";
				}).join(""));
			};
		},
	};

	/* ================================================================== restore chosen in Control Hub */
	/* Control Hub → Panel → Restore: the service hands the backup's name to the panel with the next event. */
	var restoredIds = {};
	function restoreFromHub(r) {
		if (!r || !r.name || restoredIds[r.id]) return;
		restoredIds[r.id] = true;
		Helper.fetch("/api/backup?name=" + encodeURIComponent(r.name), { cache: "no-store" }, 6000).then(function (res) {
			var cp = null;
			try { cp = JSON.parse(res.layout); } catch (e) {}
			if (!cp) throw new Error("bad");
			return Pages.backup(false, "before-restore").then(function () {
				Editor.pushUndo("Restored a backup from Control Hub");
				if (!Editor.adopt(cp)) throw new Error("bad");
				Editor.save();
				App.render();
				U.toast("Layout restored from Control Hub");
			});
		}).catch(function () { U.toast("Couldn't restore that backup"); });
	}

	return {
		restoreFromHub: restoreFromHub,
	};
})();
