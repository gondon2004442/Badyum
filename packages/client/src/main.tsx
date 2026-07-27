import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./design/tokens.css";

const container = document.getElementById("root");
if (!container) throw new Error("#root не найден");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
