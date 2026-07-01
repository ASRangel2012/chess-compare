import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ChessCompare } from "./components/ChessCompare";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles/global.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <ChessCompare />
    </ErrorBoundary>
  </StrictMode>
);
