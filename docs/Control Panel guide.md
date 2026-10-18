> **Note:** this guide was written when the tray program was called *Control Panel Helper*. It's now **Control Hub Service**, and its tray-menu items are also in the **Control Hub** app (Connections and Panel).

# Control Panel

Your own control panel for the CORSAIR XENEON EDGE. Shortcuts with real app icons, folders, media,
speakers and microphone, app mixer, power, gauges, sensors, storage, network and batteries.
Drag, resize and customize everything right on the screen.

There are two parts:

| Folder | What it is |
|---|---|
| `widget/` | The iCUE widget on your XENEON EDGE |
| `helper/` | **Control Panel Helper**, a tiny tray app (icon by the clock) that does the things iCUE doesn't allow widgets to do |

## 1. Build and start the helper (one time)

1. Open the `helper` folder and double-click **`Build Helper.bat`**.
   It uses the C# compiler that's already part of Windows, so there is nothing to install.
   After a few seconds it starts **Control Panel Helper**.
2. Look for its icon by the clock (click the small **^** arrow).
   Right-click it for:
   - **Add a program…** — pick any .exe or shortcut that isn't in your Start menu
   - **Add a website…** — for example your favorite flight tracker
   - **Your added shortcuts** — remove ones you don't need
   - **Open pictures folder / Open backups folder**
   - **Start with Windows** — on by default
   - **Quit**
3. From now on it starts by itself with Windows. There's no window, it uses about 15–25 MB of
   memory and close to 0% CPU, and it only does work when you tap something on the screen.

If the build shows an error, copy everything in the window and send it to Claude.

## 2. Install the widget

1. Double-click **`package-widget.bat`** (needs Node.js; installs Corsair's widget tool the first time).
2. Double-click the `.icuewidget` file it makes (or iCUE → Widgets → **+**).
3. Put **Control Panel** on your XENEON EDGE in any size. Remove the older FlightLine Deck / Control Panel versions if you added them.

## 3. Make it yours

- Tap **Edit** (top right) or hold anywhere for a second.
- **Drag** a tile to move it. **Drag the ↘ corner** to resize it.
- **✕** removes, **✏** edits (pick the app, sensors or folder name), **⧉** duplicates.
- **+ Add tile** opens the tile list.
- **Folders:** drag a tile onto a folder to put it inside. Tap the folder to open it.
  While editing, the folder lets you add shortcuts, edit them, remove them or move them back out.
- **Hidden** shows tiles that don't fit at the current widget size.
- **Pages** opens the page list (see below).
- **Done** saves.

Shortcuts: tap ✏ on a shortcut tile and choose from
- **Apps** — everything installed on your PC, with its real icon (needs the helper)
- **Websites** — common sites and the ones you added in the helper
- **Quick actions** — Desktop, Screenshot, Task Manager, Settings, File Explorer, Calculator, Sound settings, Lock PC

## Pages

- Tap **Edit → Pages** to add, rename, reorder or delete pages.
- **Swipe left or right** on the screen to change page, or tap the dots at the bottom.
- While editing, **drag a tile onto a page name** (top left) or dot to move it to that page.
- **Automatic pages:** in a page's ✏, pick a program (Flight Simulator, OBS, a game that's running…).
  When it starts, the panel jumps to that page, and goes back to the page you were on when it closes (you can switch that off).
  Windows tells the helper the moment a window opens or closes, so the switch is almost instant. A game that closes and
  starts again within 3 seconds (launcher → game) doesn't make the page jump back and forth.
- Pick Counter-Strike 2 or Flight Simulator for an empty page and you can fill it with suggested tiles in one go.

## Backup

Your layout (all pages, tiles and buttons) is copied to your PC a few seconds after every change.
If iCUE ever starts the widget empty (after an update or reinstall), your layout comes back by itself.
A dated backup is also kept every few hours. **Edit → Pages → Back up now** makes one right away,
**Restore…** brings an older one back (the layout you had is kept as a backup too).
**Save to a file… / Open a file…** saves your whole layout as a file you can keep anywhere.

