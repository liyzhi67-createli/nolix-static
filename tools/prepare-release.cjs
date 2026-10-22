// Fingerprint generated assets so an old cached script cannot mask brand updates.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),assets=path.join(root,'assets');
const digest=s=>crypto.createHash('sha256').update(s).digest('hex').slice(0,12);
const mark=fs.readFileSync(path.join(assets,'mark.svg'),'utf8'),markFile='mark.'+digest(mark)+'.svg';
const translations=fs.readFileSync(path.join(assets,'i18n.js'),'utf8'),i18nFile='i18n.'+digest(translations)+'.js';
const appearance=fs.readFileSync(path.join(assets,'appearance.js'),'utf8'),appearanceFile='appearance.'+digest(appearance)+'.js';
const app=fs.readFileSync(path.join(assets,'app.js'),'utf8').replace("'/assets/mark.svg'","'/assets/"+markFile+"'").replace("'./i18n.js'","'./"+i18nFile+"'");
const css=fs.readFileSync(path.join(assets,'noliz.css'),'utf8')+'\n'+fs.readFileSync(path.join(assets,'polish.css'),'utf8');
const appFile='app.'+digest(app)+'.js',cssFile='noliz.'+digest(css)+'.css';
for(const [file,content] of [[markFile,mark],[appFile,app],[cssFile,css],[i18nFile,translations],[appearanceFile,appearance]])fs.writeFileSync(path.join(assets,file),content);
const routes=['','search','submit','promote','account','login','admin','admin/reviews','admin/submissions','admin/promotions','privacy'];
for(const route of routes){const file=path.join(root,route,'index.html');let html=fs.readFileSync(file,'utf8');html=html.replace(/\/assets\/app(?:\.[a-f0-9]+)?\.js(?:\?[^"\s]*)?/g,'/assets/'+appFile).replace(/\/assets\/noliz(?:\.[a-f0-9]+)?\.css(?:\?[^"\s]*)?/g,'/assets/'+cssFile);const boot='<script src="/assets/'+appearanceFile+'"></script>';if(/<script src="\/assets\/appearance[^>]+><\/script>/.test(html))html=html.replace(/<script src="\/assets\/appearance[^>]+><\/script>/,boot);else html=html.replace('  <link rel="stylesheet"','  '+boot+'\n  <link rel="stylesheet"');if(!html.includes('InterVariable.woff2'))html=html.replace('  <link rel="stylesheet"','  <link rel="preload" href="/assets/fonts/InterVariable.woff2" as="font" type="font/woff2" crossorigin>\n  <link rel="stylesheet"');fs.writeFileSync(file,html);}
const manifest={app:appFile,css:cssFile,mark:markFile,i18n:i18nFile,appearance:appearanceFile};fs.writeFileSync(path.join(assets,'release.json'),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify(manifest));
