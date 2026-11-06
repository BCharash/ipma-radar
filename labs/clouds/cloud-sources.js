/* Lab-only sources and raw-image cache. No production scripts or cache are used. */
export const WMS = 'https://view.eumetsat.int/geoserver/wms';
export const PRODUCTS = {baseline:'mtg_fd:rgb_geocolour', texture:'msg_fes:rgb_natural', mask:'msg_fes:clm'};
const CACHE = 'skyflow-cloud-lab-images-v1';
const memory = new Map();
let writes = Promise.resolve();

export async function timedFetch(url, signal, timeout=30000, options={}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort',abort,{once:true});
  const timer = setTimeout(abort,timeout);
  if(signal.aborted) abort();
  try {
    const response = await fetch(url,{...options,signal:controller.signal,credentials:'omit'});
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
    // Consume within the deadline; a stalled response body must also time out.
    const blob = await response.blob();
    if(controller.signal.aborted) throw new DOMException('Request cancelled or timed out','AbortError');
    return blob;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort',abort);
  }
}

export function parseCatalogue(text) {
  const xml = new DOMParser().parseFromString(text,'application/xml');
  if(xml.querySelector('parsererror')) throw new Error('Invalid satellite catalogue');
  const found = {};
  for(const layer of xml.getElementsByTagNameNS('*','Layer')) {
    const name = [...layer.children].find(node=>node.localName==='Name')?.textContent.trim();
    if(!Object.values(PRODUCTS).includes(name)) continue;
    const dimension = [...layer.children].find(node=>node.localName==='Dimension' && node.getAttribute('name')==='time');
    if(!dimension) continue;
    const parts = dimension.textContent.trim().split('/');
    const duration = /^PT(\d+)M$/.exec(parts[2] || '');
    const explicit = parts.length===1 ? parts[0].split(',').map(Date.parse).filter(Number.isFinite).sort((a,b)=>a-b) : null;
    const start = explicit ? explicit[0] : Date.parse(parts[0]);
    const end = explicit ? explicit.at(-1) : Date.parse(parts[1]);
    if(!Number.isFinite(start) || !Number.isFinite(end) || (!explicit && !duration)) throw new Error(`Unsupported time catalogue: ${name}`);
    found[name] = {start,end,step:duration ? +duration[1]*60000 : null,explicit};
  }
  return found;
}

export async function catalogue(signal) {
  const entries = await Promise.all(['msg_fes','mtg_fd'].map(async namespace => {
    const blob = await timedFetch(`${WMS}?service=WMS&request=GetCapabilities&version=1.3.0&namespace=${namespace}`,signal,15000,{cache:'no-cache'});
    return parseCatalogue(await blob.text());
  }));
  const result = Object.assign({},...entries);
  for(const layer of Object.values(PRODUCTS)) if(!result[layer]) throw new Error(`Missing product: ${layer}`);
  return result;
}

export function slotAtOrBefore(metadata,time) {
  if(time < metadata.start) throw new Error('Selected time precedes available imagery');
  const target = Math.min(time,metadata.end);
  if(metadata.explicit) return metadata.explicit.filter(value=>value<=target).at(-1);
  return metadata.start + Math.floor((target-metadata.start)/metadata.step)*metadata.step;
}

export function commonTime(metadata,keys,time=Math.min(...keys.map(key=>metadata[key].end))) {
  let candidate = time;
  for(let attempt=0;attempt<1000;attempt++) {
    const slots = keys.map(key=>slotAtOrBefore(metadata[key],candidate));
    const earliest = Math.min(...slots);
    if(slots.every(slot=>slot===earliest)) return earliest;
    candidate = earliest;
  }
  throw new Error('No common observation slot found');
}

export function geometryFor(maps,size) {
  const bounds = L.latLngBounds(maps[0].getBounds());
  for(const map of maps.slice(1)) bounds.extend(map.getBounds());
  const sw = L.CRS.EPSG3857.project(bounds.pad(.12).getSouthWest());
  const ne = L.CRS.EPSG3857.project(bounds.pad(.12).getNorthEast());
  // Keep comparisons in the regional MSG/MTG footprint for this first lab.
  if(bounds.getSouth() < -65 || bounds.getNorth() > 65 || bounds.getWest() < -70 || bounds.getEast() > 70)
    throw new Error('This first lab covers Portugal and nearby Europe/Atlantic. Return to Portugal view.');
  const grid=50000;
  const bbox=[Math.floor(sw.x/grid)*grid,Math.floor(sw.y/grid)*grid,Math.ceil(ne.x/grid)*grid,Math.ceil(ne.y/grid)*grid];
  const ratio=(bbox[2]-bbox[0])/(bbox[3]-bbox[1]);
  return {bbox,width:Math.max(1,Math.round(ratio>=1 ? size : size*ratio)),height:Math.max(1,Math.round(ratio>=1 ? size/ratio : size)),
    bounds:L.latLngBounds(L.CRS.EPSG3857.unproject(L.point(bbox[0],bbox[1])),L.CRS.EPSG3857.unproject(L.point(bbox[2],bbox[3])))};
}