## Look and feel (iCUE widget settings)

- **Tiles: Solid or Glass** (frosted see-through tiles, best with your own background image) and how strong the glass effect is.
- **Accent color from album cover** — the accent color follows what's playing. Switch it off to keep your own color.
- **Tap sound** — a soft click when you tap (off by default).
- **Screensaver** — after the chosen time without a tap, a big clock and the song that's playing. Tap to wake.
- **Night mode** — dims the panel between the times you choose (e.g. 22:00 to 07:00).

In iCUE's widget settings: **tile size** (Small, Medium, Large, Extra large), theme (Navy, Dark, Teal, Light), background (contour lines, plain, or your
own image), accent color, transparency, 24-hour clock, website logos on/off, and the Edit button.

## Tiles

| Tile | Needs the helper? |
|---|---|
| Shortcut, Folder | Apps: yes. Websites and some quick actions also work without it |
| **Custom button** — key combos, several steps, on/off switches, templates | Mostly yes |
| Media (cover, play/pause, skip) | No (iCUE) |
| Speakers, Microphone — ✏ picks the device (e.g. your headphones), tap the tile to mute | Yes |
| Mic indicator — big LIVE / MUTED, tap to switch | Yes |
| Audio output — tap to switch between headphones and speakers | Yes |
| App mixer (volume per app, swipe to scroll) | Yes |
| Power (lock, sleep, restart, shut down — asks "Are you sure?") | Yes |
| Keep awake (stops Windows from sleeping or turning off the screen) | Yes |
| Gauges, Sensors (CPU, GPU, temperatures, fans…) | No (iCUE sensors) |
| Network (tap to measure; ✏ for Mbit/s or MB/s), Storage | Yes |
| Batteries (wireless CORSAIR devices) | No (iCUE) |
| Clock (✏: centered/left, 12/24 h, seconds, date), FPS | No (iCUE) |

## PC and gaming tiles (Add tile → PC and gaming)

