const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../folders.js'));
 const {buildFolders,assetFolders,assignBundleFolders,inFolder,validFolders}=await import('data:text/javascript;base64,'+source.toString('base64'));
 const assets=[{online:true,path:'\\\\server\\share\\素材\\1-产品图png\\底妆\\a.jpg',shared:'\\\\server\\share\\素材\\1-产品图png\\底妆'},{online:true,path:'\\\\server\\share\\素材\\9-橱窗图\\b.jpg',shared:'\\\\server\\share\\素材\\9-橱窗图'}];
 const model=buildFolders(assets);assert.deepEqual(model.base,['server','share','素材']);assert.equal(model.root.children.get('1-产品图png').count,1);assert.ok(inFolder(assets[0],['1-产品图png'],model.base));assert.ok(!inFolder(assets[1],['1-产品图png'],model.base));
 const imported=[{path:'C:/导出/底妆/a.jpg'},{path:'C:/导出/唇妆/b.jpg'}];assignBundleFolders('产品素材.ZIP',imported);assert.deepEqual(imported[0].folders,['产品素材','底妆']);assert.deepEqual(imported[1].folders,['产品素材','唇妆']);
 const restored=structuredClone(imported);assignBundleFolders('浏览器备份.zip',restored,true);assert.deepEqual(restored,imported,'Backup retains original folder names');
 assert.equal(buildFolders([...imported,...restored]).root.children.get('产品素材').count,4,'Same ZIP names merge into one folder');
 assert.deepEqual(assetFolders({path:'本地图片 / photo.jpg'}),['本地图片']);assert.ok(!validFolders(['..']));
 console.log('PASS: shared path hierarchy, ZIP naming, nested filtering, backup preservation and same-name merging.');
})().catch(error=>{console.error(error);process.exitCode=1;});
