import { inject } from "@vercel/analytics";
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(<App />);

// Vercel Web Analytics: page views, no cookies
inject();
