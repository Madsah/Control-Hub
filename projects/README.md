# Projects installed together with Control Hub

Every folder in here that has an `install.bat` is installed by **Install Control Hub.bat**, both the first time and with every update from the Control Hub app. That's how new projects reach the PC through the Update button.

- `install.bat` gets the Control Hub program folder as its first argument (`%~1`).
- If it fails, Control Hub itself is still installed. The installer only reports the problem.
- To show the project in Control Hub → Projects, the install step can add an entry to `projects.json` in the program folder (see the main README).
