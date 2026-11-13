import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
test("Vercel Git deployments are disabled only for the authorized feature branch",()=>{
 const config=JSON.parse(readFileSync('vercel.json','utf8'));
 assert.deepEqual(config.git.deploymentEnabled,{'feature/backend-pilot-readiness':false});
 assert.equal(config.git.deploymentEnabled.main,undefined);
 assert.equal(Object.keys(config.git.deploymentEnabled).some(key=>/[?*\[\]{}]/.test(key)),false);
 assert.match(config.functions['api/index.ts'].includeFiles,/readiness/);
});
