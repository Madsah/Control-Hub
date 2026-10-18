<p align="center"><img src="shared/ControlHub-256.png" width="96" alt="Control Hub logo"></p>

# Control Hub

Control Hub keeps Mads's projects in one place, starting with the **Control Panel** widget for the CORSAIR XENEON EDGE.

- **Control Hub Service** runs quietly in the tray and powers the widget (Spotify, Discord, sound, flight sim and more). It replaces the old *Control Panel Helper*.
- **Control Hub** is the app window: projects, connections, backups and help. It only runs while it's open; the panel never needs it.

## Install

1. Download this repository (**Code → Download ZIP**) and unzip it.
2. Double-click **Install Control Hub.bat**.

The installer:

1. builds both programs with the C# compiler that comes with Windows; if that fails, nothing is changed,
2. installs them in `%LOCALAPPDATA%\Programs\Control Hub`, with no admin needed,
3. adds **Control Hub** to the Start menu and starts the service,
4. packs the widget and opens it in iCUE, where you click to update it.

The first time it runs, the service closes the old Control Panel Helper, takes over its "start with Windows" setting and copies its settings folder (`%APPDATA%\ControlPanelHelper` → `%APPDATA%\ControlHub`). That covers logins, backups, pictures and flight tracks. The old folder is left as a spare copy.

## What's where

| Folder | What |
|---|---|
| `service/` | Control Hub Service (C# 5, .NET Framework 4) |
| `hub/` | The Control Hub app window (WinForms) |
| `widget/` | The Control Panel iCUE widget (HTML/JS) |
| `shared/` | The logo |
| `docs/` | The Control Panel guide (every tile and feature) |
| `version.json` | Version numbers and what's new. The Update button will read this. |
| `projects.json` | Extra projects shown in Control Hub → Projects |

## Adding a project to Control Hub

Add an entry to `projects.json` in the install folder:

```json
{
	"projects": [
		{
			"name": "FlightLine Live",
			"description": "Flight dashboard for the phone over WiFi",
			"folder": "%USERPROFILE%\\Projects\\FlightLine Live",
			"start": "%USERPROFILE%\\Projects\\FlightLine Live\\start.bat",
			"process": "node",
			"url": "http://localhost:3000"
		}
	]
}
```

Every field except `name` is optional. `process` is the program name (without `.exe`) used to show Running / Not running.

## Coming next

- An **Update** button in Control Hub: it checks `version.json` here, downloads the new version, builds it to the side, keeps a backup of the old one, and swaps it in.
- Testing whether the widget can load its code from Control Hub Service, so panel updates need no click in iCUE.

*Work in progress.*
