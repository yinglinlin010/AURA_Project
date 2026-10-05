/** Functional browser QA only: no video recording. */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from '/Users/yinglin/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
const root='artifacts/functional-ui-zh';await fs.mkdir(root,{recursive:true});
const b=await chromium.launch({headless:true,executablePath:'/Users/yinglin/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell'});
const context=await b.newContext({viewport:{width:1920,height:1080}});const pages={};const events=[];const errors=[];
const roles=['cluster-main','center-main','front-passenger-main','rear-tablet','window-tablet'];
try {
 for(const role of [...roles,'control']) {const p=await context.newPage();pages[role]=p;p.on('pageerror',e=>errors.push(e.message));p.on('websocket',s=>s.on('framereceived',f=>{try{const message=JSON.parse(String(f.payload));events.push({role,utc:new Date().toISOString(),message});}catch{}}));await p.goto('http://127.0.0.1:5180/?scenario=premium-journey&'+(role==='control'?'control=1&film=1':'record=1&display='+role),{waitUntil:'networkidle'});await p.evaluate(()=>document.fonts.ready);}
 const ctl=pages.control,window=pages['window-tablet'],center=pages['center-main'],rear=pages['rear-tablet'];
 
 const snapshots=[];
 async function snapshot(step,run){const state={step,run,utc:new Date().toISOString(),roles:{}};for(const role of roles){state.roles[role]=await pages[role].evaluate(()=>{const d=document.querySelector('.device');const r=d.getBoundingClientRect();return {bounds:{width:r.width,height:r.height},overflow:document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight,text:d.innerText,consent:!!d.querySelector('.proposal-panel'),mode:d.dataset.zoneMode,cloud:d.dataset.liveJourney};});assert.equal(state.roles[role].overflow,false);}snapshots.push(state);}
 for(let run=1;run<=3;run++) {
  await ctl.getByRole('button',{name:'重設',exact:true}).click();await center.waitForFunction(()=>!document.querySelector('.device').innerText.includes('行程已更新'));
  await window.waitForFunction(()=>document.querySelector('[data-poi-state]')?.dataset.poiState==='available');
  // Selected POI must reset reliably, including before any proposal exists.
  await window.getByRole('button',{name:'東湖 景點探索'}).click();await window.waitForFunction(()=>document.querySelector('[data-poi-state]')?.dataset.poiState==='selected');
  await ctl.getByRole('button',{name:'重設',exact:true}).click();await window.waitForFunction(()=>document.querySelector('[data-poi-state]')?.dataset.poiState==='available');
  await ctl.getByRole('button',{name:'駕駛負荷高',exact:true}).click();await center.waitForFunction(()=>document.querySelector('.device').classList.contains('load-reduced'));
  await window.getByRole('button',{name:'東湖 景點探索'}).click();await window.getByRole('button',{name:'加入行程',exact:true}).click();
  await ctl.waitForFunction(()=>document.querySelector('[data-decision]')?.dataset.decision==='DEFER');assert.equal(await center.locator('.proposal-panel').count(),0);await snapshot('DEFER',run);
  await ctl.getByRole('button',{name:'駕駛負荷正常',exact:true}).click();await center.getByRole('button',{name:'接受',exact:true}).waitFor();assert.match(await center.locator('.proposal-panel').innerText(),/行程更新待確認/);assert.equal((await center.locator('.device').innerText()).includes('行程已更新'),false);
  // Decline does not mutate the shared journey; retry through the same production Window.
  if(run===1){await center.getByRole('button',{name:'維持路線',exact:true}).click();await window.waitForFunction(()=>document.querySelector('[data-poi-state]')?.dataset.poiState==='available');await window.getByRole('button',{name:'東湖 景點探索'}).click();assert.equal((await center.locator('.device').innerText()).includes('行程已更新'),false);await ctl.getByRole('button',{name:'駕駛負荷高',exact:true}).click();await window.getByRole('button',{name:'加入行程',exact:true}).click();await ctl.waitForFunction(()=>document.querySelector('[data-decision]')?.dataset.decision==='DEFER');await ctl.getByRole('button',{name:'駕駛負荷正常',exact:true}).click();await center.getByRole('button',{name:'接受',exact:true}).waitFor();}
  if(run===1) await center.screenshot({path:root+'/center-ask.png'});
  await snapshot('ASK',run);await center.getByRole('button',{name:'接受',exact:true}).click();await center.waitForFunction(()=>document.querySelector('.device').innerText.includes('行程已更新'));await window.waitForFunction(()=>document.querySelector('[data-poi-state]')?.dataset.poiState==='accepted');await snapshot('ACCEPT',run);
  await ctl.getByRole('button',{name:'雲端離線',exact:true}).click();await rear.waitForFunction(()=>document.querySelector('.device').dataset.liveJourney==='unavailable');assert.match(await rear.locator('.device').innerText(),/東湖/);await snapshot('OFFLINE',run);
  await rear.getByRole('button',{name:'靜謐模式',exact:true}).click();await rear.waitForFunction(()=>document.querySelector('.device').dataset.zoneMode==='quiet');await ctl.getByRole('button',{name:'雲端恢復',exact:true}).click();await rear.waitForFunction(()=>document.querySelector('.device').dataset.liveJourney==='available_but_held');assert.equal(await rear.locator('.rear-journey-intelligence').isVisible(),false);await snapshot('RESTORED_HELD',run);
  await rear.getByRole('button',{name:'恢復資訊',exact:true}).click();await rear.waitForFunction(()=>document.querySelector('.device').dataset.liveJourney==='presented');assert.equal(await rear.locator('.rear-journey-intelligence').isVisible(),true);await snapshot('RESUME',run);
  assert.match(await ctl.getByLabel('PACT 決策觀測',{exact:true}).innerText(),/REAR_RESUME_REQUESTED/);
  console.log('MANUAL BUTTON FLOW',run,'PASS');
 }
 await ctl.getByRole('button',{name:'自動播放',exact:true}).click();await ctl.waitForFunction(()=>document.querySelector('[data-playback-status]')?.dataset.playbackStatus==='complete',{},{timeout:60000});const trace=JSON.parse(await ctl.getByLabel('已觀測播放紀錄',{exact:true}).textContent());assert.deepEqual(trace.map(t=>t.action),['reset','high','request','normal','accept','offline','quiet','restore','resume']);assert.equal(trace[2].observed.decision,'DEFER');
 await snapshot('AUTO_PLAY_END',4);assert.deepEqual(errors,[]);
 await ctl.getByRole('button',{name:'重設',exact:true}).click();
 await ctl.getByLabel('行程提案來源').selectOption('window-tablet');
 await ctl.getByRole('button',{name:'駕駛負荷高',exact:true}).click();
 await center.waitForFunction(()=>document.querySelector('.device').classList.contains('load-reduced'));
 await ctl.getByRole('button',{name:'行程提案',exact:true}).click();
 await ctl.waitForFunction(()=>document.querySelector('[data-decision]')?.dataset.decision==='DEFER');
 assert.match(await ctl.getByLabel('PACT 決策觀測',{exact:true}).locator('.display-connection-card').first().innerText(),/智慧車窗/);
 await ctl.getByRole('button',{name:'駕駛負荷正常',exact:true}).click();
 await center.getByRole('button',{name:'接受',exact:true}).click();
 await center.waitForFunction(()=>document.querySelector('.device').innerText.includes('行程已更新'));
 for(const role of [...roles,'control']) await pages[role].screenshot({path:root+'/'+role+'.png'});
 await fs.writeFile(root+'/browser-verification.json',JSON.stringify({status:'PASS',recording:false,manualButtonRuns:3,autoPlayRuns:1,trace,snapshots,errors},null,2));await fs.writeFile(root+'/gateway-events.json',JSON.stringify(events,null,2));console.log('AUTO PLAY + five Chinese production screens PASS');
} catch(e){await fs.writeFile(root+'/browser-failure.json',JSON.stringify({error:String(e),errors},null,2));throw e;} finally {await context.close();await b.close();}
