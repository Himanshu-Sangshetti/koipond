import { inject } from "@vercel/analytics";
import { createRoot } from "react-dom/client";
import { App } from "./App";

if (new URLSearchParams(location.search).has("rec")) document.body.classList.add("rec");
createRoot(document.getElementById("root")!).render(<App />);

// Vercel Web Analytics: page views, no cookies
inject();
