import assert from "node:assert/strict";
// Run: npm exec --package=playwright -- node scripts/check-ui-controls.mjs
// Dedicated cabin UI fixture. No external providers, public tile downloads or physical microphone.
import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { delimiter, resolve, join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const candidate = (process.env.PATH ?? "")
  .split(delimiter)
  .map((path) => resolve(path, "../playwright/index.mjs"))
  .find(existsSync);
if (!candidate)
  throw new Error(
    "Run with npm exec --package=playwright; install its Chromium browser first.",
  );
const { chromium } = await import(pathToFileURL(candidate).href);
const build = spawnSync("npm", ["run", "build"], {
  cwd: root,
  encoding: "utf8",
});
if (build.status !== 0) throw new Error(build.stdout + build.stderr);
const children = [];
function start(command, args, options, pattern) {
  const child = spawn(command, args, {
    cwd: root,
    ...options,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  return new Promise((resolveStart, reject) => {
    let output = "";
    const timer = setTimeout(
      () => reject(new Error(`Startup timeout: ${output}`)),
      15000,
    );
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited ${code}: ${output}`));
    });
    const receive = (data) => {
      output += data;
      const match = output.match(pattern);
      if (match) {
        clearTimeout(timer);
        resolveStart({ child, address: match[0] });
      }
    };
    child.stdout.on("data", receive);
    child.stderr.on("data", receive);
  });
}
let browser;
try {
  const host = await start(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
import {readFileSync} from 'node:fs';
import {CoreRuntime} from ${JSON.stringify(pathToFileURL(join(root, "dist/packages/core-runtime/src/core-runtime.js")).href)};
import {HmiGateway} from ${JSON.stringify(pathToFileURL(join(root, "dist/apps/core-host/src/hmi-gateway.js")).href)};
const registry=JSON.parse(readFileSync('apps/core-host/config/display-registry.json','utf8'));
const runtime=new CoreRuntime({registry});
runtime.ingestSignal({signalId:'fixture-load',type:'driver.cognitive_load',value:{level:'normal'},source:'simulated',timestamp:Date.now(),confidence:1},'fixture-load');
runtime.updateConnectivity({mode:'online',source:'derived',evidence:'fixture-only',traceId:'fixture-online'});
const {CabinCoordinator}=await import(${JSON.stringify(pathToFileURL(join(root, "dist/apps/core-host/src/cabin-coordinator.js")).href)});
const place=id=>({id,name:id,address:'Fixture only',latitude:24.01,longitude:121.51,provider:'osm',observedAt:Date.now(),mapsUrl:'https://www.openstreetmap.org'});
const maps={provider:'osm',async search(query){return [place(query)]},async route(origin,destination,stops){return {distanceMeters:10000+stops.length*1000,durationSeconds:600+stops.length*60,coordinates:[[121.51,24.01],[121.53,24.05],[121.55,24.09]],order:stops.map(p=>p.id),provider:'osm',observedAt:Date.now(),mapsUrl:'https://www.openstreetmap.org'}}};
let speechCalls=0;
const intelligence={cloudAvailable:false,localSpeechAvailable:false,async transcribe(data){if(Buffer.from(data,'base64').length<200)throw new Error('AUDIO_TOO_SMALL');return ++speechCalls <= 2 ? '我同意加入行程' : '刪除lake'},async recommend(query){return {query,reason:'Fixture reasoning',provider:'fixture'}},async identify(){return {query:'lake',description:'Fixture scene'}},async matchImages(){return []}};
const cabin=new CabinCoordinator({runtime,registry,maps,intelligence});
const gateway=new HmiGateway({runtime,registry,cabin,host:'127.0.0.1',port:0,path:'/ws'});
await gateway.start();console.log(gateway.address());
process.once('SIGTERM',()=>gateway.close().then(()=>process.exit(0)));
`,
    ],
    {},
    /ws:\/\/127\.0\.0\.1:\d+\/ws/,
  );
  const webPort = 19000 + Math.floor(Math.random() * 10000);
  const web = await start(
    process.execPath,
    [
      join(root, "apps/web-simulator/node_modules/vite/bin/vite.js"),
      "--host",
      "127.0.0.1",
      "--port",
      String(webPort),
      "--strictPort",
    ],
    {
      cwd: join(root, "apps/web-simulator"),
      env: { ...process.env, VITE_AURA_WS_URL: host.address },
    },
    /http:\/\/127\.0\.0\.1:\d+\//,
  );
  const base = web.address;
  browser = await chromium.launch({
    headless: true,
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--use-gl=angle",
      "--use-angle=swiftshader",
    ],
    ...(process.env.AURA_UI_BROWSER_PATH
      ? { executablePath: process.env.AURA_UI_BROWSER_PATH }
      : {}),
  });
  const context = await browser.newContext({
    permissions: ["microphone", "geolocation"],
    geolocation: {latitude:24.05,longitude:121.53,accuracy:10},
    viewport: { width: 1600, height: 1000 },
  });
  // Avoid using a headless bot to download or pan public OSM map tiles.
  await context.route("https://tile.openstreetmap.org/**", (route) =>
    route.abort(),
  );
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  const rear = page.getByRole("region", { name: "後座乘員", exact: true });
  const mother = page.getByRole("region", { name: "前座媽媽", exact: true });
  const driver = page.getByRole("region", {
    name: "共享行程 · 駕駛",
    exact: true,
  });
  const window = page.getByRole("region", { name: "智慧車窗", exact: true });
  await window.locator('canvas[data-ready="true"]').waitFor();
  await window.getByRole("button", {name:"暫停窗景輪播"}).click();
  const captured = await window.locator('canvas').evaluate(canvas => canvas.toDataURL("image/jpeg", .75));
  await window.getByRole("button", { name: "點擊車窗景色並傳給媽媽" }).click();
  await mother.getByRole("button", { name: "媽媽確認 · 關閉照片" }).waitFor();
  assert.equal(await mother.locator(".cabin-photos img").count(), 1);
  assert.equal(await mother.locator(".cabin-photos img").getAttribute("src"), captured);
  const initial = await window.locator('canvas').evaluate(canvas => canvas.toDataURL());
  await window.getByRole("button", {name:"繼續窗景輪播"}).click();
  await page.waitForTimeout(6500);
  assert.match(await window.locator(".cabin-scene-toolbar").innerText(), /2\/3/);
  assert.notEqual(await window.locator('canvas').evaluate(canvas => canvas.toDataURL()), initial);
  assert.equal(await page.getByRole("button", {name:"使用相機景色"}).count(), 0);
  assert.equal(await page.getByRole("button", {name:"拍下景色給媽媽"}).count(), 0);
  await mother.getByRole("button", { name: "媽媽確認 · 關閉照片" }).click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".cabin-front-passenger-main .cabin-photos img")
        .length === 0,
  );
  await rear.getByLabel("字幕測試文字").fill("媽媽，這裡有湖");
  await rear.getByRole("button", { name: "送出字幕" }).click();
  await mother
    .locator(".cabin-subtitle")
    .filter({ hasText: "媽媽，這裡有湖" })
    .waitFor();
  await mother.getByRole("button", { name: "對話", exact: true }).click();
  await mother.getByLabel("字幕測試文字").fill("我看到了");
  await mother.getByRole("button", { name: "送出字幕" }).click();
  await rear
    .locator(".cabin-subtitle")
    .filter({ hasText: "我看到了" })
    .waitFor();
  await rear.getByRole("button", { name: "後座語音輸入" }).click();
  await rear.getByRole("status", { name: "正在聽" }).waitFor();
  await page.waitForTimeout(600);
  await rear.getByRole("button", { name: "結束並送出" }).click();
  await mother
    .locator(".cabin-subtitle")
    .filter({ hasText: "同意加入行程" })
    .waitFor();
  assert.equal(await page.locator('.cabin-controller').count(),0);
  await mother.getByRole('button',{name:'行程',exact:true}).click();
  await mother.getByLabel('起點',{exact:true}).fill('國立東華大學');
  await mother.getByLabel('終點',{exact:true}).fill('花蓮車站');
  await mother.getByRole('button',{name:'設定並計算共享路線'}).click();
  await driver.locator('.cabin-trip li').first().waitFor();
  assert.equal(await page.locator('.cabin-cluster .aura-cluster').getAttribute('data-presentation'),'rich');
  await rear.getByRole("button", { name: "景點", exact: true }).click();
  await rear.getByLabel("景點或需求").fill("lake");
  await rear.getByRole("button", { name: "搜尋景點" }).click();
  await rear.getByRole("button", { name: "發起投票" }).waitFor();
  await rear.getByRole("button", { name: "發起投票" }).click();
  await driver.locator(".cabin-vote-pending").waitFor();
  assert.equal(await page.locator(".cabin-cluster .cabin-vote").count(),0);
  await page.locator(".cabin-cluster .aura-cluster").waitFor();
  for (const name of [
    "共享行程 · 駕駛",
    "前座媽媽",
    "後座乘員",
    "智慧車窗",
  ])
    assert.equal(
      await page
        .getByRole("region", { name, exact: true })
        .getByRole("status", { name: "行程投票" })
        .count(),
      1,
    );
  for (const region of [driver, mother, rear, page.locator('.cabin-window-tablet')]) {
    const vote = region.locator('.cabin-vote-fullscreen');
    assert.equal(await vote.getByRole('button', {name:'同意', exact:true}).count(), 1);
    assert.equal(await vote.getByRole('button', {name:'不同意', exact:true}).count(), 1);
    const bounds = await region.boundingBox(), overlay = await vote.boundingBox();
    assert.ok(Math.abs(bounds.width-overlay.width) < 3 && Math.abs(bounds.height-overlay.height) < 3);
  }
  if(process.env.AURA_UI_CAPTURE_DIR){
    await page.screenshot({path:join(process.env.AURA_UI_CAPTURE_DIR,'fullscreen-vote-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await rear.screenshot({path:join(process.env.AURA_UI_CAPTURE_DIR,'fullscreen-vote-mobile.png')});
    await page.setViewportSize({width:1440,height:1080});
  }
  await rear.getByRole("button", { name: "同意", exact: true }).click();
  await rear.getByText('已選擇「同意」', {exact:true}).waitFor();
  assert.equal(await rear.getByRole('button', {name:'同意', exact:true}).count(),0);
  assert.equal(await rear.locator('.cabin-vote-fullscreen').count(),1);
  await driver.getByRole("button", { name: "駕駛語音投票" }).click();
  await driver.getByRole("status", { name: "正在聽" }).waitFor();
  await page.waitForTimeout(600);
  await driver.getByRole("button", { name: "結束並送出" }).click();
  await driver.locator(".cabin-vote-passed").waitFor();
  assert.equal(await driver.locator(".cabin-trip li").count(), 3);
  assert.equal(await page.getByRole("button", { name: "低負荷" }).count(), 0);
  assert.equal(
    await page.getByRole("button", { name: /Pause.*儀表/ }).count(),
    0,
  );
  await rear.getByRole("button", {name:"景點",exact:true}).click();
  await rear.getByLabel("景點或需求").fill("museum");
  await rear.getByRole("button", { name: "搜尋景點" }).click();
  await rear.getByText("museum", { exact: true }).waitFor();
  await rear.getByRole("button", { name: "發起投票" }).click();
  await driver.locator(".cabin-vote-pending").waitFor();
  await driver.getByRole("button", { name: "不同意", exact: true }).click();
  await driver.locator(".cabin-vote-failed").waitFor();
  assert.equal(await page.locator(".cabin-vote-fullscreen.cabin-vote-failed").count(),4);
  await page.waitForTimeout(1500);
  assert.equal(await page.locator(".cabin-vote-fullscreen.cabin-vote-failed").count(),4);
  await page.waitForTimeout(5100);
  await page.waitForFunction(()=>document.querySelectorAll('.cabin-vote-failed').length===0);
  assert.equal(await driver.locator(".cabin-trip li").count(), 3);
  await mother.getByRole("button", {name:"行程", exact:true}).click();
  assert.equal(await page.locator('.cabin-controller').getByRole('button',{name:/刪除|清空共享行程/}).count(),0);
  await driver.getByRole('button',{name:'語音刪除行程',exact:true}).click();
  await driver.getByRole('status',{name:'正在聽'}).waitFor();
  await page.waitForTimeout(600);
  await driver.getByRole('button',{name:'結束並送出'}).click();
  await page.waitForFunction(()=>document.querySelectorAll(".cabin-center-main .cabin-trip li").length===2);
  await mother.getByRole("button", {name:"清空共享行程", exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll(".cabin-center-main .cabin-trip li").length===0);
  await mother.getByRole('button',{name:'設定並計算共享路線'}).click();
  await driver.locator('.cabin-trip li').first().waitFor();
  await rear.locator('.cabin-proposal-settings summary').click();
  await rear.getByLabel('是否投票',{exact:true}).selectOption('vote');
  await rear.getByLabel('幾秒後開始投票',{exact:true}).fill('2');
  await rear.getByLabel('投票持續秒數',{exact:true}).fill('10');
  await rear.getByRole('button',{name:'排定投票'}).click();
  await driver.locator('.cabin-vote-scheduled').waitFor();
  if(process.env.AURA_UI_CAPTURE_DIR){await page.screenshot({path:join(process.env.AURA_UI_CAPTURE_DIR,'vote-options-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(process.env.AURA_UI_CAPTURE_DIR,'vote-options-mobile.png'),fullPage:true});await page.setViewportSize({width:1440,height:1080});}
  assert.equal(await rear.getByRole('button',{name:'同意',exact:true}).count(),0);
  await driver.locator('.cabin-vote-pending').waitFor();
  await driver.getByRole('button',{name:'不同意',exact:true}).click();
  await driver.locator('.cabin-vote-failed').waitFor();
  await rear.getByLabel('是否投票',{exact:true}).selectOption('driver');
  await rear.getByRole('button',{name:'請駕駛確認'}).click();
  await driver.getByText('要加入行程嗎？',{exact:true}).waitFor();
  assert.equal(await rear.getByRole('button',{name:'同意',exact:true}).count(),0);
  assert.equal(await mother.getByRole('button',{name:'同意',exact:true}).count(),0);
  await driver.getByRole('button',{name:'同意',exact:true}).click();
  await driver.locator('.cabin-vote-passed').waitFor();
  assert.equal(await driver.locator('.cabin-trip li').count(),3);
  assert.equal(await page.getByRole('button',{name:'Demo 導航',exact:true}).count(),0);
  await driver.getByRole('button',{name:'開始導航',exact:true}).click();
  await driver.getByRole('button',{name:'結束導航',exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('.cabin-center-main .cabin-navigation')?.textContent?.includes('剩餘 5.5'));
  assert.match(await mother.locator('.cabin-navigation').innerText(),/GPS 裝置定位/);
  await driver.getByRole('button',{name:'結束導航',exact:true}).click();
  await page.waitForTimeout(5100);
  await page.waitForFunction(()=>document.querySelectorAll('.cabin-vote-passed').length===0);
  assert.equal(await driver.locator('.cabin-trip li').count(),3);
  await rear.getByRole('button',{name:'景點',exact:true}).click();
  await rear.getByLabel('景點或需求').fill('lake');
  await rear.getByRole('button',{name:'查詢已儲存景點',exact:true}).click();
  await rear.getByText('lake',{exact:true}).waitFor();
  assert.match(await rear.locator('.cabin-finder .cabin-feedback').innerText(),/已儲存/);
  if(process.env.AURA_CACHE_CAPTURE_DIR){await page.screenshot({path:join(process.env.AURA_CACHE_CAPTURE_DIR,'cache-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(process.env.AURA_CACHE_CAPTURE_DIR,'cache-mobile.png'),fullPage:true});}
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    "PASS cabin UI fixture: animated scenery/current canvas capture, photo delivery/ack, cross-screen text and recorded audio transport, all-screen vote, scheduled opening/duration, driver-only approval, voice confirmation, GPS navigation start/stop, cached lookup, all terminal results dismissed after five seconds, rejection preserves route, removal/clear, removed camera controls. ASR/maps are fixtures; no physical microphone/provider validation.",
  );
} finally {
  if (browser) await browser.close();
  for (const child of children) child.kill("SIGTERM");
}
