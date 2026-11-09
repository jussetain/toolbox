import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./styles/atelier.css";
import "./styles/app.css";
import App from "./App";
import Launcher from "./Launcher";

const isLauncher = getCurrentWindow().label === "launcher";
document.documentElement.dataset.window = isLauncher ? "launcher" : "main";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{isLauncher ? <Launcher /> : <App />}</React.StrictMode>,
);
