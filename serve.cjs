const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const base=__dirname,port=Number(process.env.TUJI_PORT||8792);
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.md':'text/plain; charset=utf-8','.wasm':'application/wasm'};
http.createServer((req,res)=>{
  let target;try{target=path.resolve(base,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));}catch{res.writeHead(400);res.end();return;}
  if(target!==base&&!target.startsWith(base+path.sep)){res.writeHead(403);res.end();return;}
  if(target===base)target=path.join(base,'index.html');
  if(!fs.existsSync(target)||!fs.statSync(target).isFile()){res.writeHead(404);res.end('Not found');return;}
  res.setHeader('Content-Type',mime[path.extname(target)]||'application/octet-stream');
  res.setHeader('Cache-Control','no-cache');fs.createReadStream(target).pipe(res);
}).listen(port,'127.0.0.1',()=>console.log(`图迹预览 http://127.0.0.1:${port}/`));
