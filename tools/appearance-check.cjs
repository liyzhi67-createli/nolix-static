const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
(async()=>{
 const root=path.resolve(__dirname,'..'),i18n=await import('file:///'+path.join(root,'assets/i18n.js').replaceAll('\\','/'));
 const app=fs.readFileSync(path.join(root,'assets/app.js'),'utf8').replace(/^import[^\n]+\n/,'').replace(/boot\(\);\s*$/,'');
 const boot=fs.readFileSync(path.join(root,'assets/appearance.js'),'utf8');
 for(const mode of ['system','light','dark'])for(const systemDark of [false,true]){
  const prefs={'noliz.appearance':mode},rootEl={dataset:{},style:{}},control={setAttribute(){},innerHTML:''};let queries=0;
  const media={matches:systemDark,addEventListener(){}};
  const ctx={messages:i18n.messages,categories:i18n.categories,relationships:i18n.relationships,document:{body:{dataset:{page:'home'}},documentElement:rootEl,addEventListener(){},getElementById(){return null},querySelector:q=>q.includes('toggle-appearance')?control:null,querySelectorAll:()=>{queries++;return []}},window:{matchMedia:q=>q.includes('color-scheme')?media:{matches:q.includes('reduced-motion')},addEventListener(){}},matchMedia:()=>media,localStorage:{getItem:k=>prefs[k]||null,setItem:(k,v)=>prefs[k]=v},location:{search:'',hash:''},URL,URLSearchParams,Date,Intl,AbortSignal,setTimeout,clearTimeout};
  vm.runInNewContext(app+'\nthis.testAPI={effectiveAppearance,setAppearance,appearanceSelect,setupMotion,card,home};',ctx);
  const expected=mode==='system'?(systemDark?'dark':'light'):mode;assert.equal(ctx.testAPI.effectiveAppearance(),expected);
  vm.runInNewContext(boot,ctx);assert.equal(rootEl.dataset.appearance,expected,'prepaint mode');
  ctx.testAPI.setAppearance('dark');assert.equal(rootEl.dataset.appearance,'dark');assert.equal(prefs['noliz.appearance'],'dark');assert.ok(ctx.testAPI.appearanceSelect().includes('value="dark" selected'));
  ctx.testAPI.setAppearance('light');assert.equal(rootEl.dataset.appearance,'light');assert.equal(prefs['noliz.appearance'],'light');
  ctx.testAPI.setupMotion();assert.equal(queries,0,'reduced motion must not attach animated reveals');
  assert.ok(ctx.testAPI.card({id:'self',url:'https://nolix.us.ci/',name:'Noliz',category:'独立作品',summary:'An authentic website directory.'}).includes('card-brand'));
 }
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'assets/release.json'))),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 for(const file of Object.values(manifest))assert.ok(fs.existsSync(path.join(root,'assets',file)));
 assert.ok(html.indexOf(manifest.appearance)<html.indexOf('rel="stylesheet"'),'appearance must be applied before CSS');
 assert.ok(fs.readFileSync(path.join(root,'assets',manifest.app),'utf8').includes(manifest.i18n),'translation cache fingerprint');
 assert.equal(fs.readFileSync(path.join(root,'assets/fonts/InterVariable.woff2')).toString('ascii',0,4),'wOF2');
 const linear=c=>(c/=255)<=.04045?c/12.92:((c+.055)/1.055)**2.4;
 const lum=hex=>{const [r,g,b]=hex.match(/../g).map(v=>linear(parseInt(v,16)));return .2126*r+.7152*g+.0722*b};
 for(const [fg,bg] of [['f1f4ed','101210'],['a3aba0','101210'],['d4efb4','192115'],['697065','f6f7f2'],['ffc3b9','341d1c'],['cae7b5','1e3019']]){const a=lum(fg),b=lum(bg);assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,'insufficient contrast '+fg+'/'+bg)}
 console.log('PASS: system/light/dark × both system palettes; persistence; prepaint; reduced motion; self-listing logo; font bytes; cache fingerprints; six WCAG AA contrast pairs.');
})().catch(e=>{console.error(e);process.exitCode=1});
