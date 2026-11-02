import {test} from "node:test";
import assert from "node:assert/strict";
import {runtimeEnvironment,requireLocalDatabase,externalDeliveryAllowed,databaseIdentityHash} from "../src/environment-safety.js";
test("preview fails closed before database connection and cannot reuse inherited production identity",()=>{
 const production="postgres://user:secret@production.invalid:6543/postgres";
 const staging="postgres://stage:separate@staging.invalid:6543/postgres";
 const shared={VERCEL_ENV:"preview",DATABASE_URL:production};
 assert.throws(()=>runtimeEnvironment(shared),/isolation/);
 const configured={...shared,APP_ENV:"staging",EXTERNAL_DELIVERY_ENABLED:"false",STAGING_DATABASE_URL:staging,PRODUCTION_DATABASE_IDENTITY_SHA256:databaseIdentityHash(production)};
 assert.throws(()=>runtimeEnvironment(configured),/distinct/); // A build must not inherit production credentials either.
 assert.throws(()=>runtimeEnvironment({...configured,STAGING_DATABASE_URL:production}),/distinct/);
 assert.throws(()=>runtimeEnvironment({...configured,DATABASE_URL:staging,STAGING_DATABASE_URL:staging+"?host=production.invalid"}),/distinct/);
 const isolated=runtimeEnvironment({...configured,DATABASE_URL:staging});
 assert.match(isolated.DATABASE_URL!,/staging.invalid/);
 assert.equal(externalDeliveryAllowed(isolated),false);
 assert.throws(()=>runtimeEnvironment({...configured,DATABASE_URL:staging,GOOGLE_SERVICE_ACCOUNT_JSON:"must-not-reach-preview"}),/credentials/);
 assert.equal(shared.DATABASE_URL,production);
});
test("operator guards reject production, non-disposable databases and URL parameter bypasses",()=>{
 for(const value of ["postgres://localhost/postgres","postgres://production.invalid/coffee_test","postgres://localhost/coffee_test?host=production.invalid","https://localhost/coffee_test",undefined]) assert.throws(()=>requireLocalDatabase(value,"test"));
 for(const name of ["coffee_test","coffee_dev","coffee_case_abc123","coffee_restore_abc123"]) assert.ok(requireLocalDatabase("postgres://127.0.0.1/"+name,"test"));
});
