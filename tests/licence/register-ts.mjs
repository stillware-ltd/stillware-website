// Test-only loader. The functions import their siblings with a ".js" suffix
// (netlify/functions/lib/db.js), which is what the Netlify bundler expects, but the files on
// disk are ".ts". Node 24 runs TypeScript by type stripping and does not map one to the other.
// This hook retries a relative ".js" import as ".ts" when the ".js" file does not exist.
// Nothing in the deployed code uses it: it is loaded only by `npm run test:licence`.
import { register } from "node:module";

register("./resolve-ts.mjs", import.meta.url);
