#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {PDFDocument} from 'pdf-lib';
import ai from '../server/flashcards.cjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const argv=process.argv.slice(2);
const value=name=>argv.includes(name)?argv[argv.indexOf(name)+1]:undefined;
const folder=path.resolve(root,value('--folder') || 'tests/fixtures/flashcards');
const send=argv.includes('--send');
const providers=(value('--providers') || 'gemini,claude,openai').split(',');
const rates={'gemini-3.5-flash':[1.5,9],'claude-sonnet-4-6':[3,15],'gpt-5.4-mini':[0.75,4.5]};
const require=createRequire(import.meta.url);
const canvasLib=createRequire(require.resolve('pdfjs-dist/package.json'))('@napi-rs/canvas');
const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
function csvCell(value) {
  const raw=String(value??'');
  const safe=/^\s*[=@+\-]/.test(raw) ? "'"+raw : raw;
  return '"'+safe.replace(/"/g,'""')+'"';
}
const csv=rows=>rows.map(row=>row.map(csvCell).join(',')).join('\n');
function estimate(cfg,usage) {
  const override=process.env['EVAL_'+cfg.provider.toUpperCase()+'_RATES'];
  const prices=override?override.split(',').map(Number):rates[cfg.model];
  if (!prices || prices.length!==2 || !prices.every(n=>Number.isFinite(n)&&n>=0) ||
      !Number.isFinite(usage?.input) || !Number.isFinite(usage?.output)) return null;
  return (usage.input*prices[0]+usage.output*prices[1])/1e6;
}
function encode(canvas,bytes) {
  for (const q of [92,80,67,54]) {
    const b=canvas.encodeSync('jpeg',q);if (b.length<bytes) return b;
  }
  throw Error('Section too large at readable quality.');
}
async function* sections(filename) {
  const full=path.join(folder,filename), pdf=/\.pdf$/i.test(filename);
  if ((await fs.stat(full)).size>(pdf?25:10)*1024**2) throw Error('File exceeds size limit.');
  const data=await fs.readFile(full);
  if (!pdf) {
    const img=await canvasLib.loadImage(data),scale=Math.min(1,2200/Math.max(img.width,img.height));
    const canvas=canvasLib.createCanvas(Math.max(1,Math.round(img.width*scale)),Math.max(1,Math.round(img.height*scale)));
    const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(img,0,0,canvas.width,canvas.height);
    yield {part:{start:1,pages:1,mime:'image/jpeg',encoded:encode(canvas,2800000).toString('base64')},layers:[]};return;
  }
  const resources=path.dirname(require.resolve('pdfjs-dist/package.json'));
  const assetDir=name=>path.join(resources,name).split(path.sep).join('/')+'/';
  const doc=await pdfjs.getDocument({data:new Uint8Array(data),useSystemFonts:true,isEvalSupported:false,
    cMapUrl:assetDir('cmaps'),cMapPacked:true,standardFontDataUrl:assetDir('standard_fonts'),
    wasmUrl:assetDir('wasm'),iccUrl:assetDir('iccs'),useWasm:false,stopAtErrors:true}).promise;
  try {
    if (doc.numPages>50) throw Error('Split PDFs over 50 pages.');
    for (let start=1;start<=doc.numPages;start+=5) {
      const pages=Math.min(5,doc.numPages-start+1), out=await PDFDocument.create({updateMetadata:false}),layers=[];
      for (let i=0;i<pages;i++) {
        const page=await doc.getPage(start+i),unit=page.getViewport({scale:1});
        const viewport=page.getViewport({scale:Math.min(3,2000/Math.max(unit.width,unit.height))});
        const canvas=canvasLib.createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
        await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
        const img=await out.embedJpg(encode(canvas,2850000/pages));
        out.addPage([img.width,img.height]).drawImage(img,{x:0,y:0,width:img.width,height:img.height});
        layers.push((await page.getTextContent()).items.map(i=>i.str||'').join(' '));page.cleanup();
      }
      yield {part:{start,pages,mime:'application/pdf',encoded:await out.saveAsBase64()},layers};
    }
  } finally { await doc.destroy(); }
}
const normalize=s=>s.normalize('NFKC').replace(/\s+/gu,' ').trim();
const models=providers.map(p=>ai.config(p,process.env['EVAL_'+p.toUpperCase()+'_MODEL'] || ai.providers[p]?.model));
if (send && models.some(m=>!process.env[m.key])) throw Error('Set the selected providers’ server keys before using --send.');
const files=(await fs.readdir(folder,{withFileTypes:true})).filter(f=>f.isFile() && /\.(pdf|png|jpe?g|webp|avif)$/i.test(f.name)).map(f=>f.name).sort();
if (!files.length) throw Error('No supported files in the evaluation folder.');
const report=[], totals=[['File','Provider','Model','First page','Pages','Cards','Input tokens','Output tokens','Estimated USD','Error']],
  grading=[['File','Model','Source page','Front','Back','Quote','Supported?','Correct page?','Useful?','Reviewer notes']];
const target=path.join(root,'evaluation-results',new Date().toISOString().replace(/[:.]/g,'-'));
if (send) await fs.mkdir(target,{recursive:true});
for (const file of files) {
  try {
    for await (const {part,layers} of sections(file)) {
      await ai.attachment(part);
      console.log((send?'Evaluating ':'Dry run · ')+file+' · pages '+part.start+'–'+(part.start+part.pages-1));
      if (!send) continue;
      for (const cfg of models) {
        const item={file,provider:cfg.provider,model:cfg.model,start:part.start,pages:part.pages};
        try {
          const reply=await ai.generate(cfg,part);
          item.usage=reply.usage;item.skipped=reply.skipped;
          item.cards=reply.cards.filter(c=>!layers[c.sourcePage-1] || normalize(layers[c.sourcePage-1]).includes(normalize(c.quote)))
            .map(c=>({...c,sourcePage:c.sourcePage+part.start-1}));
          item.skipped+=reply.cards.length-item.cards.length;
          for (const c of item.cards) grading.push([file,cfg.model,c.sourcePage,c.front,c.back,c.quote,'','','','']);
        } catch(e) {item.error=e.message;item.usage=e.usage;process.exitCode=1;}
        item.estimatedUSD=estimate(cfg,item.usage);
        report.push(item);
        totals.push([file,cfg.provider,cfg.model,item.start,item.pages,item.cards?.length,item.usage?.input,item.usage?.output,item.estimatedUSD,item.error]);
        // Checkpoint after each billed request, including errors with known usage.
        await fs.writeFile(path.join(target,'cards.json'),JSON.stringify(report,null,2));
        await fs.writeFile(path.join(target,'costs.csv'),csv(totals));
        await fs.writeFile(path.join(target,'quality.csv'),csv(grading));
      }
    }
  } catch(e) {console.error(file+' · '+e.message);process.exitCode=1;}
}
console.log(send?'Results saved to '+target:'Prepared locally. Use --send to transmit these files to '+models.map(m=>m.name).join(', ')+'.');
