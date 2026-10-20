import { mkdirSync, copyFileSync } from "node:fs";
mkdirSync("public/vendor/zxing", { recursive: true });
copyFileSync(
  "node_modules/@zxing/browser/umd/zxing-browser.min.js",
  "public/vendor/zxing/zxing-browser.min.js",
);
copyFileSync(
  "node_modules/@zxing/browser/LICENSE",
  "public/vendor/zxing/LICENSE",
);
