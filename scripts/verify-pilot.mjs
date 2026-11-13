import {spawn,spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
let url;
try{url=new URL(process.env.TEST_DATABASE_URL||'');}catch{throw Error('Set a disposable loopback TEST_DATABASE_URL ending /coffee_test');}
if(!['postgres:','postgresql:'].includes(url.protocol)||!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!='/coffee_test'||url.search||url.hash)throw Error('Verification refuses remote or non-disposable databases');
const env={...process.env};
for(const key of Object.keys(env))if(/^(DATABASE_|POSTGRES_|SUPABASE_|GOOGLE_|APPLE_|VERCEL_|STAGING_|PILOT_|PG[A-Z]|CRON_SECRET$|STAFF_PASSWORD_HASH$|PUBLIC_BASE_URL$|GITHUB_TOKEN$|GH_TOKEN$)/.test(key))delete env[key];
env.DATABASE_URL=env.TEST_DATABASE_URL;env.APP_ENV='test';env.EXTERNAL_DELIVERY_ENABLED='false';
const directory='data/readiness-verification';mkdirSync(directory,{recursive:true,mode:0o700});
const evidence={commit:spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim(),node:process.version,platform:process.platform,startedAt:new Date().toISOString(),database:'loopback disposable coffee_test; URI omitted',checks:[]};
for(const command of ['typecheck','build','test','test:hosted','test:browser','test:scanner','test:upgrade-browser','test:ui','test:pwa']){
 const args=command==='test'?['test']:['run',command];let log='';const started=Date.now();
 const exit=await new Promise((resolve,reject)=>{const child=spawn(process.platform==='win32'?'npm.cmd':'npm',args,{env,stdio:['ignore','pipe','pipe']});child.stdout.on('data',data=>{log+=data;});child.stderr.on('data',data=>{log+=data;});child.once('error',reject);child.once('exit',code=>resolve(code??1));});
 writeFileSync(directory+'/'+command.replaceAll(':','-')+'.log',log,{mode:0o600});
 evidence.checks.push({command:'npm '+args.join(' '),exitCode:exit,durationMs:Date.now()-started});
 console.log(command+': '+(exit===0?'PASS':'FAIL (inspect ignored local log)'));
 writeFileSync(directory+'/results.json',JSON.stringify(evidence,null,2),{mode:0o600});
 if(exit!==0){process.exitCode=1;break;}
}
