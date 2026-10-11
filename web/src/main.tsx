import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";
import { I18nProvider } from "./i18n";
import { ThemeProvider } from "./lib/theme";
import { AuthProvider } from "./lib/auth";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <I18nProvider>
        <ThemeProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ThemeProvider>
      </I18nProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
