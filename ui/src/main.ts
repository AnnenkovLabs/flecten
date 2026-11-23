import { mount } from "svelte";
import App from "./App.svelte";
import "./app.css";
import "./controls.css";
import "./custom-controls.css";
import { initializeAppearance } from "./lib/appearance.svelte";
import { installFocusNavigation } from "./lib/focus-navigation";
import { initializeLocale } from "./lib/i18n.svelte";
import { initializeInterfaceScale } from "./lib/interface-scale.svelte";
import { installErrorTelemetry } from "./lib/telemetry";

const target = document.getElementById("app");
if (!target) throw new Error("app root missing");

const releaseLocale = initializeLocale();
const releaseInterfaceScale = initializeInterfaceScale();
const releaseAppearance = initializeAppearance();
const releaseFocusNavigation = installFocusNavigation(document);
const releaseTelemetryErrors = installErrorTelemetry();
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    releaseLocale();
    releaseInterfaceScale();
    releaseAppearance();
    releaseFocusNavigation();
    releaseTelemetryErrors();
  });
mount(App, { target });
