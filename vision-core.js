/* Browser ORB features are ranked with geometric evidence; counts are not probabilities. */
(function(scope) {
  function extract(cv, rgba, width, height) {
    const src = cv.matFromArray(height, width, cv.CV_8UC4, rgba), gray = new cv.Mat(), small = new cv.Mat();
    const keypoints = new cv.KeyPointVector(), descriptors = new cv.Mat(), mask = new cv.Mat(), orb = new cv.ORB(600);
    try {
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      orb.detectAndCompute(gray, mask, keypoints, descriptors);
      const points = new Float32Array(keypoints.size() * 2);
      for (let i = 0; i < keypoints.size(); i++) { const p = keypoints.get(i).pt; points[i * 2] = p.x; points[i * 2 + 1] = p.y; }
      cv.resize(gray, small, new cv.Size(9, 8), 0, 0, cv.INTER_AREA);
      const hash = new Uint8Array(64);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) hash[y * 8 + x] = small.data[y * 9 + x] > small.data[y * 9 + x + 1] ? 1 : 0;
      cv.resize(gray, small, new cv.Size(16, 16), 0, 0, cv.INTER_AREA);
      const pixels = new Uint8Array(small.data), mean = pixels.reduce((a,b) => a+b,0)/256;
      const variance = pixels.reduce((a,b) => a+(b-mean)**2,0)/256;
      return { version: 1, width, height, points, descriptors: new Uint8Array(descriptors.data), rows: descriptors.rows, hash, pixels, variance };
    } finally { [src,gray,small,keypoints,descriptors,mask,orb].forEach(x => x.delete()); }
  }
  function hashDistance(a,b) { let n=0; for(let i=0;i<64;i++) n+=a[i]!==b[i]; return n; }
  function pixelDistance(a,b) { let n=0; for(let i=0;i<256;i++) n+=Math.abs(a[i]-b[i]); return n/256; }
  function compare(cv, query, reference) {
    const hd=hashDistance(query.hash,reference.hash), pd=pixelDistance(query.pixels,reference.pixels);
    let inliers=0, matches=0;
    if(query.rows>=4 && reference.rows>=4) {
      const q=cv.matFromArray(query.rows,32,cv.CV_8U,query.descriptors), r=cv.matFromArray(reference.rows,32,cv.CV_8U,reference.descriptors);
      const matcher=new cv.BFMatcher(cv.NORM_HAMMING,false), pairs=new cv.DMatchVectorVector();
      let src,dst,mask,h;
      try {
        matcher.knnMatch(q,r,pairs,2);
        const unique=new Map();
        for(let i=0;i<pairs.size();i++) {
          const pair=pairs.get(i);
          if(pair.size()>=2) { const a=pair.get(0), b=pair.get(1); if(a.distance<.75*b.distance && a.distance<70) { const old=unique.get(a.trainIdx); if(!old || a.distance<old.distance) unique.set(a.trainIdx,{queryIdx:a.queryIdx,trainIdx:a.trainIdx,distance:a.distance}); } }
          pair.delete();
        }
        matches=unique.size;
        if(matches>=4) {
          const a=[],b=[];
          for(const m of unique.values()) { a.push(query.points[m.queryIdx*2],query.points[m.queryIdx*2+1]); b.push(reference.points[m.trainIdx*2],reference.points[m.trainIdx*2+1]); }
          src=cv.matFromArray(matches,1,cv.CV_32FC2,a); dst=cv.matFromArray(matches,1,cv.CV_32FC2,b); mask=new cv.Mat();
          h=cv.findHomography(src,dst,cv.RANSAC,4,mask);
          if(!h.empty()) inliers=mask.data.reduce((a,b)=>a+b,0);
        }
      } finally { [q,r,matcher,pairs,src,dst,mask,h].filter(Boolean).forEach(x=>x.delete()); }
    }
    const nearImage=hd<=5 && pd<18 && query.variance>80 && reference.variance>80;
    return {inliers,matches,hashDistance:hd,pixelDistance:pd,nearImage,accepted:inliers>=8 || nearImage,score:inliers + (nearImage ? 1000-hd*12-pd : 0)};
  }
  function bands(feature) {
    const result=new Set(),d=feature.descriptors;
    for(let row=0;row<feature.rows;row++) for(let band=0;band<8;band++) { const offset=row*32+band*4; result.add(band*65536+(d[offset]<<8|d[offset+1])); }
    return result;
  }
  function buildLookup(records) {
    const lookup=new Map();
    for(const record of records) for(const word of bands(record.features)) { let ids=lookup.get(word); if(!ids) lookup.set(word,ids=[]); ids.push(record.id); }
    return lookup;
  }
  function shortlist(query, records, lookup, limit=180) {
    if(records.length<=limit) return records;
    const votes=new Map();
    for(const word of bands(query)) { const ids=lookup.get(word); if(!ids || ids.length>Math.max(60,records.length*.08)) continue; const weight=1/Math.sqrt(ids.length); for(const id of ids) votes.set(id,(votes.get(id)||0)+weight); }
    const byVotes=[...votes].sort((a,b)=>b[1]-a[1]).slice(0,limit).map(x=>x[0]);
    const byHash=[...records].sort((a,b)=>hashDistance(query.hash,a.features.hash)-hashDistance(query.hash,b.features.hash)).slice(0,60).map(x=>x.id);
    const ids=new Set([...byVotes,...byHash]);
    return records.filter(x=>ids.has(x.id));
  }
  scope.Vision={extract,compare,hashDistance,buildLookup,shortlist};
})(globalThis);
