const { transform } = require(process.argv[2] + "/node_modules/sucrase");
const fs = require("fs"), path = require("path");
const web = process.argv[2], out = process.argv[3];
const files = {
  "mcp/schemas.js": "lib/server/mcp/schemas.ts",
  "mcp/outputs.js": "lib/server/mcp/outputs.ts",
  "mcp/tools.js":   "lib/server/mcp/tools.ts",
  "mcp/route.js":   "app/api/mcp/route.ts",
};
for (const [dest, src] of Object.entries(files)) {
  let code = fs.readFileSync(path.join(web, src), "utf8");
  const res = transform(code, { transforms: ["typescript"], keepUnusedImports: false });
  // Stub rules FIRST: the generic mcp/* rule would otherwise claim them.
  let js = res.code
    .replace(/from "@\/lib\/server\/mcp\/(internal-call|jobs|origin)"/g, 'from "./stub-$1.js"')
    .replace(/from "@\/lib\/server\/(pat|oauth|db)"/g, 'from "./stub-$1.js"')
    .replace(/from "@\/lib\/server\/mcp\/(\w[\w-]*)"/g, 'from "./$1.js"')
    .replace(/from "next\/server"/g, 'from "./stub-next.js"');
  fs.mkdirSync(path.dirname(path.join(out, dest)), { recursive: true });
  fs.writeFileSync(path.join(out, dest), js);
}
console.log("transpiled", Object.keys(files).length, "files");
