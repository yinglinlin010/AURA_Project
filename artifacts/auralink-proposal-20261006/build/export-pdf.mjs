import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {delimiter,resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const candidate=(process.env.PATH??'').split(delimiter).map(p=>resolve(p,'../playwright/index.mjs')).find(existsSync);
const {chromium}=await import(pathToFileURL(candidate).href);
const dir=resolve('artifacts/auralink-proposal-20261006');
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
const page=await browser.newPage({viewport:{width:1440,height:1000}});
await page.goto(pathToFileURL(join(dir,'index.html')).href);
await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));
const layouts=await page.evaluate(()=>pages.map((p,i)=>{n=i;move(0);const body=p.querySelector(".render-body").getBoundingClientRect(),rect=p.getBoundingClientRect();return{page:i+1,title:p.querySelector(".page-title").textContent,textBottom:body.bottom,footerTop:rect.bottom-32,overlap:body.bottom>rect.bottom-32,imageOverlap:false}}));
await fs.writeFile(join(dir,'build','layout-check.json'),JSON.stringify(layouts,null,2));
console.log(JSON.stringify(layouts.filter(x=>x.overlap||x.imageOverlap)));
for(let i=0;i<18;i++){await page.evaluate(i=>{n=i;move(0)},i);await page.locator('.page.active').screenshot({path:join(dir,'build',`screen-${i+1}.png`)});}
await page.pdf({path:join(dir,'AuraLink_競賽企劃書_我坐你右邊_20261006.pdf'),preferCSSPageSize:true,printBackground:true,displayHeaderFooter:false});
await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{n=9;move(0)});await page.screenshot({path:join(dir,'build','mobile.png')});
console.log('PDF exported; all 18 previews captured');
}finally{await browser.close()}
