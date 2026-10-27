export type ProgramRule = {
  type: "visits" | "spend"; target: number; spendUnitMinor: number; pointsPerUnit: number;
  minimumMinor: number; transactionCap: number; dailyCap: number;
  rewardLabel: string; terms: string; rewardExpiryDays: number | null;
};
export function validateRule(value: unknown): ProgramRule {
  const r=value as ProgramRule;
  if(!r || !["visits","spend"].includes(r.type) || !integer(r.target,2,1000000) || !integer(r.spendUnitMinor,1,1000000000) || !integer(r.pointsPerUnit,1,1000000)
    || !integer(r.minimumMinor,0,1000000000000) || !integer(r.transactionCap,1,Math.min(1000000,r.target*10)) || !integer(r.dailyCap,1,10000000)
    || typeof r.rewardLabel!=="string" || !r.rewardLabel.trim() || r.rewardLabel.length>80 || typeof r.terms!=="string" || r.terms.length>2000
    || (r.rewardExpiryDays!==null && !integer(r.rewardExpiryDays,1,3650))) throw Error("Check the program type, integer earning rules, limits, reward and terms");
  return {type:r.type,target:r.target,spendUnitMinor:r.spendUnitMinor,pointsPerUnit:r.pointsPerUnit,minimumMinor:r.minimumMinor,transactionCap:r.transactionCap,dailyCap:r.dailyCap,rewardLabel:r.rewardLabel.trim(),terms:r.terms.trim(),rewardExpiryDays:r.rewardExpiryDays};
}
function integer(value:unknown,min:number,max:number):value is number {return typeof value==="number"&&Number.isSafeInteger(value)&&value>=min&&value<=max;}
export function earnedCredits(rule:ProgramRule,eligibleMinor:number,alreadyEarnedToday:number):number {
  if(!integer(eligibleMinor,0,1000000000000)||!integer(alreadyEarnedToday,0,Number.MAX_SAFE_INTEGER))throw Error("Invalid recorded amount");
  if(eligibleMinor===0||eligibleMinor<rule.minimumMinor)return 0;
  const raw=rule.type==="visits"?1n:BigInt(eligibleMinor)*BigInt(rule.pointsPerUnit)/BigInt(rule.spendUnitMinor);
  return Math.min(Number(raw),rule.transactionCap,Math.max(0,rule.dailyCap-alreadyEarnedToday));
}
export function reversedCredits(rule:ProgramRule,originalEligible:number,originalCredits:number,cumulativeRefund:number):number {
  if(!integer(originalEligible,1,1000000000000)||!integer(originalCredits,0,10000000)||!integer(cumulativeRefund,0,originalEligible))throw Error("Invalid refund amount");
  if(rule.type==="visits")return cumulativeRefund===originalEligible || originalEligible-cumulativeRefund<rule.minimumMinor ? originalCredits:0;
  // Remaining entitlement rounds down once on the cumulative refund, never per retry.
  return originalCredits-Number(BigInt(originalCredits)*BigInt(originalEligible-cumulativeRefund)/BigInt(originalEligible));
}
