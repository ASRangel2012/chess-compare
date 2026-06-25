import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ChessCompare } from "./components/ChessCompare";
import "./styles/global.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ChessCompare />
  </StrictMode>
);
