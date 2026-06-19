import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Unregister any previously installed service workers to ensure the app
// runs under the standard Lovable hosting flow without custom caching.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((r) => r.unregister());
  });
}

createRoot(document.getElementById("root")!).render(<App />);