| Tile | What it does |
|---|---|
| Ping | Your ping with a small graph. ✏: Cloudflare, Google or your router |
| Speed test | Tap to run a real speed test (download, upload, ping) against Cloudflare's servers. About 20 seconds, and only when you tap |
| Now playing | The game or app in front, how long it has been open, and FPS |
| Temperature alert | CPU and GPU temperature. ✏ sets the limits. Too hot: the tile and the whole panel edge glow red, on any page |
| CPU & GPU | Load in big percent numbers with a bar (and temperatures when the tile is tall enough). ✏ to pick other sensors |
| Programs | The programs using the most CPU or RAM. Tap one to close it (asks first; if it won't close, you can force it) |
| PC on for | How long since the PC was started |
| Disk activity | Read and write speed of each drive |
| Discord | Who's in your voice channel, a green ring around whoever talks, real mute / deafen, leave the call. Needs a one-time connection (below) |
| Brightness | Only the XENEON EDGE, never your main screen. If the EDGE takes brightness from Windows it changes the screen; otherwise it dims the Control Panel. Night light gives the panel a warm tint |

All of them need the helper, except Temperature alert and Graph (with iCUE sensors).
Nothing is measured unless the tile is on the screen.

## Round 6 tiles

| Tile | What it does |
|---|---|
| Window switcher (PC) | Your open windows. Tap to bring one to the front, hold to close it |
| App audio output (Audio) | Pick headphones, speakers or default for each app that plays sound. Some apps switch after their next sound, some after a restart |
| Mic level (Audio) | A live bar showing your mic picking you up (Windows shows "mic in use" while the tile is on screen) |
| Do Not Disturb (PC) | Windows notifications off / on |
| Clean-up (PC) | Empties the recycle bin and temporary files older than a day (asks first) |
| Spotify (Audio) | What plays, shuffle, repeat, like, your playlists and up next. One-time setup (How? on the tile). Changing what plays needs Spotify Premium |
| Twitch live (Audio) | Who you follow is live; tap to watch. One-time setup (How? on the tile) |
| Steam games (PC) | Your installed games, last played first; tap to start. ✏ → Friends online needs a free Steam Web API key (helper icon → Steam Web API key…) |
| Stopwatch, Pomodoro (Everyday) | Start/stop/laps; focus 25 min ⇄ break 5 min with a chime |

**Keyboard shortcuts for pages** were removed in helper 2.4.0: Ctrl+Alt+number is AltGr+number on a Danish keyboard and blocked typing @, $, { and more.
Switch them off in the helper menu if another program uses them.

## Round 7 tiles

| Tile | What it does |
|---|---|
| Spotify volume (Audio) | Spotify's own volume (the one in the Spotify app) as a big slider. ✏ → horizontal or vertical. Tap the icon to mute |
| App volume (Audio) | A big slider for one app: Discord, Flight Simulator, CS2, Spotify, a browser, SayIntentions or anything playing sound. Horizontal or vertical |
| Notifications (PC) | Your latest Windows notifications; tap one to open the app |
| Game launcher (PC) | Big covers of your games (Steam and other apps); tap to play. ✏ to pick them |
| System health (PC) | Quiet until something needs you: a drive almost full, Windows updates waiting or a restart pending, a very hot CPU/GPU, memory almost full |
| Weather radar (Everyday) | Rain radar for the last hour (RainViewer), animated. Your weather place, or your SimBrief departure/destination |
| Flight mode (Flight sim) | A custom button: MSFS, SimBrief, SayIntentions, Do Not Disturb, headphones and your flight page. Tap again to go back to normal |
| CS2 mode (CS2) | The same idea for Counter-Strike 2 |
| CS2 score, you, weapon, bomb timer, round kills, match history (CS2) | Live from your match (see below) |

**Notification banners:** new Windows notifications slide down from the top of the panel like on a phone.
Tap to open the app, swipe up to hide, hold to stop banners from that app. Settings in **Edit → Pages**
(on/off, how long, quiet during MSFS takeoff/landing and during a CS2 round). Do Not Disturb hides them too.

**Custom buttons** can now also: turn Do Not Disturb on/off, show a page, start a Steam game, and
remember / go back to your sound output and page.

### Counter-Strike 2

Uses Valve's own **Game State Integration**: CS2 sends your score, health, money, weapon and so on to the helper.
It's a small text file in CS2's `cfg` folder (`gamestate_integration_controlpanel.cfg`) — the same thing iCUE's CS2
lighting, SteelSeries and Logitech use. It doesn't change or read the game, so it's VAC-safe. Delete the file to remove it.
Set it up with the button on a CS2 tile, or helper icon → **Set up Counter-Strike 2…**, then restart CS2.
CS2 only shares your own info (or the player you watch while dead), never other players' positions or money.

## Round 7B flight tiles (Add tile → Flight sim)

| Tile | What it does |
|---|---|
| Flight plan (OFP) | Your SimBrief plan to scroll through: Route (fix, airway, FL, time, fuel; the next fix is highlighted while you fly), Fuel, Weights, Info |
| Approach briefing | Arrival runway (length, heading, elevation), the wind split into head/tail and crosswind for that runway, visibility and ceiling, QNH, ATIS/Tower/Approach, landing weight and arrival time. ILS frequency and minimums aren't in any free data, so check those on your chart |
| Taxi helper | A simple map of the airport's runways with your runway highlighted, your plane, and the gate SayIntentions gave you (plus SayIntentions' taxi route and the Ground frequency) |
| Airline stats | Block hours, flights, average and best landing, favourite airports and aircraft, longest flight, grades |
| Landing replay | A grade (A+ to F), landing rate, G, how far past the threshold you touched down and how far from the centerline, on a little runway picture |
| Live map | Now also shows the other aircraft around you (AI traffic in the sim, including SayIntentions' traffic). ✏ to switch it off |

Runway data comes from OurAirports (free), downloaded once a month by the helper. SayIntentions doesn't share other
pilots' positions, so the map shows the traffic that's actually in your sim instead.

## The look (Edit → Pages → Look)

**New look** (standard): softer light and shadows on the tiles, smoother page changes and windows, tiles that sink a
little when you tap them, a soft glow on sliders and gauges. **Classic look**: exactly how it looked before.
Your tiles, pages and settings are the same in both.

## Round 8A — panel and design

- **Edit → Look**: style (New/Classic), theme (Cockpit, Midnight, Nordic, Neon or your own accent), size, spacing,
  corner roundness, tinted tiles, animated or video background, page animations, numbers that count up,
  screensaver (flip clock, album cover, world map with day/night), quick menu items, lock, edge swipe, favourite page.
- **Quick menu**: swipe down from the top edge — volume, brightness, Do not disturb, mic, speakers, output, stay awake,
  warm light, lock, screensaver, edit. You choose which buttons show.
- **Hold a tile**: settings, pin to every page, edit, what a double-tap does, tile colour.
- **Edit → Select**: tap several tiles, then move/copy them to another page, pin them or delete them.
- **Undo**: after deleting a tile or page an Undo bar shows for a few seconds.
- **Lock**: stops accidental edits/swipes. Hold the lock for about a second to unlock.
- **Pages**: copy a page, save a page as a template, give each page its own theme.
- **Add tile** has a search box. Clock tile has digital, flip, analog and departure-board styles.

## Round 8B — sound, Discord and Spotify (needs helper 2.2.0: run Build Helper.bat once)

- **Discord volume per person**: tap someone's picture in the Discord tile → a slider (0–200 %) and "Mute this
  person for me". Only you hear the change, like right-clicking them in Discord. A small badge shows when it isn't 100 %.
- **Favourite voice channel**: Discord tile ✏ → pick a channel. A Join button shows when you're not in a call.
  There's also a small **Discord channel** tile, and a Custom button step **Join a Discord voice channel**.
- **Push to talk** tile: hold it to hold your push-to-talk key (Discord, SRS in DCS, games). Pick the key in ✏
  (F13–F20, Mouse button 4/5, Caps Lock, letters…), and "Hold to talk" or "Tap on, tap off". If the panel stops
  answering, the helper lets go of the key by itself after 3 seconds.
- **Sound profiles** tile: set your sound up (output, mic, app volumes, Spotify volume), then ✏ → New profile.
  One tap brings it all back. Also a Custom button step **Sound profile**.
- **Mic test** tile: tap, talk for a few seconds, and hear it played back (Windows default mic and speakers).
  Nothing is kept.
- **Spotify**: **Now playing (big)** tile (or Pages → + → **Music** page) with a big cover, seek bar, volume and
  buttons you choose; **Spotify search** with an on-screen keyboard; **Recently played**; **Save song** (one tap
  saves to your chosen playlist, hold to pick another).
- Recently played and saving to playlists need one new Spotify permission: right-click the helper icon →
  **Connect Spotify…** → Agree (once). The tiles tell you if it's needed.
- Spotify changed its "like" address in 2026; the heart button uses the new one now.

## Round 8C — flight sim and PC (needs helper 2.3.0: run Build Helper.bat once)

Flight sim (Add tile → Flight sim):
- **Next waypoint**: the next fix big, then the following ones with distance and time (Zulu or minutes), and what's
  left to the destination. ✏ chooses how many fixes, the time style and whether TOC/TOD show.
- **Fuel check**: expected fuel at landing at the current burn, your limit, and fuel vs. the plan right where you are.
  ✏ picks the limit (reserve + alternate, final reserve, plan −10 %, or a fixed amount). It turns red and shows a
  banner when you'll land below it.
- **Weather on the route**: METARs for departure, arrival, alternate and airports along the way, coloured
  VFR / MVFR / IFR / LIFR. Tap one for the full report.
- **Scenery check**: whether your departure, arrival and alternate have add-on scenery, and a list of all your
  add-on airports (Community folder and Marketplace). It only reads your sim folders.
- **Flight replay**: the helper records each flight from now on (position and height). Pick a flight, drag along
  the height profile or press play.
- **Pre-flight** button: Add a Custom button → Templates → Pre-flight, then switch on the steps you want (start MSFS,
  SayIntentions and other flight apps it finds, load SimBrief, headset, sound profile, clean-up, Do Not Disturb…).

PC (Add tile → PC):
- **Game clean-up**: pick programs to close before playing (✏). Tap to close them, tap again to open them again.
  Also as button steps (**Close programs** / **Open closed programs again**) and the **Game clean-up** template.
- **Hardware dashboard**: up to 12 values you choose, as rings, bars or big numbers, with history and lowest/highest.
- **Steam downloads**: what Steam is downloading or updating, with progress and speed. Tap to open Steam's downloads.
- **What's using my PC**: CPU, GPU and RAM over the last minutes, and the programs using the most (tap one to close it).

## Where the ready-made pages are

Edit → **Pages** → **+ Add page**. The window lists them by heading: Start here, **My Home**, Flight sim, Games, Music,
Everyday and PC. Picking one adds it as a new page; your own pages are never touched. Rename or reorder it in the same
Pages window.

**My Home**: My Home, Big, Clean and Apps, each twice: first with Extra large tiles, then with Medium tiles. Spotify and
Discord on the right with the Spotify volume, plus a clock and Lock / Sleep / Restart / Shut down. Each opens at its own
tile size, whatever size the rest of the panel uses. App buttons find your apps (Discord, Spotify, Steam, your browser,
OBS…) by name the first time; one that isn't installed shows a "?" — tap Edit, then ✏ to pick something else.

**A different tile size per page**: Pages → ✏ on a page → **Tile size for this page** (Small, Medium, Large,
Extra large, or Same as all pages). The page's tiles are stretched to the new size. A page that doesn't fill the screen
can be stretched: Pages → ✏ → **Stretch tiles to fill the screen**. Page files you save remember their size.

## Round 10 (helper 2.4.1)

- **Lots of ready-made pages**: Pages → Add page, sorted by topic: Flight planning, Approach and landing (shows by itself
  on approach), Big map, Airline and logbook, Flight replay, Gaming hub, Voice and streaming, Spotify, Work and focus,
  Morning, Tools, Night clock, PC monitor and Desk, next to Home, Flight sim, CS2 and Music. Each has its own look and
  every tile can be changed afterwards. Flight mode / CS2 mode buttons on these pages fill in their steps by themselves.
- **App search** tile: find and open apps, Steam games, recent files, downloads and Windows settings with the
  on-screen keyboard (handy when Windows Search acts up).
- **Slideshow**: Edit → Look → Slideshow. When you haven't touched the panel for a while, the pages you pick take turns.
  The first touch stops it; it never runs during a game.
- **Faster**: nothing is redrawn while the screensaver is on or iCUE hides the panel; Discord stops listening while the
  screen sleeps; changing page no longer re-sends your whole layout to the helper; Steam downloads only re-read the
  game files Steam changed.

## Round 9 (needs helper 2.4.0: run Build Helper.bat once)

Fixes:
- **AltGr + number** doesn't switch pages any more (the Ctrl+Alt page shortcuts are gone; on a Danish keyboard they
  blocked typing @, $, {, [ and more).
- **The layout stays put after a restart.** If the panel briefly gets another size while Windows starts, tiles are only
  shown moved for that moment and your layout comes back by itself. The new size is only taken over if you edit then.

Ready-made pages: Pages → Add page → **Home**, **Flight sim** or **CS2** (each with its own look; Flight sim and CS2
show by themselves when the game starts). Also **Open a page from a file**, and in a page's ✏: **Save this page to a file**.

New tiles:
- Flight sim: **Descent planner** (replaces Top of descent: distance and time to the descent, the rate you'll need,
  high or low on the path), **Logbook**, **My airports map**, **Landing trend**, **Day or night** at takeoff and landing.
- CS2: **CS2 buy tip** (your money, loss bonus, full buy / force / save / eco; the amounts are yours to set in ✏),
  **CS2 form** (K/D and wins over your last matches).
- Everyday: **Power price** (Danish electricity price now, today, tomorrow, cheapest hours; add your fees and VAT in ✏),
  **Pollen and air**, **Currency**, **Calculator**, **Day overview**, **Copy board** (texts you paste often).
  The **Note** tile has an on-screen keyboard now.
- PC: **On air** (red when an app uses your mic or camera), **Downloads**, **Recent files**, **Website check**,
  **Device batteries** (Bluetooth devices that report it to Windows).
- Tiles **pulse** softly when they need you (low fuel, bomb planted, website down, low battery…). Look → Motion turns it off.

## Flight sim tiles (Add tile → Flight sim) — MSFS 2024

**One-time setup:** the helper needs `SimConnect.dll` from the free MSFS 2024 SDK.
1. In MSFS 2024: Options → General → Developers → turn on **Developer Mode**.
2. In the bar at the top: **Help → SDK Installer**, then run the installer (keep the folder it suggests).
3. Restart the helper (icon → Quit, start it again). It finds SimConnect.dll by itself.
   Not found? Helper icon → **Find SimConnect.dll…** and pick it in the SDK's `SimConnect SDK\lib` folder.
   The helper keeps its own copy in its settings folder, so you don't have to copy it again after updating the helper.

| Tile | What it does |
|---|---|
| Flight dashboard | IAS, altitude, heading, V/S, ground speed, fuel |
| SimBrief | Your latest plan (✏ for your username). Tap to reload |
| METAR | Weather at departure / arrival (/ alternate), in plain words, with VFR/IFR colors |
| Flight timer | Block and air time; starts and stops by itself |
| Checklist | Fenix A320, iniBuilds A350 and a general one; picks the plane by itself and follows the flight |
| Live map | Your plane and the SimBrief route; + and − to zoom |
| Landing rate | fpm, G, bank and pitch at touchdown, with a rating |
| Radios | COM1 (active / standby), COM2, squawk |
| Flight log | Every flight is saved when you park at the gate (route, plane, block time, landing rate) |
| Fuel planner | Fuel now, fuel at arrival, and what you need (reserve + alternate) |
| Top of descent | NM and minutes to top of descent (3° rule) |
| Frequencies | ATIS, delivery, ground, tower, approach for your airports |
| Sim time | Local time in the sim and Zulu |
| Sim controls | Cockpit / outside / drone camera, pause, sim rate |
| SayIntentions | The ATC station and frequency you're on, and the radio calls as a chat (what ATC said and what you said). The API key is read from SayIntentions' own file while you fly; if not, helper icon → SayIntentions API key… |
| ATC calls | Buttons that make radio calls for you in SayIntentions (✏: your own buttons, COM1 or COM2). {callsign}, {to}, {runway}… are filled in |
| Cabin calls | Buttons that talk to the cabin over SayIntentions' intercom (✏ to change them) |
| ACARS | ACARS / CPDLC / telex messages from SayIntentions |
| ATC flight info | Callsign, route, runways, SID/STAR, gate, taxi route and clearances; *Choose gate* asks SayIntentions for a gate |
| ATC frequencies | SayIntentions' frequencies around you; tap one to tune it (✏: COM1 standby / active, COM2) |

Pages can also switch when SayIntentions clears you for takeoff or to land (Edit → Pages → ✏ → flight phase).

**Flight phase pages:** Edit → Pages → ✏ on a page → *Or during a flight phase*: taxi, takeoff and climb, cruise,
descent and approach, or parked. The panel then switches to that page by itself during the flight.

## Connect Discord (one time, about 5 minutes)

1. On your PC, go to **discord.com/developers/applications** and sign in.
2. **New Application** → name it *Control Panel* → tick the box → **Create**.
3. Left menu: **OAuth2**. Under **Redirects** click **Add Redirect**, type `http://localhost`, click **Save Changes**.
4. Same page: copy the **Client ID**. Click **Reset Secret** → **Yes** → copy the **Client Secret**.
5. Right-click the helper icon by the clock → **Connect Discord…** → paste the Client ID, then the Client Secret.
6. Discord asks if Control Panel may connect: click **Authorize**.

The secret and the login are stored encrypted for your Windows user only. The helper only talks to Discord while a Discord tile
is on the screen. Custom buttons can use it too (step *Discord*: mute, deafen or leave), so no keybinds are needed any more.

## Everyday tiles (Add tile → Everyday)

| Tile | What it does |
|---|---|
| Weather | Now and the next days (free Open-Meteo service). ✏ to pick your city |
| Calendar | Your next two weeks. On the PC: helper icon → **Add a calendar link…** and paste your private iCal link (Google Calendar: Settings → your calendar → *Secret address in iCal format*; Outlook: Settings → Calendar → Shared calendars → *Publish a calendar* → ICS link) |
| News | Headlines from DR, TV 2, BBC, PC Gamer, The Verge or FSElite (✏). Tap one to open it |
| Packages | Your tracking numbers (PostNord, GLS, DAO, Bring, UPS, DHL, FedEx). Tap one to open its tracking page |
| Timer | Tap to start or pause, − and + change it by a minute, hold to reset. Beeps when done, also on other pages |
| Countdown | Days until something (✏ to set what and when) |
| World clock | Times in the cities you pick, including UTC/Zulu |
| Note | A short note. Tap it to write. Yellow, plain or accent color |
| Doodle | Tap to draw with your finger |
| Screenshots | Your newest screenshots (Pictures\Screenshots and Game Bar captures). Tap one to open it |
| Clipboard | The last 10 texts you copied, tap to copy again. Off until you switch it on; kept in memory only |

## Custom buttons

Add tile → **Custom button**, then pick a template or start empty.

- **Templates:** Discord mute, Discord deafen, Save clip (Game Bar), Record, NVIDIA clip, OBS record, OBS stream,
  Game mode, Gaming volume, Discord call, Night, Start my apps, Spotify playlist.
- **Steps** you can combine: open an app, open a website or link, quick action, press keys, set volume,
  mute/unmute, switch audio output, app volume, keep awake, power plan, media control, wait.
- **Switch on / off:** one list of steps for on and another for off (like Game mode).
- **Icon and color:** symbols, real app icons, or your own pictures (helper icon → *Add a button picture…*).
- **Spotify playlists:** in Spotify use Share → Copy link, then helper icon → *Add a website or Spotify playlist…*.
  The playlist then shows up under "Open a website or link".
- **Press keys:** ready-made combos for Discord, Game Bar, NVIDIA and OBS, or build your own. The keys go to the
  window in front, like pressing them yourself. App-wide hotkeys (Discord, Game Bar, NVIDIA, OBS) work anywhere.

## Troubleshooting

- **"Helper not running"** on tiles: double-click `Control Panel Helper.exe` in the `helper` folder, then check its tray icon is there.
- **Changed the port?** It's in `%APPDATA%\ControlPanelHelper\settings.json`; set the same in the widget's iCUE settings.
- **Something odd?** Right-click the tray icon → **Open log file**, and send it to Claude.
