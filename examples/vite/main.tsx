import { createRoot } from "react-dom/client";
import { KoiPond } from "koipond";

createRoot(document.getElementById("root")!).render(
  <KoiPond look="natural" fish={15} rain={0.4} style={{ height: "100vh" }} />,
);
