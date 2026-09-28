const { transform } = require(process.argv[2] + "/node_modules/sucrase");
const fs = require("fs");
const path = require("path");

const web = process.argv[2];
const out = process.argv[3];
const files = {
  "origin.js": "lib/server/mcp/origin.ts",
  "authorize.js": "app/api/oauth/authorize/route.ts",
};

for (const [dest, src] of Object.entries(files)) {
  const code = fs.readFileSync(path.join(web, src), "utf8");
  const result = transform(code, { transforms: ["typescript"], keepUnusedImports: false });
  const js = result.code
    .replace(/from "@\/lib\/server\/jwt"/g, 'from "./stub-jwt.js"')
    .replace(/from "@\/lib\/server\/oauth"/g, 'from "./stub-oauth.js"')
    .replace(/from "@\/lib\/server\/mcp\/origin"/g, 'from "./origin.js"')
    .replace(/from "next\/server"/g, 'from "./stub-next.js"');
  fs.writeFileSync(path.join(out, dest), js);
}
