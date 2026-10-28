import {test} from "node:test";
import assert from "node:assert/strict";
import {validateRule,earnedCredits,reversedCredits} from "../src/program-rules.js";
const rule=validateRule({type:"spend",target:100,spendUnitMinor:100,pointsPerUnit:1,minimumMinor:100,transactionCap:100,dailyCap:200,rewardLabel:"Nu. 50 discount",terms:"Eligible spend only",rewardExpiryDays:30});
test("minor-unit earning rounds down, enforces minimum/caps and avoids floating arithmetic",()=>{
  assert.equal(earnedCredits(rule,199,0),1);assert.equal(earnedCredits(rule,99,0),0);
  assert.equal(earnedCredits(rule,50000,199),1);assert.equal(earnedCredits(rule,50000,200),0);
  assert.throws(()=>earnedCredits(rule,1.2,0));
  assert.equal(earnedCredits({...rule,transactionCap:1000,dailyCap:1000000},999999999999,0),1000);
});
test("cumulative partial/full refunds never reverse more than original credits",()=>{
  assert.equal(reversedCredits(rule,1000,10,1),1);assert.equal(reversedCredits(rule,1000,10,500),5);assert.equal(reversedCredits(rule,1000,10,1000),10);
  const visits={...rule,type:"visits" as const,minimumMinor:100};
  assert.equal(reversedCredits(visits,200,1,50),0);assert.equal(reversedCredits(visits,200,1,101),1);
  assert.throws(()=>reversedCredits(rule,1000,10,1001));
});
