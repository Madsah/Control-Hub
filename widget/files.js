/* Control Panel — the panel's files, in load order (read by scripts/boot.js).
   When the panel loads from Control Hub, Control Hub's own copy of this list is used, so new files arrive with updates.
   "version" must be the same as manifest.json's version. */
CP_FILES = {
	version: "5.1.0",
	styles: [
		"styles/panel.css",
		"styles/fresh.css"
	],
	scripts: [
		"scripts/util.js",
		"scripts/data.js",
		"scripts/tiles.js",
		"scripts/buttons.js",
		"scripts/editor.js",
		"scripts/pages.js",
		"scripts/look.js",
		"scripts/extra.js",
		"scripts/everyday.js",
		"scripts/flight.js",
		"scripts/round6.js",
		"scripts/round7.js",
		"scripts/round7b.js",
		"scripts/round8.js",
		"scripts/round8b.js",
		"scripts/round8c.js",
		"scripts/round9.js",
		"scripts/round10.js",
		"scripts/round11.js",
		"scripts/main.js"
	],
};
