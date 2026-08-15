import {chromium} from '@playwright/test';
const U='http://127.0.0.1:5173';
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1400,height:1000}});
await p.goto(U);
const skip=p.getByRole('button',{name:'Skip'}), tab=p.getByRole('tab',{name:'Story'});
await Promise.race([skip.waitFor({timeout:20000}).catch(()=>{}),tab.waitFor({timeout:20000}).catch(()=>{})]);
if(await skip.isVisible().catch(()=>false)) await skip.click();
await tab.waitFor();
await p.getByRole('button',{name:'New',exact:true}).click();
await p.getByRole('textbox',{name:/what should your story be named/i}).fill('Measure');
await p.getByRole('button',{name:'Create'}).click();
await p.getByRole('tab',{name:'Passage'}).waitFor({timeout:15000});
await p.getByRole('button',{name:'Untitled Passage',exact:true}).click();
await p.getByRole('tab',{name:'Passage'}).click();
await p.getByRole('button',{name:'Edit',exact:true}).click();
const cm=p.locator('.CodeMirror textarea').first();
await cm.click({force:true});
await p.keyboard.insertText('[scene]\nid: m\ncast:\n  mira: {at: -0.4}\n  joren: {at: 0.35}\n');
await p.waitForTimeout(2500);
const m = await p.evaluate(()=>{
  const pv=document.querySelector('[data-testid="scene-preview"]');
  const host=pv.querySelector('.scene-stage');
  const box=pv.querySelector('.sliders-stage-box');
  const r=e=>{const b=e.getBoundingClientRect();return{x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height)};};
  return {
    host:r(host), box: box?r(box):null,
    entities:[...pv.querySelectorAll('[data-entity-id]')].map(e=>({id:e.getAttribute('data-entity-id'),...r(e)})),
    imgs:[...pv.querySelectorAll('[data-entity-id] img')].map(e=>({id:e.closest('[data-entity-id]').getAttribute('data-entity-id'),...r(e), nat:e.naturalWidth+'x'+e.naturalHeight}))
  };
});
console.log(JSON.stringify(m,null,1));
await p.screenshot({path:'/tmp/sliders-shots/measure.png'});
await b.close();
