# Computer guide

## Start and navigate

Use `status` to inspect supported OS, missing dependencies, image/input capabilities and current owner. This backend requires Linux, Xvfb, xauth, xdotool, ImageMagick `import` and dbus-daemon. Firefox is required for browser navigation. It does not install system packages automatically. Reliable UTF-8 typing requires Python 3 and GTK 3 PyGObject. AT-SPI is optional; a failure falls back explicitly to screenshot grounding.

Start with 1280 x 800 unless the task needs another size. Supported sizes are 800..1920 wide and 600..1200 high. Screenshots keep the display's exact dimensions, bounded by the backend's output limit. The viewer scales the same image; model coordinates always use original pixels.

Starting prepares an empty desktop. A black first screenshot is normal until an application opens. `applications:["firefox"]` lists an installed executable, not a running window. `browserNavigation:not-requested` means navigation has not been attempted; `dispatched` records a successful navigation dispatch, not verified page load. Verify the screenshot before claiming that Firefox or the requested page is open.

`navigate` only accepts HTTP and HTTPS URLs without embedded credentials. It opens a dedicated Firefox profile on the private display. Existing personal tabs, cookies and mouse focus are not used. The first screenshot can precede page load: use a bounded wait, then verify the screen.

## Observe and act

Every refreshed observation has a unique ID. One action consumes that observation. A returned screenshot has a new ID. Cached reads with `refresh:false` do not invalidate the model's observation. The viewer's human-only `preview` captures a fresh image under a separate preview ID and also preserves the agent observation. Previews update during agent and human ownership. Human input uses the displayed preview ID; agent input must use its canonical observation ID. Either kind of input consumes both frames. Polling keeps one request outstanding and pauses on errors. Calls serialize per runtime; roles in one conversation share the same instance, while separate chats own separate processes and displays.

Available actions: click (left/middle/right, single/double), move, drag, scroll (four directions), literal text, explicit key chord and bounded wait. Use one action per decision. There is no agent shell tool in this package. The normal harness tools remain governed by their own policies.

AT-SPI is bounded to visible roles/names and bounds. Password roles have their names removed. Tree depth and node count are capped, and collection has a timeout. This is a read-only aid, not a semantic selector API; use screenshot-grounded coordinates for input.

## Human handoff

Select Take over in the Computer surface. Ownership changes before waiting for current input to settle; queued agent operations are invalidated. Already delivered OS events cannot be recalled. Manual clicks, text, keys and coordinate controls are available only while the human owns input. Return to agent captures a new frame. Agents cannot invoke these human operations through model arguments.

The viewer has a pause control for previews. Pausing previews does not pause the agent. Take over stops further agent input; Stop desktop closes the private processes. The harness stop control stops the overall model run.

## Recovery and privacy

After timeout, cancellation, stale ID or uncertain delivery: observe, compare visible state with the expected outcome, and decide whether another action is safe. Never replay an unverified purchase, send, submission or delete. The backend releases drag input on cancellation and tears down owned process groups on stop/runtime closure.

Stopping removes the temporary profile and private display. Downloaded files or changes elsewhere on the host filesystem may remain. A reopened harness transcript restores recorded screenshots, not a running desktop or its browser profile. Start again and inspect before continuing.

Desktop separation is not filesystem, network or credential isolation. For untrusted programs use an OS/container/VM sandbox. E2B cloud desktops and host-native agent-sh/iFurySt backends are reference architectures, not bundled transports in this release.
