# Computer

A private Linux desktop inside a Flecten task. The agent sees screenshots, operates the desktop one grounded action at a time, and checks the resulting screen. You can follow the same frame, take over, type or click, and return control.

Install **Computer** from the bundled Modules marketplace, review and trust its version, then ask the agent to activate `computer-use`. A **Computer** workspace tab appears. The package also works through Install from folder.

Requires Linux, Xvfb, xauth, dbus-daemon, xdotool and ImageMagick. Browser navigation requires Firefox. Reliable UTF-8 typing requires Python 3 with GTK 3 PyGObject; AT-SPI adds optional accessibility descriptions. Readiness shows missing tools before starting; installation is never automatic.

The authenticated display and temporary browser profile keep host mouse focus separate. Files and network still use the host account. This is not a security sandbox. Use a separate OS/container/VM boundary for untrusted programs.

[User guide](../../../docs/COMPUTER-USE.md) · [Runtime guide](guide.md)