export function imageURL(layer,time,geometry) {
  const params = new URLSearchParams({service:'WMS',version:'1.1.1',request:'GetMap',layers:layer,
    styles:'',srs:'EPSG:3857',bbox:geometry.bbox.join(','),width:geometry.width,height:geometry.height,
    time:new Date(time).toISOString(),format:'image/png',transparent:'true',
    interpolations:layer===PRODUCTS.mask ? 'nearest neighbor' : 'bilinear',format_options:'antialias:none'});
  return `${WMS}?${params}`;
}

async function cacheStore() {
  try { return globalThis.caches ? await caches.open(CACHE) : null; } catch { return null; }
}
function remember(url,blob) {
  memory.delete(url); memory.set(url,blob);
  let bytes=[...memory.values()].reduce((total,item)=>total+item.size,0);
  while(memory.size>24 || bytes>16*1024*1024) {
    const key=memory.keys().next().value;bytes-=memory.get(key).size;memory.delete(key);
  }
}
function persist(url,blob) {
  writes=writes.then(async()=>{
    const cache=await cacheStore();if(!cache) return;
    await cache.put(url,new Response(blob,{headers:{'Content-Type':'image/png','X-Lab-Bytes':String(blob.size)}}));
    const keys=await cache.keys();let total=0;
    const sizes=await Promise.all(keys.map(async key=>+(await cache.match(key)).headers.get('X-Lab-Bytes')));
    total=sizes.reduce((a,b)=>a+b,0);
    for(let i=0;i<keys.length && (keys.length-i>48 || total>32*1024*1024);i++) {
      await cache.delete(keys[i]);total-=sizes[i];
    }
  }).catch(()=>{});
}

export async function raster(url,signal,mode='cached') {
  const started=performance.now();let blob;let origin='network';
  if(mode==='cached') {
    blob=memory.get(url);
    if(blob) origin='memory';
    else {
      const cache=await cacheStore();
      try { const response=cache && await cache.match(url);if(response) {blob=await response.blob();origin='disk';} } catch {}
    }
  }
  if(!blob) {
    blob=await timedFetch(url,signal,30000,{cache:mode==='network' ? 'no-store' : 'default'});
    if(!blob.type.includes('image/png')) throw new Error('Provider did not return a PNG image');
    persist(url,blob);
  }
  if(signal.aborted) throw new DOMException('Superseded','AbortError');
  remember(url,blob);
  const image=await createImageBitmap(blob);
  if(signal.aborted) {image.close();throw new DOMException('Superseded','AbortError');}
  return {image,measurement:{url,origin,bytes:blob.size,elapsedMs:Math.round(performance.now()-started)}};
}

export function canvasFor(image) {
  const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
  canvas.getContext('2d').drawImage(image,0,0);return canvas;
}

export function photographicClouds(texture,mask,edges='exact') {
  if(texture.width!==mask.width || texture.height!==mask.height) throw new Error('Texture/mask pixel grids differ');
  const canvas=canvasFor(texture),context=canvas.getContext('2d');
  const pixels=context.getImageData(0,0,canvas.width,canvas.height);
  const maskPixels=canvasFor(mask).getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
  const stats={cloud:0,clear:0,noData:0,blended:0,unknown:0,total:canvas.width*canvas.height};
  for(let i=0;i<maskPixels.length;i+=4) {
    const [r,g,b,a]=maskPixels.subarray(i,i+4);
    // Exact provider categorical palette, NOT a brightness threshold on photos.
    // White=cloud; blue=clear water; green=clear land; black/alpha0=no data.
    if(a===255 && r===255 && g===255 && b===255) {stats.cloud++;continue;}
    const sourceAlpha=pixels.data[i+3];
    pixels.data[i+3]=0;
    if(!a || (r===0 && g===0 && b===0)) stats.noData++;
    else if(a===255 && r===0 && ((g===0 && b===255) || (g===192 && b===0))) stats.clear++;
    else {
      // A WMS resampler may mix the four categorical palette colours even
      // with nearest-neighbour requested. Solve that palette mixture, never
      // threshold the photographic image. Red occurs only in white/cloud.
      const cloud=r/255,land=(g-r)/192,water=(b-r)/255;
      const valid=land>=-1/192 && water>=-1/255 && cloud+land+water<=1.015;
      if(edges==='blended' && valid) {
        pixels.data[i+3]=Math.round(sourceAlpha*cloud*a/255);
        stats.blended++;
      } else stats.unknown++;
    }

  }
  if(!stats.cloud && !stats.clear && !stats.blended) throw new Error('Cloud Mask palette not recognised, or no classified data in view');
  context.putImageData(pixels,0,0);
  return {canvas,stats};
}
