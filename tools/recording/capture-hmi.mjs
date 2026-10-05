/** User-requested renderer recording rig; never changes production DOM/CSS/assets. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const modulePath = process.env.PLAYWRIGHT_MODULE;
if (!modulePath) throw new Error('Set PLAYWRIGHT_MODULE to the installed playwright/index.mjs');
const { chromium } = await import(modulePath);
const out = path.resolve(process.argv[2] ?? 'artifacts/recording-delivery/center-diagnostic');
const centerOnly = process.argv.includes('--center-only');
const origin = process.env.RECORDING_ORIGIN ?? 'http://127.0.0.1:5180';
const revision = JSON.parse(await fs.readFile(process.env.RECORDING_REVISION_MANIFEST ?? 'artifacts/recording-freeze/recording-revision.json', 'utf8'));
for (const [file, expected] of Object.entries(revision.hashes)) {
 const actual = crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
 if (actual !== expected) throw new Error('Frozen source changed: '+file);
}
await fs.mkdir(path.join(out,'raw'),{recursive:true});
const roles = centerOnly ? ['center-main','control'] : ['cluster-main','center-main','front-passenger-main','rear-tablet','window-tablet','control'];
const browser = await chromium.launch({ headless:true, executablePath:process.env.CHROMIUM_EXECUTABLE,
 args:['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows'] });
const context = await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1,
 recordVideo:{dir:path.join(out,'raw'),size:{width:1920,height:1080}}});
const pages={},videos={},events=[],errors=[],calibration={},samples=[],streamGeometry={};
try {
 for(const role of roles){
  const page=await context.newPage(); pages[role]=page; videos[role]=page.video();
  page.on('pageerror',e=>errors.push({role,timestamp:Date.now(),message:e.message}));
  page.on('websocket',ws=>ws.on('framereceived',frame=>{
   try{const message=JSON.parse(String(frame.payload));events.push({role,receivedAt:Date.now(),message});}catch{}
  }));
  await page.setContent('<!doctype html><html><head><title>Recorder pre-roll calibration</title></head><body style="margin:0;background:black"></body></html>');
  // Chromium can initialize screencast before viewport emulation is applied.
  // Restart ONLY the native recorder stream after layout; production UI is untouched.
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const cdp=await context.newCDPSession(page);
  await cdp.send('Page.stopScreencast');
  const firstFrame=new Promise(resolve=>cdp.once('Page.screencastFrame',resolve));
  await cdp.send('Page.startScreencast',{format:'jpeg',quality:90,maxWidth:1920,maxHeight:1080});
  const frame=await firstFrame;
  const jpeg=Buffer.from(frame.data,'base64');let dimensions;
  for(let i=2;i<jpeg.length-10;){
   if(jpeg[i]!==255){i++;continue;}
   const marker=jpeg[i+1];if([0xc0,0xc1,0xc2].includes(marker)){dimensions=[jpeg.readUInt16BE(i+7),jpeg.readUInt16BE(i+5)];break;}
   i+=2+jpeg.readUInt16BE(i+2);
  }
  if(!dimensions||dimensions[0]!==1920||dimensions[1]!==1080)throw new Error('Recorder frame clipped: '+role+' '+dimensions);
  streamGeometry[role]={jpegDimensions:dimensions,metadata:frame.metadata};

 }
 await new Promise(r=>setTimeout(r,600));
 await Promise.all(roles.map(async role=>{calibration[role]=await pages[role].evaluate(async()=>{
  document.body.style.background='white';
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  return Date.now();
 });}));
 await new Promise(r=>setTimeout(r,600));
 await Promise.all(roles.map(role=>pages[role].evaluate(()=>{document.body.style.background='black';})));
 await new Promise(r=>setTimeout(r,300));
 for(const role of roles){
  const suffix=role==='control'?'?scenario=premium-journey&control=1&film=1':'?scenario=premium-journey&record=1&display='+role;
  await pages[role].goto(origin+'/'+suffix,{waitUntil:'networkidle'});
  await pages[role].evaluate(()=>document.fonts.ready);
  const productionCdp=await context.newCDPSession(pages[role]);
  await productionCdp.send('Page.stopScreencast');
  const productionFirstFrame=new Promise(resolve=>productionCdp.once('Page.screencastFrame',resolve));
  await productionCdp.send('Page.startScreencast',{format:'jpeg',quality:90,maxWidth:1920,maxHeight:1080});
  const productionFrame=await productionFirstFrame;const productionJpeg=Buffer.from(productionFrame.data,'base64');let productionDimensions;
  for(let i=2;i<productionJpeg.length-10;){
   if(productionJpeg[i]!==255){i++;continue;}
   if([0xc0,0xc1,0xc2].includes(productionJpeg[i+1])){productionDimensions=[productionJpeg.readUInt16BE(i+7),productionJpeg.readUInt16BE(i+5)];break;}
   i+=2+productionJpeg.readUInt16BE(i+2);
  }
  if(!productionDimensions||productionDimensions[0]!==1920||productionDimensions[1]!==1080)throw new Error('Production stream clipped: '+role+' '+productionDimensions);
  streamGeometry[role].productionJpegDimensions=productionDimensions;

  // Nonvisual recorder instrumentation; observes DOM after each animation frame.
  await pages[role].evaluate(()=>{
   window.__recordingFrames=[];window.__recordingTransitions=[];let previous='';
   function observe(){
    const d=document.querySelector('.device');const p=document.querySelector('[data-playback-status]');
    const consent=document.querySelector('.proposal-panel'); const accept=consent?.querySelector('.accept-action');
    const visible=!!accept&&getComputedStyle(accept).visibility!=='hidden'&&accept.getBoundingClientRect().width>0;
    const trace=document.querySelector('[aria-label="Observed playback trace"]');
    const datum={epochMs:Date.now(),rafMs:performance.now(),bounds:d?.getBoundingClientRect().toJSON(),overflow:document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight,consent:visible,focus:d?.getAttribute('data-presentation'),loadClass:d?.className,
     added:!!d?.querySelector('.journey-stop.shared-stop')||d?.innerText.includes('Journey updated')||false,
     rearMode:d?.getAttribute('data-zone-mode'),live:d?.getAttribute('data-live-journey'),poi:d?.querySelector('[data-poi-state]')?.getAttribute('data-poi-state'),
     step:p?.getAttribute('data-playback-step'),status:p?.getAttribute('data-playback-status'),trace:trace?.textContent};
    if(visible)datum.acceptBounds=accept.getBoundingClientRect().toJSON();
    window.__recordingFrames.push(datum);
    const key=JSON.stringify({...datum,epochMs:0,rafMs:0});if(key!==previous){window.__recordingTransitions.push(datum);previous=key;}
    requestAnimationFrame(observe);
   }requestAnimationFrame(observe);
  });
 }
 const control=pages.control;
 await control.getByRole('button',{name:'AUTO PLAY',exact:true}).waitFor({state:'visible'});
 for(let n=0;n<100&&!await control.getByRole('button',{name:'AUTO PLAY',exact:true}).isEnabled();n++)await new Promise(r=>setTimeout(r,100));
 if(!await control.getByRole('button',{name:'AUTO PLAY',exact:true}).isEnabled())throw new Error('Gateway roles not ready');
 await control.getByRole('button',{name:'RESET',exact:true}).click();
 await pages['center-main'].waitForFunction(()=>!document.querySelector('.device')?.innerText.includes('Journey updated'));
 await new Promise(r=>setTimeout(r,1000));
 const clickEpoch=Date.now();
 await control.getByRole('button',{name:'AUTO PLAY',exact:true}).click();
 await pages['center-main'].bringToFront();
 const deadline=Date.now()+90000;let last='';let completedAt;
 while(Date.now()<deadline){
  const playback=await control.locator('[data-playback-status]').evaluate(e=>({status:e.dataset.playbackStatus,step:e.dataset.playbackStep,text:e.textContent}));
  if(playback.status==='error')throw new Error(playback.text);
  const key=JSON.stringify(playback);
  if(key!==last){
   const frame={epochMs:Date.now(),playback,roles:{}};
   for(const [role,page] of Object.entries(pages))if(role!=='control')frame.roles[role]=await page.evaluate(()=>{
    const d=document.querySelector('.device'),b=d.getBoundingClientRect();
    return {viewport:[innerWidth,innerHeight],bounds:b.toJSON(),count:document.querySelectorAll('.device').length,
     overflow:document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight,
     images:[...d.querySelectorAll('img')].map(img=>({src:img.getAttribute('src'),natural:[img.naturalWidth,img.naturalHeight],bounds:img.getBoundingClientRect().toJSON(),fit:getComputedStyle(img).objectFit})),
     critical:[...d.querySelectorAll('.proposal-panel,.window-journey-overlay,.rear-journey-intelligence,.passenger-footer,.center-actions')].map(el=>({class:el.className,text:el.innerText,bounds:el.getBoundingClientRect().toJSON(),display:getComputedStyle(el).display,visibility:getComputedStyle(el).visibility})),
     text:d.innerText,consent:!!d.querySelector('.proposal-panel'),focus:d.getAttribute('data-presentation'),mode:d.getAttribute('data-zone-mode'),live:d.getAttribute('data-live-journey')};
   });samples.push(frame);last=key;console.log(playback.step,playback.text?.slice(0,100));
  }
  if(playback.status==='complete'){completedAt=Date.now();break;}
  await new Promise(r=>setTimeout(r,100));
 }
 if(!completedAt)throw new Error('Playback did not complete');
 await new Promise(r=>setTimeout(r,2000));
 const trace=JSON.parse(await control.locator('[aria-label="Observed playback trace"]').textContent());
 if(trace.length!==9)throw new Error('Incomplete observed trace');
 const controllerStart=Date.parse(trace[0].timestamp)-trace[0].elapsedMs;
 const observations={};for(const [role,page] of Object.entries(pages))observations[role]=await page.evaluate(()=>({frames:window.__recordingFrames,transitions:window.__recordingTransitions}));
 const metadata={revision:revision.revision,capture:'browser-native Playwright recordVideo; continuous renderer stream, no screenshot stitching',
  viewport:[1920,1080],streamGeometry,origin,roles,calibrationWhitePaintEpochMs:calibration,clickEpoch,controllerStartEpochMs:controllerStart,
  completedAtEpochMs:completedAt,clipDurationSeconds:(completedAt-controllerStart)/1000+1.5,trace,samples,observations,errors};
 await fs.writeFile(path.join(out,'capture-evidence.json'),JSON.stringify(metadata,null,2));
 await fs.writeFile(path.join(out,'gateway-events.json'),JSON.stringify(events,null,2));
 await context.close();
 for(const role of roles)await videos[role].saveAs(path.join(out,'raw',role+'.webm'));
 await browser.close();
 for (const [file,expected] of Object.entries(revision.hashes))if(crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex')!==expected)throw new Error('Source changed during recording: '+file);
 console.log('Recorded real videos:',roles.join(', '),'duration',metadata.clipDurationSeconds);
}catch(error){
 await fs.writeFile(path.join(out,'failure.json'),JSON.stringify({error:String(error),events:events.length,errors},null,2));
 await context.close().catch(()=>{});await browser.close().catch(()=>{});throw error;
}
