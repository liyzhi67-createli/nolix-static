const fs=require('node:fs'),path=require('node:path');
const {Resvg}=require('../../node_modules/@resvg/resvg-js');
const mark=fs.readFileSync(path.join(__dirname,'../assets/mark.svg'),'utf8').replace('<svg ','<svg x="28" y="20" width="104" height="80" ');
const canvas='<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 160 120"><rect width="160" height="120" fill="#f6f7f2"/>'+mark+'</svg>';
fs.writeFileSync(path.join(__dirname,'../../noliz-logo-preview.png'),new Resvg(canvas).render().asPng());
