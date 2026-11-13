# Computer Use

Computer Use adds a private Linux desktop to a Flecten task. The agent sees real screenshots, sends one grounded action at a time, and returns a screenshot after each input. The Computer surface shows the same evidence and lets you take over.

Open Settings, Modules and the bundled marketplace. Install **Computer**, then review and trust its version. Ask the agent to activate `computer-use`; its **Computer** workspace tab appears. You can also install [the package folder](../src/marketplace/modules/computer-use/) through Install from folder.

## What you can do

- Start a desktop, inspect a screenshot and open an HTTP/HTTPS page in a private Firefox profile.
- Click, double click, move, drag, scroll, type literal text and send key chords.
- Inspect a bounded optional accessibility tree beside the image.
- Take control, use the screen or keyboard/coordinate controls, then return control to the agent.
- Pause preview updates, inspect original-size pixels, review recent actions and stop the desktop.

Take control rejects further agent input through this module. It does not stop unrelated tools or the overall model run; use the harness stop control for that. Input already delivered to an application cannot be recalled. Preview pause affects the viewer only.

## Requirements and boundaries

Linux needs Xvfb, xauth, dbus-daemon, xdotool, ImageMagick and Firefox for browsing. The readiness report names missing programs before startup. Reliable UTF-8 typing requires Python 3 with GTK 3 PyGObject. AT-SPI adds optional accessibility descriptions. No package is installed automatically.

The display is separate from your normal desktop and uses a private browser profile. It still uses your OS account and can access its files and network. This is not a security sandbox. Do not run untrusted applications without a separate OS/container/VM boundary.

Screenshots use the harness attachment store; their bytes stay outside text logs. Screenshots can contain sensitive content. The action timeline stores the action type and short reason, never literal typed text. Use human takeover for credentials and avoid unnecessary screenshots while secrets are visible.

The module currently supports this Linux backend only. It shows screenshots, not a video stream. Closing/stopping removes the temporary profile and display; files written elsewhere can remain. Reopening a transcript restores saved evidence, not a live desktop.

## Verification

A current observation ID is required for every input. Old IDs and input from the wrong control owner fail before dispatch. Ambiguous failures are never automatically retried. Refresh the screen and inspect the result before deciding to repeat an action.

Implementation, pinned source comparisons and design decisions are kept in internal materials. Package instructions and recovery reference: [guide](../src/marketplace/modules/computer-use/guide.md).

Product-path checks, inspected interface states and remaining release blockers are tracked internally.
