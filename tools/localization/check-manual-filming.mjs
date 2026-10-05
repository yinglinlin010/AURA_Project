/** Exercises real on-screen manual controls. No autoplay, API command injection or video. */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from '/Users/yinglin/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
const b=await chromium.launch({headless:true,executablePath:'/Users/yinglin/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell'});
const c=await b.newContext({viewport:{width:1920,height:1080}});const roles=['cluster-main','center-main','front-passenger-main','rear-tablet','window-tablet'];const pages={},events=[],errors=[],runs=[];await fs.mkdir('artifacts/manual-filming',{recursive:true});
try{
 for(const role of [...roles,'control']){const p=await c.newPage();pages[role]=p;p.on('pageerror',e=>errors.push(e.message));p.on('websocket',w=>w.on('framereceived',f=>{try{events.push({role,receivedAt:Date.now(),message:JSON.parse(String(f.payload))});}catch{}}));await p.goto('http://127.0.0.1:5180/?scenario=premium-journey&'+(role==='control'?'control=1&manual=1&film=1':'record=1&display='+role),{waitUntil:'networkidle'});await p.evaluate(()=>document.fonts.ready);}
 const ctl=pages.control,center=pages['center-main'],rear=pages['rear-tablet'],win=pages['window-tablet'];
 assert.deepEqual(await ctl.locator('button').allTextContents(),['重設','駕駛負荷高','駕駛負荷正常','雲端離線','雲端恢復']);assert.equal(await ctl.locator('[data-playback-status]').count(),0);
 await center.evaluate(()=>{window.__manualPaint=[];function tick(){const d=document.querySelector('.device');window.__manualPaint.push({utcMs:Date.now(),focus:d.classList.contains('load-reduced'),consent:!!d.querySelector('.proposal-panel')});requestAnimationFrame(tick);}requestAnimationFrame(tick);});
 const observed=async(action)=>ctl.waitForFunction(a=>document.querySelector('[data-manual-observed]')?.dataset.manualObserved===a,action);
 for(let n=1;n<=3;n++){
  const started=Date.now();await ctl.getByRole('button',{name:'重設',exact:true}).click();await observed('reset');await win.waitForFunction(()=>document.querySelector('[data-poi-state]')?.dataset.poiState==='available');
  await ctl.getByRole('button',{name:'駕駛負荷高',exact:true}).click();await observed('high');
  await win.getByRole('button',{name:'東湖 景點探索'}).click();await win.getByRole('button',{name:'加入行程',exact:true}).click();await observed('request');assert.equal(await center.locator('.proposal-panel').count(),0);assert.equal((await center.locator('.device').innerText()).includes('行程已更新'),false);
  await ctl.getByRole('button',{name:'駕駛負荷正常',exact:true}).click();await observed('normal');await center.getByRole('button',{name:'接受',exact:true}).waitFor();
  if(n===1)await new Promise(r=>setTimeout(r,5200));assert.equal((await center.locator('.device').innerText()).includes('行程已更新'),false);
  await center.getByRole('button',{name:'接受',exact:true}).click();await observed('accept');await win.waitForFunction(()=>document.querySelector('[data-poi-state]')?.dataset.poiState==='accepted');
  await ctl.getByRole('button',{name:'雲端離線',exact:true}).click();await observed('offline');assert.match(await rear.locator('.device').innerText(),/東湖/);
  await rear.getByRole('button',{name:'靜謐模式',exact:true}).click();await observed('quiet');await ctl.getByRole('button',{name:'雲端恢復',exact:true}).click();await observed('restore');
  if(n===1)await new Promise(r=>setTimeout(r,5200));assert.equal(await rear.locator('.rear-journey-intelligence').isVisible(),false);assert.equal(await rear.locator('.device').getAttribute('data-zone-mode'),'quiet');
  await rear.getByRole('button',{name:'恢復資訊',exact:true}).click();await observed('resume');await rear.waitForFunction(()=>document.querySelector('.device').dataset.zoneMode==='normal'&&document.querySelector('.device').dataset.liveJourney==='presented');await rear.locator('.rear-journey-intelligence').waitFor({state:'visible'});assert.equal(await rear.locator('.rear-journey-intelligence').isVisible(),true);
  await ctl.waitForFunction(()=>JSON.parse(document.querySelector('[aria-label="已觀測播放紀錄"]').textContent).length===9);
  const trace=JSON.parse(await ctl.getByLabel('已觀測播放紀錄',{exact:true}).textContent());assert.deepEqual(trace.map(t=>t.action),['reset','high','request','normal','accept','offline','quiet','restore','resume']);assert.ok(trace.every(t=>t.kind==='observed-state'));
  const geometry={};for(const role of roles){geometry[role]=await pages[role].evaluate(()=>{const d=document.querySelector('.device'),r=d.getBoundingClientRect();return {size:[r.width,r.height],documentOverflow:document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight};});assert.equal(geometry[role].documentOverflow,false);}
  runs.push({run:n,startedAt:started,trace,geometry});console.log('PURE MANUAL FLOW',n,'PASS');
 }
 const paints=await center.evaluate(()=>window.__manualPaint);assert.ok(paints.every(p=>!p.focus||!p.consent));assert.deepEqual(errors,[]);
 await ctl.screenshot({path:'artifacts/manual-filming/control.png'});await fs.writeFile('artifacts/manual-filming/verification.json',JSON.stringify({status:'PASS',recording:false,scriptedAcceptance:false,autoplayUnavailable:true,askAndHeldDwellMs:5200,runs,paints,errors},null,2));await fs.writeFile('artifacts/manual-filming/gateway-events.json',JSON.stringify(events,null,2));
}catch(e){await fs.writeFile('artifacts/manual-filming/failure.json',JSON.stringify({error:String(e),errors},null,2));throw e;}finally{await c.close();await b.close();}
