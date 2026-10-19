/* Control Panel — Round 4B tiles: weather, calendar, news, packages, timer, countdown,
 * world clock, notes, doodle, screenshots and clipboard. */

var Everyday = (function () {
	var svg = U.svg, el = U.el, esc = U.esc, setText = U.setText, setHtml = U.setHtml;
	var types = T.types, head = T.head, helperGate = T.helperGate;

	T.GROUPS.push(["everyday", "Everyday"]);

	/* ------------------------------------------------------------------ fetching from the internet */
	/* News feeds need the helper (news sites don't allow widgets to read them directly).
	   Weather works directly too, so it also works without the helper. */
	var cache = {};
	function getText(url, viaHelperOnly) {
		function viaHelper() {
			if (!Helper.online) return Promise.reject(new Error("helper"));
			return fetch(Helper.base() + "/api/fetch?url=" + encodeURIComponent(url), { cache: "no-store" }).then(function (r) {
				if (!r.ok) throw new Error("http " + r.status);
				return r.text();
			});
		}
		if (viaHelperOnly) return viaHelper();
		return fetch(url, { cache: "no-store" }).then(function (r) {
			if (!r.ok) throw new Error("http " + r.status);
			return r.text();
		}).catch(viaHelper);
	}

	/* Keeps an answer for maxAge, and asks again only when a tile on screen wants it. */
	function cached(key, maxAge, load) {
		var c = cache[key] || (cache[key] = { at: 0, data: null, err: null, busy: false });
		if (!c.busy && Date.now() - c.at > (c.err ? 60000 : maxAge)) {
			c.busy = true;
			load().then(function (d) {
				c.data = d;
				c.err = null;
			}, function (e) {
				c.err = e || true;
			}).then(function () {
				c.at = Date.now();
				c.busy = false;
				App.dirty();
			});
		}
		return c;
	}

	function openUrl(url) {
		if (!/^https?:\/\//i.test(url || "")) return;
		if (Helper.online) Helper.act({ action: "openUrl", url: url });
		else if (!Icue.openLink(url)) U.toast("Couldn't open the link");
	}

	function two(n) { return ("0" + n).slice(-2); }
	function hm(d) {
		return Cfg.clock24h ? two(d.getHours()) + ":" + two(d.getMinutes()) : ((d.getHours() % 12) || 12) + ":" + two(d.getMinutes()) + (d.getHours() < 12 ? " AM" : " PM");
	}
	function dayStart(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
	function dayLabel(t) {
		var diff = Math.round((dayStart(new Date(t)) - dayStart(new Date())) / 86400000);
		if (diff === 0) return "Today";
		if (diff === 1) return "Tomorrow";
		return new Date(t).toLocaleDateString("en-GB", diff < 7 && diff > 0 ? { weekday: "long" } : { weekday: "short", day: "numeric", month: "short" });
	}
	function ago(t) {
		var m = Math.round((Date.now() - t) / 60000);
		if (m < 1) return "now";
		if (m < 60) return m + " min";
		if (m < 1440) return Math.round(m / 60) + " h";
		return Math.round(m / 1440) + " d";
	}

	/* ------------------------------------------------------------------ weather (Open-Meteo, free, no account) */
	var WMO = {
		0: ["Clear", "sun"], 1: ["Mostly clear", "partly"], 2: ["Partly cloudy", "partly"], 3: ["Cloudy", "cloud"],
		45: ["Fog", "fog"], 48: ["Fog", "fog"], 51: ["Drizzle", "rain"], 53: ["Drizzle", "rain"], 55: ["Drizzle", "rain"],
		56: ["Freezing drizzle", "rain"], 57: ["Freezing drizzle", "rain"], 61: ["Light rain", "rain"], 63: ["Rain", "rain"], 65: ["Heavy rain", "rain"],
		66: ["Freezing rain", "rain"], 67: ["Freezing rain", "rain"], 71: ["Light snow", "snow"], 73: ["Snow", "snow"], 75: ["Heavy snow", "snow"],
		77: ["Snow", "snow"], 80: ["Showers", "rain"], 81: ["Showers", "rain"], 82: ["Heavy showers", "rain"], 85: ["Snow showers", "snow"],
		86: ["Snow showers", "snow"], 95: ["Thunderstorm", "storm"], 96: ["Thunderstorm", "storm"], 99: ["Thunderstorm", "storm"],
	};
	function wmo(code, night) {
		var w = WMO[code] || ["", "cloud"];
		return { text: w[0], icon: night && w[1] === "sun" ? "moon" : w[1] };
	}

	types.weather = {
		name: "Weather", desc: "Now and the next days", icon: "partly", group: "everyday",
		w: 2, h: 1, minW: 1, minH: 1, maxW: 6, maxH: 3, tickMs: 60000,
		defaults: function () { return { name: "Copenhagen", lat: 55.6759, lon: 12.5655 }; },
		edit: function (t, back) { pickCity(t, back); },
		build: function (ctx) {
			var cfg = ctx.tile.cfg || {};
			ctx.body.innerHTML = '<div class="wx-now"><span class="wx-ic"></span><div class="wx-tx"><b class="wx-t"></b><span class="wx-s"></span></div></div><div class="wx-days"></div>';
			var ic = ctx.body.querySelector(".wx-ic"), tEl = ctx.body.querySelector(".wx-t"), sEl = ctx.body.querySelector(".wx-s"), days = ctx.body.querySelector(".wx-days");
			var url = "https://api.open-meteo.com/v1/forecast?latitude=" + (+cfg.lat).toFixed(3) + "&longitude=" + (+cfg.lon).toFixed(3) +
				"&current=temperature_2m,weather_code,is_day,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&wind_speed_unit=ms&timezone=auto&forecast_days=6" +
				(cfg.fc === "hours" ? "&hourly=temperature_2m,weather_code,precipitation_probability,is_day&forecast_hours=12" : "");
			ctx.node.classList.toggle("wx-hours", cfg.fc === "hours");
			return function () {
				var c = cached("wx:" + url, 15 * 60000, function () { return getText(url).then(JSON.parse); });
				var d = c.data;
				if (!d || !d.current) {
					setHtml(ic, svg("partly"));
					setText(tEl, c.err ? "--" : "…");
					setText(sEl, c.err ? "Couldn't get the weather" : cfg.name || "");
					return;
				}
				var w = wmo(d.current.weather_code, !d.current.is_day);
				setHtml(ic, svg(w.icon));
				setText(tEl, Math.round(d.current.temperature_2m) + "°");
				var today = d.daily ? Math.round(d.daily.temperature_2m_max[0]) + "° / " + Math.round(d.daily.temperature_2m_min[0]) + "°" : "";
				setText(sEl, ctx.w === 1 ? (cfg.name || "") : (cfg.name || "") + " · " + w.text + (ctx.h > 1 || ctx.w > 2 ? "" : " · " + today));
				var n = ctx.w >= 3 ? Math.min(5, ctx.w + 1) : ctx.h > 1 ? 3 : 0;
				var html = "", hoursDone = false;
				if (cfg.fc === "hours" && d.hourly && d.hourly.time) {
					// The next hours instead of the next days.
					var hn = ctx.w >= 4 ? 6 : n;
					for (var k = 0; k < hn && k < d.hourly.time.length; k++) {
						var hw = wmo(d.hourly.weather_code[k], d.hourly.is_day ? !d.hourly.is_day[k] : false);
						var hr = d.hourly.precipitation_probability ? d.hourly.precipitation_probability[k] : null;
						html += '<div class="wx-day"><span>' + (k === 0 ? "Now" : d.hourly.time[k].slice(11, 13)) + "</span>" + svg(hw.icon) + "<b>" + Math.round(d.hourly.temperature_2m[k]) + "°</b><em>" + (hr != null && hr >= 30 ? hr + "%" : "&nbsp;") + "</em></div>";
					}
					n = hn;
					hoursDone = !!html;
				}
				for (var i = 0; !hoursDone && d.daily && i < n; i++) {
					var dw = wmo(d.daily.weather_code[i]);
					var lab = i === 0 ? "Today" : new Date(d.daily.time[i] + "T12:00").toLocaleDateString("en-GB", { weekday: "short" });
					var rain = d.daily.precipitation_probability_max ? d.daily.precipitation_probability_max[i] : null;
					html += '<div class="wx-day"><span>' + lab + "</span>" + svg(dw.icon) + "<b>" + Math.round(d.daily.temperature_2m_max[i]) + "°</b><em>" + Math.round(d.daily.temperature_2m_min[i]) + "°" + (rain != null && rain >= 30 ? " · " + rain + "%" : "") + "</em></div>";
				}
				setHtml(days, html);
				days.style.display = n ? "" : "none";
			};
		},
	};

	function pickCity(t, back) {
		var wrap = el("div", "opts");
		Editor.modal("Weather: choose your city", wrap, back);
		var fc = (t.cfg && t.cfg.fc) || "days";
		wrap.innerHTML = '<div class="chips wx-fc"><button class="chip' + (fc === "days" ? " on" : "") + '" data-fc="days">Next days</button><button class="chip' + (fc === "hours" ? " on" : "") + '" data-fc="hours">Next hours</button></div><div class="pick-bar"><input class="search" placeholder="Type a city, e.g. Aarhus" /><button class="pill accent">Search</button></div><div class="opt-list"></div>';
		var input = wrap.querySelector("input"), list = wrap.querySelector(".opt-list");
		wrap.querySelector(".wx-fc").addEventListener("click", function (e) {
			var b = e.target.closest("[data-fc]");
			if (!b) return;
			t.cfg = t.cfg || {};
			t.cfg.fc = b.dataset.fc;
			Editor.saveTile(t, function () { pickCity(t, back); });
		});
		input.value = (t.cfg && t.cfg.name) || "";
		function search() {
			var q = input.value.trim();
			if (q.length < 2) return;
			list.innerHTML = '<p class="hint">Searching…</p>';
			getText("https://geocoding-api.open-meteo.com/v1/search?count=8&language=en&name=" + encodeURIComponent(q)).then(JSON.parse).then(function (r) {
				list.innerHTML = "";
				(r.results || []).forEach(function (p) {
					var b = el("button", "opt-row", "<span><b></b><em></em></span>");
					b.querySelector("b").textContent = p.name;
					b.querySelector("em").textContent = [p.admin1, p.country].filter(Boolean).join(", ");
					b.addEventListener("click", function () {
						t.cfg = { name: p.name, lat: p.latitude, lon: p.longitude, fc: (t.cfg && t.cfg.fc) || undefined };
						Editor.saveTile(t, back);
					});
					list.appendChild(b);
				});
				if (!list.children.length) list.innerHTML = '<p class="hint">No places found.</p>';
			}, function () {
				list.innerHTML = '<p class="hint">Couldn\'t search right now. Is the PC online?</p>';
			});
		}
		wrap.querySelector(".pill").addEventListener("click", search);
		input.addEventListener("keydown", function (e) { if (e.key === "Enter") search(); });
	}

	/* ------------------------------------------------------------------ calendar (private iCal links added in the helper) */
	function unescapeIcs(s) {
		return String(s || "").replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1");
	}

	function parseIcsDate(prop) {
		// prop = { value, params }
		var v = prop.value, m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/.exec(v);
		if (!m) return null;
		var allDay = !m[4];
		var d = m[7]
			? new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)))
			: new Date(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)); // times with a time zone are read as local time
		return { t: d.getTime(), allDay: allDay };
	}

	function parseIcs(text, calName, from, to) {
		var lines = String(text).replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
		var events = [], cur = null, moved = {};
		lines.forEach(function (line) {
			if (line === "BEGIN:VEVENT") cur = { ex: [] };
			else if (line === "END:VEVENT") { if (cur) events.push(cur); cur = null; }
			else if (cur) {
				var c = line.indexOf(":");
				if (c < 0) return;
				var left = line.slice(0, c), value = line.slice(c + 1);
				var name = left.split(";")[0].toUpperCase();
				var prop = { value: value, params: left };
				if (name === "DTSTART") cur.start = parseIcsDate(prop);
				else if (name === "DTEND") cur.end = parseIcsDate(prop);
				else if (name === "SUMMARY") cur.title = unescapeIcs(value);
				else if (name === "LOCATION") cur.where = unescapeIcs(value);
				else if (name === "RRULE") cur.rrule = value;
				else if (name === "UID") cur.uid = value;
				else if (name === "STATUS") cur.status = value.toUpperCase();
				else if (name === "EXDATE") value.split(",").forEach(function (x) { var d = parseIcsDate({ value: x }); if (d) cur.ex.push(d.t); });
				else if (name === "RECURRENCE-ID") cur.recur = parseIcsDate(prop);
			}
		});
		events.forEach(function (e) { if (e.recur && e.uid) moved[e.uid + "|" + e.recur.t] = true; });
		var out = [];
		events.forEach(function (e) {
			if (!e.start || e.status === "CANCELLED") return;
			var len = e.end ? e.end.t - e.start.t : e.start.allDay ? 86400000 : 0;
			function add(t) {
				if (t + Math.max(len, 1) < from || t > to) return;
				if (e.ex.indexOf(t) >= 0 || (!e.recur && e.uid && moved[e.uid + "|" + t])) return;
				out.push({ t: t, end: t + len, allDay: e.start.allDay, title: e.title || "(no title)", where: e.where || "", cal: calName });
			}
			if (!e.rrule || e.recur) return add(e.start.t);
			expand(e.start.t, e.rrule, to, add);
		});
		return out;
	}

	/* Repeating events: daily, weekly (with days), monthly (same date) and yearly. */
	function expand(start, rrule, to, add) {
		var r = {};
		rrule.split(";").forEach(function (p) { var kv = p.split("="); r[kv[0].toUpperCase()] = kv[1]; });
		var freq = r.FREQ, interval = Math.max(1, +r.INTERVAL || 1), count = +r.COUNT || 0;
		var until = r.UNTIL ? parseIcsDate({ value: r.UNTIL }).t : Infinity;
		var days = r.BYDAY ? r.BYDAY.split(",").map(function (d) { return ["SU", "MO", "TU", "WE", "TH", "FR", "SA"].indexOf(d.slice(-2)); }) : null;
		var s = new Date(start), n = 0;
		for (var i = 0; i < 3000; i++) {
			var d;
			if (freq === "DAILY") d = new Date(s.getFullYear(), s.getMonth(), s.getDate() + i * interval, s.getHours(), s.getMinutes(), s.getSeconds());
			else if (freq === "WEEKLY") {
				var weekStart = new Date(s.getFullYear(), s.getMonth(), s.getDate() - s.getDay() + i * 7 * interval, s.getHours(), s.getMinutes(), s.getSeconds());
				var list = days || [s.getDay()];
				for (var k = 0; k < 7; k++) {
					if (list.indexOf(k) < 0) continue;
					var w = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + k, s.getHours(), s.getMinutes(), s.getSeconds());
					if (w.getTime() < start) continue;
					if (w.getTime() > until || w.getTime() > to || (count && n >= count)) return;
					n++;
					add(w.getTime());
				}
				continue;
			} else if (freq === "MONTHLY") d = new Date(s.getFullYear(), s.getMonth() + i * interval, s.getDate(), s.getHours(), s.getMinutes(), s.getSeconds());
			else if (freq === "YEARLY") d = new Date(s.getFullYear() + i * interval, s.getMonth(), s.getDate(), s.getHours(), s.getMinutes(), s.getSeconds());
			else return add(start);
			if (d.getTime() > until || d.getTime() > to || (count && n >= count)) return;
			n++;
			add(d.getTime());
		}
	}

	types.calendar = {
		name: "Calendar", desc: "Your next events (Google or Outlook)", icon: "calendar", group: "everyday", helper: true,
		w: 2, h: 2, minW: 2, minH: 1, maxW: 6, maxH: 4, tickMs: 60000,
		build: function (ctx) {
			var built = false, list;
			return function () {
				if (helperGate(ctx) === true) return (built = false);
				if (!built) {
					ctx.body.innerHTML = head("calendar", "Calendar") + '<div class="cal-list"></div><div class="mix-more"></div>';
					list = ctx.body.querySelector(".cal-list");
					U.dragScroll(list, ctx.body.querySelector(".mix-more"));
					built = true;
				}
				var c = cached("calendars", 15 * 60000, function () {
					return Helper.fetch("/api/calendars", { cache: "no-store" }, 30000).then(function (r) { return r.calendars || []; });
				});
				if (!c.data) return setHtml(list, '<div class="notice small"><span>' + (c.err ? "Couldn't load your calendars" : "Loading…") + "</span></div>");
				if (!c.data.length) return setHtml(list, '<div class="notice small"><b>No calendar yet</b><span>On your PC: Control Hub → Panel → Add a calendar link</span></div>');
				var now = Date.now(), to = now + 14 * 86400000;
				var events = [];
				c.data.forEach(function (cal) { if (cal.ok) events = events.concat(parseIcs(cal.ics, cal.name, now, to)); });
				events.sort(function (a, b) { return a.t - b.t || (b.allDay ? 1 : 0) - (a.allDay ? 1 : 0); });
				events = events.slice(0, 30);
				var html = "", lastDay = "";
				events.forEach(function (e) {
					var dl = dayLabel(Math.max(e.t, dayStart(new Date())));
					if (dl !== lastDay) {
						html += '<div class="cal-day">' + esc(dl) + "</div>";
						lastDay = dl;
					}
					var nowOn = e.t <= now && e.end > now;
					html += '<div class="cal-ev' + (nowOn ? " now" : "") + '"><span class="cal-time">' + (e.allDay ? "All day" : hm(new Date(e.t))) + '</span><span class="cal-tx"><b>' + esc(e.title) + "</b>" + (e.where ? "<em>" + esc(e.where) + "</em>" : "") + "</span></div>";
				});
				setHtml(list, html || '<div class="notice small"><span>Nothing in the next two weeks</span></div>');
			};
		},
	};

	/* ------------------------------------------------------------------ news */
	var FEEDS = {
		"dr-seneste": { name: "DR Seneste nyt", short: "DR", url: "https://www.dr.dk/nyheder/service/feeds/senestenyt" },
		"dr-indland": { name: "DR Indland", short: "DR", url: "https://www.dr.dk/nyheder/service/feeds/indland" },
		"dr-udland": { name: "DR Udland", short: "DR", url: "https://www.dr.dk/nyheder/service/feeds/udland" },
		"dr-sport": { name: "DR Sporten", short: "DR", url: "https://www.dr.dk/nyheder/service/feeds/sporten" },
		"tv2": { name: "TV 2 Nyheder", short: "TV 2", url: "https://feeds.services.tv2.dk/api/feeds/nyheder/rss" },
		"bbc": { name: "BBC News", short: "BBC", url: "https://feeds.bbci.co.uk/news/rss.xml" },
		"pcgamer": { name: "PC Gamer", short: "PC Gamer", url: "https://www.pcgamer.com/rss/" },
		"verge": { name: "The Verge", short: "Verge", url: "https://www.theverge.com/rss/index.xml" },
		"fselite": { name: "FSElite (flight sim)", short: "FSElite", url: "https://fselite.net/feed/" },
	};

	function parseFeed(text, src) {
		var doc = new DOMParser().parseFromString(text, "text/xml");
		var items = [].slice.call(doc.querySelectorAll("item, entry"), 0, 25);
		return items.map(function (it) {
			function q(sel) { var n = it.getElementsByTagName(sel)[0]; return n ? n.textContent.trim() : ""; }
			var link = q("link");
			if (!link) { var l = it.getElementsByTagName("link")[0]; link = l ? l.getAttribute("href") || "" : ""; }
			var date = Date.parse(q("pubDate") || q("updated") || q("published") || q("dc:date")) || 0;
			return { title: q("title"), link: link, t: date, src: src };
		}).filter(function (x) { return x.title; });
	}

	types.news = {
		name: "News", desc: "Headlines from DR, TV 2 and more", icon: "news", group: "everyday", helper: true,
		w: 3, h: 2, minW: 2, minH: 1, maxW: 6, maxH: 4, tickMs: 60000,
		defaults: function () { return { feeds: ["dr-seneste", "tv2"] }; },
		options: function () {
			return [{
				key: "feeds", label: "News from", type: "multi", "default": ["dr-seneste"], layout: "list",
				choices: Object.keys(FEEDS).map(function (k) { return { value: k, label: FEEDS[k].name }; }),
			}];
		},
		build: function (ctx) {
			var built = false, list, feeds = ((ctx.tile.cfg || {}).feeds || ["dr-seneste"]).filter(function (k) { return FEEDS[k]; });
			return function () {
				if (helperGate(ctx) === true) return (built = false);
				if (!built) {
					ctx.body.innerHTML = head("news", "News") + '<div class="news-list"></div><div class="mix-more"></div>';
					list = ctx.body.querySelector(".news-list");
					U.dragScroll(list, ctx.body.querySelector(".mix-more"));
					list.addEventListener("click", function (e) {
						var r = e.target.closest("[data-link]");
						if (r && !App.editing) { e.stopPropagation(); openUrl(r.dataset.link); }
					});
					built = true;
				}
				var all = [], loading = false, failed = 0;
				feeds.forEach(function (k) {
					var f = FEEDS[k];
					var c = cached("news:" + k, 15 * 60000, function () { return getText(f.url, true).then(function (t) { return parseFeed(t, f.short); }); });
					if (c.data) all = all.concat(c.data);
					else if (c.err) failed++;
					else loading = true;
				});
				if (!all.length) return setHtml(list, '<div class="notice small"><span>' + (loading ? "Loading news…" : failed ? "Couldn't load the news" : "Pick news sites with ✏") + "</span></div>");
				all.sort(function (a, b) { return b.t - a.t; });
				var html = all.slice(0, 30).map(function (n) {
					return '<button class="news-row" data-link="' + esc(n.link) + '"><b>' + esc(n.title) + '</b><em>' + esc(n.src) + (n.t ? " · " + ago(n.t) : "") + "</em></button>";
				}).join("");
				setHtml(list, html);
			};
		},
	};

	/* ------------------------------------------------------------------ packages */
	var CARRIERS = {
		postnord: { name: "PostNord", color: "#00a0d6", url: "https://tracking.postnord.com/dk/?id=" },
		gls: { name: "GLS", color: "#061ab1", url: "https://gls-group.com/DK/da/find-pakke?match=" },
		dao: { name: "DAO", color: "#e2001a", url: "https://www.dao.as/privat/find-din-pakke?stregkode=" },
		bring: { name: "Bring", color: "#7bc144", url: "https://tracking.bring.dk/tracking/" },
		ups: { name: "UPS", color: "#5f3a1f", url: "https://www.ups.com/track?tracknum=" },
		dhl: { name: "DHL", color: "#ffcc00", url: "https://www.dhl.com/dk-da/home/tracking.html?tracking-id=" },
		fedex: { name: "FedEx", color: "#4d148c", url: "https://www.fedex.com/fedextrack/?trknbr=" },
	};

	types.packages = {
		name: "Packages", desc: "Your tracking numbers · tap to track", icon: "box", group: "everyday",
		w: 2, h: 2, minW: 2, minH: 1, maxW: 4, maxH: 4,
		defaults: function () { return { items: [] }; },
		edit: function (t, back) { editPackages(t, back); },
		build: function (ctx) {
			var items = (ctx.tile.cfg && ctx.tile.cfg.items) || [];
			ctx.body.innerHTML = head("box", "Packages") + '<div class="pk-list"></div><div class="mix-more"></div>';
			var list = ctx.body.querySelector(".pk-list");
			U.dragScroll(list, ctx.body.querySelector(".mix-more"));
			if (!items.length) list.innerHTML = '<div class="notice small"><span>Tap Edit, then ✏ to add a tracking number</span></div>';
			items.forEach(function (p) {
				var c = CARRIERS[p.carrier] || CARRIERS.postnord;
				var b = el("button", "pk-row", '<span class="pk-badge"></span><span class="pk-tx"><b></b><em></em></span>');
				var badge = b.querySelector(".pk-badge");
				badge.textContent = c.name;
				badge.style.background = c.color;
				if (p.carrier === "dhl") badge.style.color = "#c00";
				b.querySelector("b").textContent = p.label || "Package";
				b.querySelector("em").textContent = p.num;
				b.addEventListener("click", function (e) {
					e.stopPropagation();
					if (!App.editing) openUrl(c.url + encodeURIComponent(p.num));
				});
				list.appendChild(b);
			});
			return null;
		},
	};

	function editPackages(t, back) {
		t.cfg = t.cfg || { items: [] };
		t.cfg.items = t.cfg.items || [];
		var wrap = el("div", "opts");
		Editor.modal("Packages", wrap, back);
		var work = { carrier: "postnord" };
		function draw() {
			wrap.innerHTML = "";
			var sec = el("div", "opt");
			sec.appendChild(el("h4", "", "Your packages"));
			var rows = el("div", "opt-list");
			t.cfg.items.forEach(function (p, i) {
				var r = el("div", "hid-row", "<b></b>");
				r.querySelector("b").textContent = (CARRIERS[p.carrier] || {}).name + " · " + (p.label || "Package") + " · " + p.num;
				var del = el("button", "pill danger", "Remove");
				del.addEventListener("click", function () { t.cfg.items.splice(i, 1); Editor.save(); draw(); });
				r.appendChild(del);
				rows.appendChild(r);
			});
			if (!t.cfg.items.length) rows.appendChild(el("p", "hint", "None yet."));
			sec.appendChild(rows);
			wrap.appendChild(sec);

			var add = el("div", "opt");
			add.appendChild(el("h4", "", "Add a package"));
			var chips = el("div", "chips");
			Object.keys(CARRIERS).forEach(function (k) {
				var c = el("button", "chip" + (work.carrier === k ? " on" : ""), esc(CARRIERS[k].name));
				c.addEventListener("click", function () { work.carrier = k; work.num = num.value; work.label = lab.value; draw(); });
				chips.appendChild(c);
			});
			add.appendChild(chips);
			var num = el("input", "search");
			num.placeholder = "Tracking number";
			num.value = work.num || "";
			var lab = el("input", "search");
			lab.placeholder = "What is it? (e.g. New headset)";
			lab.value = work.label || "";
			lab.maxLength = 30;
			var fields = el("div", "pk-fields");
			fields.appendChild(num);
			fields.appendChild(lab);
			add.appendChild(fields);
			var ok = el("button", "pill accent save-btn", "Add");
			ok.addEventListener("click", function () {
				var n = num.value.replace(/\s+/g, "").trim();
				if (!/^[A-Za-z0-9\-]{4,40}$/.test(n)) return U.toast("That doesn't look like a tracking number");
				t.cfg.items.unshift({ carrier: work.carrier, num: n, label: lab.value.trim().slice(0, 30) });
				work = { carrier: work.carrier };
				Editor.save();
				draw();
			});
			add.appendChild(ok);
			wrap.appendChild(add);
			var done = el("button", "pill strong save-btn", "Done");
			done.addEventListener("click", function () { Editor.saveTile(t, back); });
			wrap.appendChild(done);
		}
		draw();
	}

	/* ------------------------------------------------------------------ timer */
	var beepCtx = null;
	function beep(times) {
		try {
			var Ctx = window.AudioContext || window.webkitAudioContext;
			beepCtx = beepCtx || new Ctx();
			if (beepCtx.state === "suspended") beepCtx.resume();
			for (var i = 0; i < (times || 3); i++) {
				var t = beepCtx.currentTime + i * 0.35;
				var o = beepCtx.createOscillator(), g = beepCtx.createGain();
				o.frequency.value = 880;
				g.gain.setValueAtTime(0.0001, t);
				g.gain.exponentialRampToValueAtTime(0.3, t + 0.01);
				g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
				o.connect(g);
				g.connect(beepCtx.destination);
				o.start(t);
				o.stop(t + 0.27);
			}
		} catch (e) {}
	}

	function timerLeft(cfg) {
		if (cfg.endAt) return Math.max(0, cfg.endAt - Date.now());
		if (cfg.left != null) return cfg.left;
		return (cfg.dur || 300) * 1000;
	}
	function mmss(ms) {
		var s = Math.ceil(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
		return (h ? h + ":" + two(m) : m) + ":" + two(s % 60);
	}

	types.timer = {
		name: "Timer", desc: "Tap to start, beeps when done", icon: "timer", group: "everyday",
		w: 2, h: 1, minW: 1, minH: 1, maxW: 4, maxH: 3,
		defaults: function () { return { dur: 300 }; },
		tickMs: function (t) { return t.cfg && t.cfg.endAt ? 1000 : 0; },
		build: function (ctx) {
			var cfg = ctx.tile.cfg || (ctx.tile.cfg = { dur: 300 });
			ctx.body.innerHTML = '<div class="tm"><button class="tm-adj" data-a="-">−</button><button class="tm-main"><b class="tm-t"></b><span class="tm-s"></span></button><button class="tm-adj" data-a="+">+</button></div><div class="chips tm-pre"></div>';
			var tEl = ctx.body.querySelector(".tm-t"), sEl = ctx.body.querySelector(".tm-s"), pre = ctx.body.querySelector(".tm-pre");
			[1, 3, 5, 10, 15, 25, 30, 45, 60].forEach(function (m) {
				var c = el("button", "chip", m + " min");
				c.addEventListener("click", function (e) {
					e.stopPropagation();
					if (App.editing) return;
					cfg.dur = m * 60; cfg.endAt = 0; cfg.left = null; cfg.done = false;
					changed();
				});
				pre.appendChild(c);
			});
			function changed() {
				Editor.save();
				App.refreshNeeds();
				App.dirty();
				ensureTicker();
			}
			ctx.body.querySelector(".tm-main").addEventListener("click", function (e) {
				e.stopPropagation();
				if (App.editing) return;
				if (ctx.body.__noClick) { ctx.body.__noClick = false; return; }
				if (cfg.done) { cfg.done = false; cfg.left = null; cfg.endAt = 0; }
				else if (cfg.endAt) { cfg.left = timerLeft(cfg); cfg.endAt = 0; }
				else { cfg.endAt = Date.now() + timerLeft(cfg); cfg.left = null; }
				changed();
			});
			ctx.body.querySelectorAll(".tm-adj").forEach(function (b) {
				b.addEventListener("click", function (e) {
					e.stopPropagation();
					if (App.editing) return;
					var step = b.dataset.a === "+" ? 60000 : -60000;
					if (cfg.endAt) cfg.endAt = Math.max(Date.now() + 1000, cfg.endAt + step);
					else if (cfg.left != null) cfg.left = Math.max(1000, cfg.left + step);
					else cfg.dur = U.clamp((cfg.dur || 300) + step / 1000, 60, 24 * 3600);
					cfg.done = false;
					changed();
				});
			});
			// Hold the time to reset.
			var hold = null;
			ctx.body.querySelector(".tm-main").addEventListener("pointerdown", function () {
				clearTimeout(hold);
				hold = setTimeout(function () {
					cfg.endAt = 0; cfg.left = null; cfg.done = false;
					U.toast("Timer reset");
					changed();
					ctx.body.__noClick = true;
				}, 800);
			});
			["pointerup", "pointercancel", "pointerleave"].forEach(function (n) {
				ctx.body.querySelector(".tm-main").addEventListener(n, function () { clearTimeout(hold); });
			});
			return function () {
				var left = timerLeft(cfg), running = !!cfg.endAt;
				setText(tEl, cfg.done ? "Done!" : mmss(left));
				setText(sEl, cfg.done ? "Tap to stop" : running ? "Tap to pause · hold to reset" : cfg.left != null ? "Paused · tap to go on" : "Tap to start");
				ctx.node.classList.toggle("running", running);
				ctx.node.classList.toggle("done", !!cfg.done);
				pre.style.display = running || cfg.left != null || cfg.done ? "none" : "";
			};
		},
	};

	/* Timers keep counting on other pages too, and beep when done. */
	var ticker = null;
	function allTiles(type) {
		var out = [];
		Editor.layout().pages.forEach(function (p) { p.tiles.forEach(function (t) { if (t.type === type) out.push(t); }); });
		return out;
	}
	function ensureTicker() {
		var any = allTiles("timer").some(function (t) { return t.cfg && t.cfg.endAt; });
		if (any && !ticker) ticker = setInterval(checkTimers, 1000);
		if (!any && ticker) { clearInterval(ticker); ticker = null; }
	}
	function checkTimers() {
		allTiles("timer").forEach(function (t) {
			var c = t.cfg;
			if (c && c.endAt && c.endAt <= Date.now()) {
				c.endAt = 0; c.left = null; c.done = true;
				Editor.save();
				beep(4);
				U.toast("Timer done!");
				if (typeof Look !== "undefined") Look.wake();
				App.refreshNeeds();
				App.dirty();
			}
		});
		ensureTicker();
	}

	/* ------------------------------------------------------------------ countdown */
	types.countdown = {
		name: "Countdown", desc: "Days until something you look forward to", icon: "flag", group: "everyday",
		w: 2, h: 1, minW: 1, minH: 1, maxW: 4, maxH: 2, tickMs: 60000,
		defaults: function () {
			var d = new Date(), x = new Date(d.getFullYear(), 11, 24, 18, 0);
			if (x < d) x = new Date(d.getFullYear() + 1, 11, 24, 18, 0);
			return { title: "Christmas Eve", at: x.getTime() };
		},
		edit: function (t, back) { editCountdown(t, back); },
		build: function (ctx) {
			var cfg = ctx.tile.cfg || {};
			ctx.body.innerHTML = head("flag", cfg.title || "Countdown") + '<div class="big"><b class="v"></b><span class="s"></span></div>';
			var v = ctx.body.querySelector(".v"), s = ctx.body.querySelector(".s");
			return function () {
				var ms = (cfg.at || 0) - Date.now();
				var d = new Date(cfg.at || 0);
				if (ms <= 0) {
					setHtml(v, ms > -86400000 ? "Today!" : "Done");
					setText(s, d.toLocaleDateString("en-GB", { day: "numeric", month: "long" }));
					return;
				}
				var days = Math.floor(ms / 86400000), hrs = Math.floor((ms % 86400000) / 3600000), mins = Math.floor((ms % 3600000) / 60000);
				setHtml(v, days >= 1 ? days + "<small>" + (days === 1 ? " day" : " days") + "</small>" + (days < 3 ? " " + hrs + "<small> h</small>" : "") : hrs + "<small> h</small> " + mins + "<small> min</small>");
				setText(s, d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined }) + " " + hm(d));
			};
		},
	};

	function editCountdown(t, back) {
		var cfg = t.cfg || (t.cfg = types.countdown.defaults());
		var work = { title: cfg.title || "", at: new Date(cfg.at || Date.now() + 7 * 86400000) };
		var wrap = el("div", "opts");
		Editor.modal("Countdown", wrap, back);
		function draw() {
			wrap.innerHTML = "";
			var s1 = el("div", "opt");
			s1.appendChild(el("h4", "", "What are you counting down to?"));
			var input = el("input", "search");
			input.maxLength = 30;
			input.value = work.title;
			input.addEventListener("input", function () { work.title = input.value; });
			s1.appendChild(input);
			var chips = el("div", "chips cd-chips");
			["Holiday", "Birthday", "Flight", "Weekend", "Christmas Eve", "New Year", "Game release", "Payday"].forEach(function (n) {
				var c = el("button", "chip" + (work.title === n ? " on" : ""), esc(n));
				c.addEventListener("click", function () {
					work.title = n;
					var now = new Date();
					if (n === "Christmas Eve") { work.at = new Date(now.getFullYear(), 11, 24, 18, 0); if (work.at < now) work.at.setFullYear(now.getFullYear() + 1); }
					if (n === "New Year") work.at = new Date(now.getFullYear() + 1, 0, 1, 0, 0);
					if (n === "Weekend") { var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ((5 - now.getDay() + 7) % 7 || 7), 16, 0); work.at = d; }
					draw();
				});
				chips.appendChild(c);
			});
			s1.appendChild(chips);
			wrap.appendChild(s1);

			var s2 = el("div", "opt");
			s2.appendChild(el("h4", "", "When"));
			var a = work.at;
			s2.appendChild(el("p", "cd-when", esc(a.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) + " · " + hm(a))));
			var steps = el("div", "cd-steps");
			[["Day", function (n) { a.setDate(a.getDate() + n); }], ["Month", function (n) { a.setMonth(a.getMonth() + n); }], ["Year", function (n) { a.setFullYear(a.getFullYear() + n); }],
				["Hour", function (n) { a.setHours(a.getHours() + n); }], ["Minutes", function (n) { a.setMinutes(a.getMinutes() + n * 15); }]].forEach(function (st) {
				var g = el("div", "cd-step", '<button class="pill">−</button><span>' + st[0] + '</span><button class="pill">+</button>');
				var bs = g.querySelectorAll("button");
				bs[0].addEventListener("click", function () { st[1](-1); draw(); });
				bs[1].addEventListener("click", function () { st[1](1); draw(); });
				steps.appendChild(g);
			});
			s2.appendChild(steps);
			wrap.appendChild(s2);

			var save = el("button", "pill accent save-btn", "Save");
			save.addEventListener("click", function () {
				t.cfg = { title: (work.title || "").trim().slice(0, 30) || "Countdown", at: work.at.getTime() };
				Editor.saveTile(t, back);
			});
			wrap.appendChild(save);
		}
		draw();
	}

	/* ------------------------------------------------------------------ world clock */
	var CITIES = [
		["Europe/London", "London"], ["America/New_York", "New York"], ["America/Chicago", "Chicago"], ["America/Denver", "Denver"],
		["America/Los_Angeles", "Los Angeles"], ["America/Sao_Paulo", "São Paulo"], ["Atlantic/Reykjavik", "Reykjavik"], ["Europe/Paris", "Paris"],
		["Europe/Istanbul", "Istanbul"], ["Asia/Dubai", "Dubai"], ["Asia/Kolkata", "Delhi"], ["Asia/Bangkok", "Bangkok"], ["Asia/Singapore", "Singapore"],
		["Asia/Shanghai", "Beijing"], ["Asia/Tokyo", "Tokyo"], ["Australia/Sydney", "Sydney"], ["Pacific/Auckland", "Auckland"], ["UTC", "UTC / Zulu"],
		["America/Anchorage", "Anchorage"], ["Pacific/Honolulu", "Honolulu"], ["Europe/Copenhagen", "Copenhagen"],
	];
	var cityName = {};
	CITIES.forEach(function (c) { cityName[c[0]] = c[1]; });

	types.worldclock = {
		name: "World clock", desc: "The time in other cities (and Zulu)", icon: "globe2", group: "everyday",
		w: 2, h: 1, minW: 1, minH: 1, maxW: 4, maxH: 4, tickMs: 30000,
		defaults: function () { return { zones: ["America/New_York", "UTC"] }; },
		options: function () {
			return [{ key: "zones", label: "Cities", type: "multi", "default": ["UTC"], layout: "list",
				choices: CITIES.map(function (c) { return { value: c[0], label: c[1] }; }) }];
		},
		build: function (ctx) {
			var zones = ((ctx.tile.cfg || {}).zones || ["UTC"]).filter(function (z) { return cityName[z]; }).slice(0, Math.max(1, ctx.h * 2 + (ctx.w > 2 ? ctx.h : 0)));
			ctx.body.innerHTML = '<div class="wc"></div>';
			var box = ctx.body.querySelector(".wc");
			var rows = zones.map(function (z) {
				var r = el("div", "wc-row", '<span class="wc-city"></span><b class="wc-time"></b><em class="wc-diff"></em>');
				r.querySelector(".wc-city").textContent = cityName[z];
				box.appendChild(r);
				return { z: z, time: r.querySelector(".wc-time"), diff: r.querySelector(".wc-diff") };
			});
			return function () {
				var now = new Date();
				rows.forEach(function (r) {
					try {
						var parts = new Intl.DateTimeFormat("en-GB", { timeZone: r.z, hour: "2-digit", minute: "2-digit", hour12: !Cfg.clock24h, day: "numeric", month: "numeric" }).formatToParts(now);
						var get = function (k) { var p = parts.filter(function (x) { return x.type === k; })[0]; return p ? p.value : ""; };
						setText(r.time, get("hour") + ":" + get("minute") + (Cfg.clock24h ? "" : " " + get("dayPeriod").toUpperCase()));
						var dd = +get("day") - now.getDate();
						if (dd > 1) dd = -1; else if (dd < -1) dd = 1; // month changes
						setText(r.diff, dd > 0 ? "+1 day" : dd < 0 ? "−1 day" : "");
					} catch (e) { setText(r.time, "--"); }
				});
			};
		},
	};

	/* ------------------------------------------------------------------ notes */
	types.notes = {
		name: "Note", desc: "A short note you type", icon: "note", group: "everyday",
		w: 2, h: 2, minW: 1, minH: 1, maxW: 6, maxH: 4,
		defaults: function () { return { text: "", style: "sticky" }; },
		edit: function (t, back) { editNote(t, back); },
		build: function (ctx) {
			var cfg = ctx.tile.cfg || {};
			ctx.node.classList.add("press", "note-" + (cfg.style || "sticky"));
			ctx.body.innerHTML = '<div class="nt-text"></div>';
			var tx = ctx.body.querySelector(".nt-text");
			var text = cfg.text || "";
			tx.textContent = text || "Tap to write a note";
			tx.classList.toggle("empty", !text);
			var len = text.length / (ctx.w * ctx.h);
			tx.style.fontSize = len < 25 ? "1.35em" : len < 60 ? "1.1em" : len < 120 ? "0.95em" : "0.8em";
			ctx.node.addEventListener("click", function () { if (!App.editing) editNote(ctx.tile); });
			return null;
		},
	};

	function editNote(t, back) {
		var cfg = t.cfg || (t.cfg = { text: "", style: "sticky" });
		var wrap = el("div", "opts note-edit");
		Editor.modal("Note", wrap, back);
		wrap.innerHTML = '<textarea class="search nt-area" maxlength="600" placeholder="Write something…"></textarea><div class="chips"></div>';
		var area = wrap.querySelector("textarea");
		area.value = cfg.text || "";
		var style = cfg.style || "sticky";
		var chips = wrap.querySelector(".chips");
		[["sticky", "Yellow note"], ["plain", "Plain"], ["accent", "Accent color"]].forEach(function (s) {
			var c = el("button", "chip" + (style === s[0] ? " on" : ""), s[1]);
			c.addEventListener("click", function () {
				style = s[0];
				chips.querySelectorAll(".chip").forEach(function (x) { x.classList.toggle("on", x === c); });
			});
			chips.appendChild(c);
		});
		var save = el("button", "pill accent save-btn", "Save");
		save.addEventListener("click", function () {
			t.cfg = { text: area.value.slice(0, 600), style: style };
			Editor.saveTile(t, back);
		});
		// Type on the panel itself (Round 9): an on-screen keyboard under the note.
		if (window.Round8b) wrap.insertBefore(Round8b.keyboard(area, null, function () { save.click(); }, "Save"), wrap.querySelector(".chips"));
		wrap.appendChild(save);
		setTimeout(function () { try { area.focus(); } catch (e) {} }, 50);
	}

	/* ------------------------------------------------------------------ doodle */
	types.doodle = {
		name: "Doodle", desc: "Draw with your finger", icon: "brush", group: "everyday",
		w: 2, h: 2, minW: 1, minH: 1, maxW: 6, maxH: 4,
		edit: function (t, back) { draw(t, back); },
		build: function (ctx) {
			var cfg = ctx.tile.cfg || {};
			ctx.node.classList.add("press");
			ctx.body.innerHTML = cfg.img ? '<img class="dd-img" alt="" />' : '<div class="notice small"><b>' + svg("brush") + "</b><span>Tap to draw</span></div>";
			if (cfg.img) ctx.body.querySelector("img").src = cfg.img;
			ctx.node.addEventListener("click", function () { if (!App.editing) draw(ctx.tile, null, ctx.node); });
			return null;
		},
	};

	/* Drawing happens on a full-screen layer (not inside a dialog), so finger positions are exact. */
	function draw(t, back, node) {
		var cfg = t.cfg || (t.cfg = {});
		Editor.closeModal();
		var layer = el("div", "dd-layer");
		var colors = ["#14213a", "#e5484d", "#f5a524", "#2fb36a", "#3b82f6", "#a855f7", "#ffffff"];
		layer.innerHTML = '<div class="dd-tools"></div><div class="dd-stage"><canvas class="dd-canvas"></canvas></div>' +
			'<div class="dd-bar"><button class="pill danger dd-clear">Clear</button><button class="pill dd-cancel">Cancel</button><button class="pill accent dd-save">Save</button></div>';
		document.body.appendChild(layer);
		var tools = layer.querySelector(".dd-tools"), canvas = layer.querySelector("canvas"), stage = layer.querySelector(".dd-stage");
		var color = colors[0], size = 6, eraser = false;
		colors.forEach(function (c, i) {
			var b = el("button", "dd-color" + (i === 0 ? " on" : ""));
			b.style.background = c;
			b.addEventListener("click", function () {
				color = c;
				eraser = false;
				er.classList.remove("accent");
				tools.querySelectorAll(".dd-color").forEach(function (x) { x.classList.toggle("on", x === b); });
			});
			tools.appendChild(b);
		});
		[3, 6, 14].forEach(function (sz) {
			var b = el("button", "dd-size" + (sz === size ? " on" : ""), "<i></i>");
			b.querySelector("i").style.width = b.querySelector("i").style.height = sz + 4 + "px";
			b.addEventListener("click", function () {
				size = sz;
				tools.querySelectorAll(".dd-size").forEach(function (x) { x.classList.toggle("on", x === b); });
			});
			tools.appendChild(b);
		});
		var er = el("button", "pill dd-eraser", "Eraser");
		er.addEventListener("click", function () { eraser = !eraser; er.classList.toggle("accent", eraser); });
		tools.appendChild(er);

		// The canvas has the tile's shape, as big as fits.
		var aspect = node && node.offsetHeight ? node.offsetWidth / node.offsetHeight : (t.w || 2) / (t.h || 2);
		var box = stage.getBoundingClientRect();
		var cw = box.width, ch = cw / aspect;
		if (ch > box.height) { ch = box.height; cw = ch * aspect; }
		canvas.style.width = Math.floor(cw) + "px";
		canvas.style.height = Math.floor(ch) + "px";
		canvas.width = Math.round(cw);
		canvas.height = Math.round(ch);
		var g = canvas.getContext("2d");
		g.lineCap = g.lineJoin = "round";
		var scaleUi = Math.max(1, Cfg.scale || 1);
		if (cfg.img) {
			var img = new Image();
			img.onload = function () { g.drawImage(img, 0, 0, canvas.width, canvas.height); };
			img.src = cfg.img;
		}
		var last = null;
		function pos(e) {
			var r = canvas.getBoundingClientRect();
			return { x: (e.clientX - r.left) / r.width * canvas.width, y: (e.clientY - r.top) / r.height * canvas.height };
		}
		function stroke(a, b) {
			g.globalCompositeOperation = eraser ? "destination-out" : "source-over";
			g.strokeStyle = color;
			g.lineWidth = (eraser ? size * 3 : size) * scaleUi;
			g.beginPath();
			g.moveTo(a.x, a.y);
			g.lineTo(b.x, b.y);
			g.stroke();
		}
		canvas.addEventListener("pointerdown", function (e) {
			try { canvas.setPointerCapture(e.pointerId); } catch (x) {}
			last = pos(e);
			stroke(last, { x: last.x + 0.1, y: last.y });
		});
		canvas.addEventListener("pointermove", function (e) {
			if (!last) return;
			var p = pos(e);
			stroke(last, p);
			last = p;
		});
		["pointerup", "pointercancel"].forEach(function (n) { canvas.addEventListener(n, function () { last = null; }); });
		function close() { if (layer.parentNode) layer.parentNode.removeChild(layer); }
		layer.querySelector(".dd-clear").addEventListener("click", function () { g.clearRect(0, 0, canvas.width, canvas.height); });
		layer.querySelector(".dd-cancel").addEventListener("click", close);
		layer.querySelector(".dd-save").addEventListener("click", function () {
			// Kept small so the layout and backups stay light.
			var out = document.createElement("canvas");
			var sc = Math.min(1, 700 / canvas.width);
			out.width = Math.round(canvas.width * sc);
			out.height = Math.round(canvas.height * sc);
			out.getContext("2d").drawImage(canvas, 0, 0, out.width, out.height);
			var data = g.getImageData(0, 0, canvas.width, canvas.height).data, blank = true;
			for (var i = 3; i < data.length; i += 16) if (data[i] > 0) { blank = false; break; }
			t.cfg = blank ? {} : { img: out.toDataURL("image/png") };
			close();
			Editor.save();
			App.render();
		});
	}

	/* ------------------------------------------------------------------ screenshots */
	types.screenshots = {
		name: "Screenshots", desc: "Your newest screenshots · tap to open", icon: "screenshot", group: "everyday", helper: true,
		w: 3, h: 2, minW: 1, minH: 1, maxW: 6, maxH: 4, tickMs: 30000,
		build: function (ctx) {
			var built = false, grid, shown = "";
			var count = Math.max(1, Math.min(12, ctx.w * ctx.h - (ctx.h > 1 ? Math.ceil(ctx.w / 2) : 0)));
			return function () {
				if (helperGate(ctx) === true) return (built = false);
				if (!built) {
					ctx.body.innerHTML = (ctx.h > 1 ? '<div class="th">' + svg("screenshot") + '<span>Screenshots</span><button class="pill ss-folder">Open folder</button></div>' : "") + '<div class="ss-grid"></div>';
					grid = ctx.body.querySelector(".ss-grid");
					grid.style.setProperty("--n", count);
					var fb = ctx.body.querySelector(".ss-folder");
					if (fb) fb.addEventListener("click", function (e) { e.stopPropagation(); if (!App.editing) Helper.act({ action: "screensFolder" }); });
					grid.addEventListener("click", function (e) {
						var b = e.target.closest("[data-id]");
						if (b && !App.editing) { e.stopPropagation(); Helper.act({ action: "openScreen", id: b.dataset.id }); }
					});
					shown = "";
					built = true;
				}
				var c = cached("screens", 30000, function () { return Helper.fetch("/api/screens", { cache: "no-store" }, 8000).then(function (r) { return r.screens || []; }); });
				if (!c.data) return setHtml(grid, '<div class="notice small"><span>' + (c.err ? "Couldn't load screenshots" : "Loading…") + "</span></div>");
				var list = c.data.slice(0, count);
				var key = list.map(function (s) { return s.id; }).join(",");
				if (key === shown) return;
				shown = key;
				grid.innerHTML = list.length ? list.map(function (s) {
					return '<button class="ss-item" data-id="' + esc(s.id) + '"><img alt="" loading="lazy" src="' + esc(Helper.base() + "/api/screen?id=" + encodeURIComponent(s.id)) + '" /><em>' + esc(ago(s.time)) + "</em></button>";
				}).join("") : '<div class="notice small"><span>No screenshots yet. Win+Shift+S or Win+Alt+PrtScn saves them.</span></div>';
			};
		},
	};

	/* ------------------------------------------------------------------ clipboard */
	types.clipboard = {
		name: "Clipboard", desc: "Your last copied texts · tap to copy again", icon: "clipboard", group: "everyday", helper: true, parts: ["clipboard"],
		w: 2, h: 2, minW: 2, minH: 1, maxW: 4, maxH: 4,
		build: function (ctx) {
			var built = false, list, offBtn;
			return function () {
				if (helperGate(ctx) === true) return (built = false);
				if (!built) {
					ctx.body.innerHTML = '<div class="th">' + svg("clipboard") + '<span>Clipboard</span><button class="pill cb-clear">Clear</button><button class="pill cb-off">Turn off</button></div><div class="cb-list"></div><div class="mix-more"></div>';
					list = ctx.body.querySelector(".cb-list");
					offBtn = ctx.body.querySelector(".cb-off");
					U.dragScroll(list, ctx.body.querySelector(".mix-more"));
					ctx.body.querySelector(".cb-clear").addEventListener("click", function (e) {
						e.stopPropagation();
						if (App.editing) return;
						Helper.state.clipboard = { on: true, items: [] };
						App.dirty();
						Helper.act({ action: "clipClear" });
					});
					offBtn.addEventListener("click", function (e) {
						e.stopPropagation();
						if (App.editing) return;
						Helper.state.clipboard = { on: false, items: [] };
						App.dirty();
						Helper.act({ action: "clipboard", on: false });
					});
					list.addEventListener("click", function (e) {
						if (App.editing) return;
						var on = e.target.closest(".cb-on");
						if (on) {
							e.stopPropagation();
							Helper.state.clipboard = { on: true, items: [] };
							App.dirty();
							return Helper.act({ action: "clipboard", on: true });
						}
						var r = e.target.closest("[data-i]");
						if (r) {
							e.stopPropagation();
							Helper.act({ action: "clipCopy", index: +r.dataset.i }).then(function (ok) { if (ok) U.toast("Copied. Paste it with Ctrl+V"); });
						}
					});
					built = true;
				}
				var c = Helper.state.clipboard;
				ctx.body.querySelectorAll(".th .pill").forEach(function (b) { b.style.display = c && c.on ? "" : "none"; });
				if (!c) return setHtml(list, '<div class="notice small"><span>Loading…</span></div>');
				if (!c.on) return setHtml(list, '<div class="notice small cb-offnote"><span>Keeps the last 10 texts you copy, so you can copy them again from here. Only in memory, never saved to disk. Passwords you copy are kept too, until you clear it or turn it off.</span><button class="pill accent cb-on">Turn on</button></div>');
				if (!c.items.length) return setHtml(list, '<div class="notice small"><span>Copy some text on your PC (Ctrl+C) and it shows up here</span></div>');
				setHtml(list, c.items.map(function (t, i) {
					return '<button class="cb-row" data-i="' + i + '">' + esc(t.replace(/\s+/g, " ").slice(0, 200)) + "</button>";
				}).join(""));
			};
		},
	};

	ensureTicker();

	return {
		ensureTicker: ensureTicker,
		parseIcs: parseIcs,
		parseFeed: parseFeed,
	};
})();
