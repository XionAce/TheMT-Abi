'use strict';

// The originals, drafts, and edit buffers belong to the account's IndexedDB.
// Only the rendered pages selected for a generation request leave the device.
function initReviewUpload({fields,button,text,selectDeck}) {
  const $=id=>document.getElementById(id), store=reviewStore;
  let cfg,configRequest,busy=false,renderVersion=0,pdfLib;
  const msg=value=>{$('rv-file-status').textContent=value;};
  const errorText=e=>e.name==='QuotaExceededError'?'Device storage is full. Free space and retry.':e.message || 'Please retry.';
  const normalize=s=>s.normalize('NFKC').replace(/\s+/gu,' ').trim();
  const uuidFromHash=h=>h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-a'+h.slice(17,20)+'-'+h.slice(20,32);
  async function configure() {
    if (!navigator.onLine || document.body.classList.contains('review-offline')) {
      $('rv-check-ai').hidden=true;
      cfg=null; $('rv-privacy').textContent='Offline study · You can check and approve saved drafts here. Reconnect to generate new ones.';return;
    }
    if (!configRequest) configRequest=storageService.draftRequest().then(result=>{
      cfg=result.ready===false ? null : result;
      $('rv-privacy').textContent='Generating sends the selected pages or images to '+result.name+' ('+result.model+'). Originals stay on this device. Only approved cards sync. Encrypted replies can be reused for 24 hours.'+
        (cfg?'':' Provider setup is pending.');
    }).catch(e=>{cfg=null;$('rv-privacy').textContent=errorText(e);}).finally(()=>{configRequest=null;});
    await configRequest;$('rv-check-ai').hidden=Boolean(cfg);
  }
  async function readPdf(file) {
    const pdf=await import('/vendor/pdf.mjs');
    pdf.GlobalWorkerOptions.workerSrc='/vendor/pdf.worker.mjs';
    return pdf.getDocument({data:await file.arrayBuffer(),isEvalSupported:false,useSystemFonts:true,
      cMapUrl:'/vendor/pdf-resources/cmaps/',cMapPacked:true,standardFontDataUrl:'/vendor/pdf-resources/standard_fonts/',
      wasmUrl:'/vendor/pdf-resources/wasm/',iccUrl:'/vendor/pdf-resources/iccs/',useWasm:false,stopAtErrors:true}).promise;
  }
  function pdfWriter() {
    if (!pdfLib) pdfLib=new Promise((resolve,reject)=>{
      const s=document.createElement('script');s.src='/vendor/pdf-lib.js';
      s.onload=()=>resolve(window.PDFLib);s.onerror=()=>reject(new Error('Could not load the PDF tools.'));document.head.append(s);
    }).catch(e=>{pdfLib=null;throw e;});
    return pdfLib;
  }
  function range(value,count) {
    if (!value.trim()) return [1,count];
    const match=/^\s*(\d+)\s*(?:[-–]\s*(\d+))?\s*$/.exec(value);
    const first=Number(match?.[1]),last=Number(match?.[2] || first);
    if (!first || first>last || last>count) throw new Error('Choose pages between 1 and '+count+'.');
    return [first,last];
  }
  async function enqueue(file,selection) {
    const pdf=file.type==='application/pdf' || /\.pdf$/i.test(file.name);
    if (!pdf && !/^image\/(png|jpeg|webp|avif|heic|heif)$/i.test(file.type) && !/\.(png|jpe?g|webp|avif|heic|heif)$/i.test(file.name))
      throw new Error('Choose a PDF or a supported photo.');
    if (!file.size || file.size>(pdf?25:10)*1024**2) throw new Error('File must be under '+(pdf?25:10)+' MB and contain data.');
    let pages=1;
    if (pdf) {
      const doc=await readPdf(file);
      try { pages=doc.numPages; if (pages>50) throw new Error('Split PDFs longer than 50 pages before uploading.'); }
      finally { await doc.destroy(); }
    }
    const [first,last]=pdf?range(selection,pages):[1,1];
    const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
    const hex=b=>Array.from(new Uint8Array(b),v=>v.toString(16).padStart(2,'0')).join('');
    const fileId=hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(file.name+'\n'+hex(digest))));
    const sections=[];
    for (let start=first;start<=last;start+=5) {
      const end=Math.min(last,start+4);
      sections.push({id:fileId+'-'+start+'-'+end,fileId,deck:uuidFromHash(fileId),name:file.name.slice(0,255),
        start,end,pdf,state:'queued',cards:[],created:Date.now()});
    }
    await store.addFile(fileId,file,sections);
  }
  async function imageCanvas(file) {
    const url=URL.createObjectURL(file), img=new Image();
    try {
      img.src=url;
      try {await img.decode();} catch {throw new Error('This browser cannot open this photo. Choose a JPEG or PNG copy.');}
      const scale=Math.min(1,2200/Math.max(img.naturalWidth,img.naturalHeight));
      const c=document.createElement('canvas');c.width=Math.max(1,Math.round(img.naturalWidth*scale));
      c.height=Math.max(1,Math.round(img.naturalHeight*scale));
      const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(img,0,0,c.width,c.height);
      return c;
    } finally { URL.revokeObjectURL(url); }
  }
  async function pdfCanvas(doc,number) {
    const page=await doc.getPage(number), unit=page.getViewport({scale:1});
    const viewport=page.getViewport({scale:Math.min(3,2000/Math.max(unit.width,unit.height))});
    const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
    try {
      await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
      const content=await page.getTextContent();
      return {canvas,transcript:normalize(content.items.map(i=>i.str||'').join(' '))};
    } finally {page.cleanup();}
  }
  function jpeg(canvas,maxBytes) {
    for (const quality of [.92,.80,.67,.54]) {
      const url=canvas.toDataURL('image/jpeg',quality);
      if (url.startsWith('data:image/jpeg;base64,') && url.length<(maxBytes*4/3)) return url;
    }
    throw new Error('This page is too detailed to send clearly. Try a cropped image.');
  }
  async function prepare(section) {
    const file=await store.getSource(section.fileId);
    if (!file) throw new Error('Choose the original file again to generate this section.');
    const {start,end}=section, pages=end-start+1, transcripts=[];
    if (!section.pdf) {
      const canvas=await imageCanvas(file);
      return {part:{encoded:jpeg(canvas,2800000).split(',')[1],mime:'image/jpeg',start,pages},transcripts};
    }
    const lib=await pdfWriter(), output=await lib.PDFDocument.create({updateMetadata:false}), doc=await readPdf(file);
    // Rebuild from page pixels to avoid transmitting hidden comments, attachments
    // or linked pages outside the selection. Keep the original page mapping locally.
    try {
      for (let number=start;number<=end;number++) {
        const {canvas,transcript}=await pdfCanvas(doc,number);
        const img=await output.embedJpg(jpeg(canvas,2850000/pages));
        const page=output.addPage([img.width,img.height]);page.drawImage(img,{x:0,y:0,width:img.width,height:img.height});
        transcripts.push(transcript);canvas.width=canvas.height=1;
      }
      return {part:{encoded:await output.saveAsBase64(),mime:'application/pdf',start,pages},transcripts};
    } finally { await doc.destroy(); }
  }
  async function processSection(section) {
    const lease=crypto.randomUUID();
    const locked=await store.updateSection(section.id,s=>{
      if (s.state==='ready' || (s.state==='working' && s.until>Date.now())) return;
      return {...s,state:'working',lease,until:Date.now()+200000,error:''};
    });
    if (!locked) return;
    await render();
    try {
      const {part,transcripts}=await prepare(section);
      const response=await storageService.draftRequest({...part,provider:cfg.provider,model:cfg.model});
      const cards=[];
      for (const c of response.cards) {
        const layer=transcripts[c.sourcePage-1];
        if (layer && !layer.includes(normalize(c.quote))) continue;
        cards.push({...c,sourcePage:c.sourcePage+section.start-1,id:crypto.randomUUID(),selected:true});
      }
      await store.updateSection(section.id,s=>s.lease===lease && {...s,state:'ready',cards,lease:null,
        skipped:response.skipped+response.cards.length-cards.length});
      msg(response.remaining+' pages left today. Resets '+new Date(response.resetAt).toLocaleTimeString()+'.');
    } catch (e) {
      await store.updateSection(section.id,s=>s.lease===lease && {...s,state:'failed',error:errorText(e),lease:null});
      throw e;
    }
  }
  const deckName=s=>s.name.replace(/\.[^.]+$/,'').slice(0,100).trim() || 'Study cards';
  const sort=sections=>sections.sort((a,b)=>a.created-b.created || a.start-b.start);
  async function approve(section) {
    const current=(await store.allSections()).find(s=>s.id===section.id);
    if (!current) return;
    const selected=current.cards.filter(c=>c.selected);
    if (!selected.length) throw new Error('Select at least one draft.');
    await store.edit(rows=>{
      const writes=[],seen=new Set(rows.filter(r=>r.kind==='card' && r.data.deck===current.deck && !r.data.deleted).map(r=>reviewCore.signature(r.data)));
      for (const c of selected) {
        if (!c.front.trim() || !c.back.trim() || (c.type==='cloze' && !reviewCore.validCloze(c.front,c.back)))
          throw new Error('Complete both sides. For a cloze card, the {{c1::answer}} must match the back.');
        const data={type:c.type,front:c.front.trim(),back:c.back.trim(),frontImage:'',backImage:'',deck:current.deck,
          source:{file:current.name,page:c.sourcePage,quote:c.quote}};
        const key=reviewCore.signature(data);
        if (!seen.has(key) && !rows.some(r=>r.id===c.id)) writes.push(reviewCore.make('card',data,c.id));
        seen.add(key);
      }
      if (writes.length && !rows.some(r=>r.id===current.deck)) writes.unshift(reviewCore.make('deck',{name:deckName(current)},current.deck));
      return writes;
    });
    const ids=new Set(selected.map(c=>c.id));
    await store.updateSection(section.id,s=>({...s,cards:s.cards.filter(c=>!ids.has(c.id)),approved:true}));
    msg('Selected drafts approved. Duplicate cards were skipped.');
  }
  async function showSource(s,num,box) {
    box.replaceChildren(text('p','Opening source…'));
    try {
      const file=await store.getSource(s.fileId);
      if (!file) throw new Error('Choose the original file again to view this page.');
      let canvas;
      if (s.pdf) {
        const doc=await readPdf(file);
        try {canvas=(await pdfCanvas(doc,num)).canvas;} finally {await doc.destroy();}
      } else canvas=await imageCanvas(file);
      canvas.setAttribute('role','img');canvas.setAttribute('aria-label',s.name+' page '+num);
      box.replaceChildren(canvas,button('Close source',()=>box.replaceChildren()));
    } catch(e) {box.replaceChildren(text('p',errorText(e)));}
  }
  async function run(action) {
    if (busy) return;
    busy=true;
    try {await action();} catch(e) {msg(errorText(e));}
    finally {busy=false;await render().catch(e=>msg(errorText(e)));}
  }
  function drawSection(s) {
    const item=document.createElement('section');item.className='rv-file-section';
    item.append(text('h4',s.pdf?'Pages '+s.start+(s.end>s.start?'–'+s.end:''):'Image'));
    if (s.state!=='ready') {
      const working=s.state==='working' && s.until>Date.now();
      item.append(text('p',working?'Drafting · interrupted requests unlock within four minutes.':s.error || 'Ready to generate.'));
      if (!working && s.state!=='queued') item.append(button('Retry section',()=>run(async()=>{
        if (!cfg) await configure(); if (!cfg) throw new Error($('rv-privacy').textContent);
        await processSection(s);
      })));
      return item;
    }
    if (s.skipped) item.append(text('p',s.skipped+' suggestions omitted during evidence or format checks.'));
    if (!s.cards.length) item.append(text('p',s.approved || s.reviewed?'Drafts reviewed.':'No supported cards in this section.'));
    if (s.approved) item.append(button('Study this deck',()=>selectDeck(s.deck).catch(e=>msg(errorText(e)))));
    for (const c of s.cards) {
      const row=document.createElement('div');row.className='rv-draft';
      const label=text('label',' '+(c.type==='cloze'?'Fill in the blank':'Question and answer'));
      const check=document.createElement('input');check.type='checkbox';check.checked=c.selected;label.prepend(check);
      const edit=(key,value)=>store.updateSection(s.id,current=>{
        const card=current.cards.find(card=>card.id===c.id);if (card) card[key]=value;return current;
      }).catch(e=>msg(errorText(e)));
      check.onchange=()=>edit('selected',check.checked);
      const evidence=text('blockquote','“'+c.quote+'”'), source=document.createElement('div');
      row.append(label,fields({...c},edit),evidence,button('View '+(s.pdf?'page '+c.sourcePage:'source image'),()=>showSource(s,c.sourcePage,source)),source);
      row.append(button('Discard draft',()=>run(async()=>{
        await store.updateSection(s.id,current=>({...current,cards:current.cards.filter(card=>card.id!==c.id),reviewed:true}));
      })));
      item.append(row);
    }
    if (s.cards.length) item.append(button('Approve selected drafts',()=>run(()=>approve(s))));
    return item;
  }
  async function render() {
    const version=++renderVersion,sections=sort(await store.allSections());
    if (version!==renderVersion) return;
    const list=document.createDocumentFragment(), groups=new Map();
    for (const s of sections) {
      if (!groups.has(s.fileId)) {
        const group=document.createElement('article');group.className='rv-file';group.append(text('h3',s.name));
        list.append(group);groups.set(s.fileId,group);
      }
      groups.get(s.fileId).append(drawSection(s));
    }
    if (!sections.length) list.append(text('p','Your file queue is empty.'));
    $('rv-queue').replaceChildren(list);
    $('rv-clear').disabled=busy || !sections.length;
    $('rv-generate').disabled=busy || !cfg || !sections.some(s=>s.state!=='ready');
  }
  $('rv-check-ai').onclick=()=>run(configure);
  $('rv-queue-files').onclick=()=>run(async()=>{
    const input=$('rv-files-input'), files=[...input.files], errors=[];
    if (!files.length) throw new Error('Choose at least one PDF or image.');
    for (const file of files) {
      try {await enqueue(file,$('rv-file-range').value);} catch(e){errors.push(file.name+' · '+errorText(e));}
    }
    input.value='';msg(errors.length?errors.join(' · '):'Files saved on this device. Choose Generate drafts when ready.');
  });
  $('rv-generate').onclick=()=>run(async()=>{
    if (!cfg) throw new Error('Reconnect and check the provider settings.');
    let failures=0;
    for (const s of sort(await store.allSections()).filter(s=>s.state!=='ready')) {
      try {await processSection(s);} catch(e){failures++;msg(errorText(e));if ([401,409,429,503].includes(e.status)) break;}
    }
    if (failures) msg('Some sections still need attention. Your completed drafts are saved below.');
  });
  $('rv-clear').onclick=()=>run(async()=>{
    if (!window.confirm('Clear every queued file and unapproved draft on this device? Approved cards stay in your decks.')) return;
    await store.clearDrafts();msg('Local drafts and queued files cleared.');
  });
  window.addEventListener('offline',()=>{cfg=null;configure().then(render).catch(e=>msg(errorText(e)));});
  return {open:async()=>{await render();await configure();await render();}};
}
