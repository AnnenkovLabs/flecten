import { mount } from "svelte";
import App from "./App.svelte";
import "./app.css";
import "./controls.css";
import { installFocusNavigation } from "./lib/focus-navigation";
import { initializeLocale } from "./lib/i18n.svelte";
import { initializeInterfaceScale } from "./lib/interface-scale.svelte";

const target = document.getElementById("app");
if (!target) throw new Error("app root missing");

const releaseLocale = initializeLocale();
const releaseInterfaceScale = initializeInterfaceScale();
const releaseFocusNavigation = installFocusNavigation(document);
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    releaseLocale();
    releaseInterfaceScale();
    releaseFocusNavigation();
  });
mount(App, { target });
