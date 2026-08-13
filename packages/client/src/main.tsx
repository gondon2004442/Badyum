import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { installErrorReporting } from "./report.ts";
import "./design/tokens.css";

// Раньше приложения: поломка при его создании — ровно та, о которой важнее
// всего узнать, и к моменту первого рендера перехватывать её уже поздно.
installErrorReporting();

const container = document.getElementById("root");
if (!container) throw new Error("#root не найден");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
