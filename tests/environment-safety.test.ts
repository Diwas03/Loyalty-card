import {test} from "node:test";
import assert from "node:assert/strict";
import {runtimeEnvironment,requireLocalDatabase,externalDeliveryAllowed} from "../src/environment-safety.js";
test("preview fails closed before database connection and cannot reuse inherited production identity",()=>{
 const inherited={VERCEL_ENV:"preview",DATABASE_URL:"postgres://user:secret@production.invalid:6543/postgres"};
 assert.throws(()=>runtimeEnvironment(inherited),/isolation/);
 assert.throws(()=>runtimeEnvironment({...inherited,APP_ENV:"staging",EXTERNAL_DELIVERY_ENABLED:"false",STAGING_DATABASE_URL:inherited.DATABASE_URL}),/distinct/);
 const isolated=runtimeEnvironment({...inherited,APP_ENV:"staging",EXTERNAL_DELIVERY_ENABLED:"false",STAGING_DATABASE_URL:"postgres://stage:separate@staging.invalid:6543/postgres"});
 assert.match(isolated.DATABASE_URL!,/staging.invalid/);
 assert.equal(externalDeliveryAllowed(isolated),false);
 assert.equal(inherited.DATABASE_URL,"postgres://user:secret@production.invalid:6543/postgres");
});
test("operator guards reject production, non-disposable databases and URL parameter bypasses",()=>{
 for(const value of ["postgres://localhost/postgres","postgres://production.invalid/coffee_test","postgres://localhost/coffee_test?host=production.invalid","https://localhost/coffee_test",undefined]) assert.throws(()=>requireLocalDatabase(value,"test"));
 for(const name of ["coffee_test","coffee_dev","coffee_case_abc123","coffee_restore_abc123"]) assert.ok(requireLocalDatabase("postgres://127.0.0.1/"+name,"test"));
});
