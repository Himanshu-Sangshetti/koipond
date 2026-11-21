// Builds the shadcn registry item: `npx shadcn@latest add <url>/r/koi-pond.json`
// copies these files into the user's project under components/koi-pond/ and installs three.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const files = ["KoiPond.tsx", "sim.ts", "draw.ts", "stage.ts", "water.ts", "gl.ts", "fish3d.ts", "props3d.ts", "index.ts"];
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

const item = {
  $schema: "https://ui.shadcn.com/schema/registry-item.json",
  name: "koi-pond",
  type: "registry:block",
  title: "Koi Pond",
  description: pkg.description,
  author: "koipond contributors",
  dependencies: ["three"],
  devDependencies: ["@types/three"],
  files: files.map((f) => ({
    path: `components/koi-pond/${f}`,
    type: f === "KoiPond.tsx" || f === "index.ts" ? "registry:component" : "registry:lib",
    target: `components/koi-pond/${f}`,
    content: fs.readFileSync(path.join(root, "src", f), "utf8"),
  })),
};
fs.mkdirSync(path.join(root, "public/r"), { recursive: true });
fs.writeFileSync(path.join(root, "public/r/koi-pond.json"), JSON.stringify(item, null, 2) + "\n");
console.log(`registry: public/r/koi-pond.json (${files.length} files)`);
