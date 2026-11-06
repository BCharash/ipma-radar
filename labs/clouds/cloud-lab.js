import {createMapFeatures} from './map-features.js';
import {PRODUCTS,catalogue,commonTime,slotAtOrBefore,geometryFor,imageURL,raster,canvasFor,photographicClouds} from './cloud-sources.js';

const $=id=>document.getElementById(id);
const iso=time=>new Date(time).toISOString();
const maps=['baselineMap','maskedMap','providerMap'].map(id=>{
  const map=L.map(id,{zoomControl:true}).setView([39.2,-9.1],6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
    attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',maxZoom:18
  }).addTo(map);
  for(const [pane,zIndex] of [['clouds',300],['rain',350],['outlines',450]]) {
    map.createPane(pane);map.getPane(pane).style.zIndex=zIndex;map.getPane(pane).style.pointerEvents='none';
  }
  return map;
});
const panels={baseline:{map:maps[0],status:$('baselineStatus')},masked:{map:maps[1],status:$('maskedStatus')}};
let metadata=null,request=null,generation=0,moveTimer=null,syncing=false;
let radarRequest=null,radarGeneration=0,radarLayers=[];
let record={lab:'SkyFlow cloud comparison',stage:'still images',runs:[]};
const mapFeatures=createMapFeatures(maps,settings=>{record.mapFeatures=settings;});
const radarStatus=document.createElement('p');radarStatus.id='radarStatus';radarStatus.className='hint';
$('overall').after(radarStatus);

function selectedTime() {
  const time=Date.parse($('observation').value+'Z');
  if(!Number.isFinite(time)) throw new Error('Choose a valid UTC observation time');
  return time;
}
function showRecord() {
  const run=record.runs.at(-1);
  if(!run) return;
  const describe=(name,item)=>!item ? `${name}: loading` : item.state==='error' ? `${name}: ${item.error}` :
    `${name}: ${item.requestedSlotUTC} | ${(item.elapsedMs/1000).toFixed(2)} s | ${item.sources.map(source=>source.origin).join(' + ')} | placement error ${item.registrationErrorCssPx?.toFixed(2) ?? 'pending'} CSS px`;
  $('metrics').textContent=[`Selection: ${run.selectionUTC}`,
    `Image grid: ${run.pixels.join(' × ')} px | ${run.crs} | ${run.cacheMode==='network' ? 'lab cache bypassed' : 'cache allowed'}`,
    describe('GeoColour',run.baseline),describe('Masked photograph',run.masked),
    run.masked?.mask ? `Mask (${run.masked.maskEdges}): ${run.masked.mask.cloud} exact cloud / ${run.masked.mask.clear} clear / ${run.masked.mask.blended} reconstructed / ${run.masked.mask.unknown} unrecognised pixels` : '',
    `Meteomatics: inactive`,record.radar ? `IPMA radar: ${record.radar.slotUTC}` : 'IPMA radar: off or unavailable',
    `${record.runs.length} run(s) retained in download; full request URLs and bounds are in the JSON record.`].filter(Boolean).join('\n');
}
function download(blob,name) {
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function retained(panel) {return panel.time===undefined ? '' : `\nPrevious image retained: ${iso(panel.time)}.`;}
function registration(panel) {
  const {overlay,geometry,map}=panel;
  if(!overlay) return null;
  const rect=overlay.getElement().getBoundingClientRect(),mapRect=map.getContainer().getBoundingClientRect();
  return Math.max(...[geometry.bounds.getSouthWest(),geometry.bounds.getNorthEast(),geometry.bounds.getCenter()].map(point=>{
    const projected=L.CRS.EPSG3857.project(point),b=geometry.bbox;
    const expected=L.point(rect.left-mapRect.left+(projected.x-b[0])/(b[2]-b[0])*rect.width,
      rect.top-mapRect.top+(b[3]-projected.y)/(b[3]-b[1])*rect.height);
    return map.latLngToContainerPoint(point).distanceTo(expected);
  }));
}
function commit(key,canvas,time,geometry,run,version) {
  if(version!==generation) return false;
  const panel=panels[key];
  const shown=key==='masked' ? panel.variants?.[$('maskedView').value] || canvas : canvas;
  const overlay=L.imageOverlay(shown.toDataURL('image/png'),geometry.bounds,{
    pane:'clouds',opacity:+$('opacity').value/100,interactive:false,
    attribution:'Satellite © <a href="https://www.eumetsat.int/">EUMETSAT</a>'
  }).addTo(panel.map);
  panel.overlay?.remove();
  Object.assign(panel,{overlay,canvas,time,geometry});
  // Overlay registration is measured after the decoded data URL has loaded.
  overlay.once('load',()=>{
    if(version!==generation) return;
    run[key].registrationErrorCssPx=registration(panel);showRecord();
  });
  if(key==='masked') $('saveClouds').disabled=false;
  return true;
}

async function loadPanel(key,time,geometry,run,version,signal) {
  const started=performance.now(),panel=panels[key];
  panel.status.dataset.state='loading';
  panel.status.textContent=`Loading ${iso(time)}…`+retained(panel);
  const loaded=[];
  try {
    const layers=key==='baseline' ? [PRODUCTS.baseline] : [PRODUCTS.texture,PRODUCTS.mask];
    // Keep fulfilled images available for cleanup if a sibling request fails.
    const results=await Promise.allSettled(layers.map(async layer=>{
      const result=await raster(imageURL(layer,time,geometry),signal,$('cacheMode').value);
      loaded.push(result);return result;
    }));
    const failed=results.find(result=>result.status==='rejected');
    if(failed) throw failed.reason;
    const images=results.map(result=>result.value);
    if(signal.aborted || version!==generation) return;
    const transformed=key==='baseline' ? {canvas:canvasFor(images[0].image)} : photographicClouds(images[0].image,images[1].image,$('maskEdges').value);
    const ms=Math.round(performance.now()-started);
    run[key]={state:'ready',requestedSlotUTC:iso(time),differenceFromSelectionMinutes:(run.selectionEpoch-time)/60000,
      elapsedMs:ms,sources:images.map(image=>image.measurement),maskEdges:key==='masked' ? $('maskEdges').value : null,mask:transformed.stats || null};
    if(key==='masked') panel.variants={clouds:transformed.canvas,texture:canvasFor(images[0].image),mask:canvasFor(images[1].image)};
    commit(key,transformed.canvas,time,geometry,run,version);
    const unknown=transformed.stats?.unknown || 0;
    let transparent=0;
    if(transformed.stats) {
      const alpha=transformed.canvas.getContext('2d').getImageData(0,0,geometry.width,geometry.height).data;
      for(let i=3;i<alpha.length;i+=4) if(alpha[i]===0) transparent++;
    }
    panel.status.dataset.state='ready';
    panel.status.textContent=`Requested slot: ${iso(time)}\n${geometry.width} × ${geometry.height} px · ${(ms/1000).toFixed(2)} s · ${images.map(image=>image.measurement.origin).join(' + ')}`+
      `\n${(run.selectionEpoch-time)/60000} min before selected time`+
      (transformed.stats ? `\nTransparent: ${((transparent/transformed.stats.total)*100).toFixed(1)}% · unrecognised: ${unknown} · palette blends: ${transformed.stats.blended}` : '')+
      (unknown ? '\nUnrecognised classes omitted; inspect edges before judging this prototype.' : '');
  } catch(error) {
    if(signal.aborted || version!==generation) return;
    run[key]={state:'error',error:error.message,requestedSlotUTC:iso(time),retainedSlotUTC:panel.time===undefined ? null : iso(panel.time)};
    panel.status.dataset.state='error';
    panel.status.textContent=`Unavailable: ${error.message}. Try another time or reload.`+retained(panel);
  } finally {for(const result of loaded) result.image.close();}
}

export async function loadComparison() {
  if(!metadata) return;
  clearTimeout(moveTimer);request?.abort();const version=++generation;
  const controller=new AbortController();request=controller;
  $('overall').dataset.state='loading';$('overall').textContent='Loading comparison; previous images remain until ready…';
  try {
    const time=selectedTime(),geometry=geometryFor(maps,+$('resolution').value);
    const maskedTime=commonTime(metadata,[PRODUCTS.texture,PRODUCTS.mask],time);
    const baselineTime=slotAtOrBefore(metadata[PRODUCTS.baseline],time);
    const run={startedUTC:iso(Date.now()),selectionUTC:iso(time),selectionEpoch:time,
      mapFeatures:mapFeatures.settings(),resolution:+$('resolution').value,cacheMode:$('cacheMode').value,crs:'EPSG:3857',bbox:geometry.bbox,
      pixels:[geometry.width,geometry.height],view:{center:maps[0].getCenter(),zoom:maps[0].getZoom()},
      baseline:null,masked:null,provider:{state:'inactive',reason:'Access and distribution terms not verified'}};
    record.runs.push(run);if(record.runs.length>20) record.runs.shift();showRecord();
    if($('radar').checked) loadRadar(time);
    await Promise.all([loadPanel('baseline',baselineTime,geometry,run,version,controller.signal),
      loadPanel('masked',maskedTime,geometry,run,version,controller.signal)]);
    if(version!==generation) return;
    const good=[run.baseline,run.masked].filter(result=>result?.state==='ready').length;
    const difference=Math.abs(baselineTime-maskedTime)/60000;
    $('overall').dataset.state=good===2 ? 'ready' : 'error';
    $('overall').textContent=`${good}/2 active comparisons ready · requested product slots differ by ${difference} min.`+
      (good===2 ? ' Inspect photographic detail and clear-area transparency.' : ' Previous images, if present, are labelled independently.');
    run.finishedUTC=iso(Date.now());showRecord();
  } catch(error) {
    if(version!==generation) return;
    $('overall').dataset.state='error';$('overall').textContent=error.message;
  }
}

function radarImage(url,signal) {
  return new Promise(resolve=>{
    const image=new Image();let finished=false;
    const finish=value=>{
      if(finished) return;finished=true;clearTimeout(timer);
      signal.removeEventListener('abort',abort);image.onload=image.onerror=null;
      if(!value) image.removeAttribute('src');resolve(value);
    };
    const abort=()=>finish(false);
    const timer=setTimeout(abort,8000);
    signal.addEventListener('abort',abort,{once:true});
    image.onload=()=>finish(image);image.onerror=()=>finish(false);
    if(signal.aborted) abort();else image.src=url;
  });
}

async function loadRadar(time) {
  radarRequest?.abort();const version=++radarGeneration;
  const controller=new AbortController();radarRequest=controller;
  radarStatus.textContent='Loading IPMA radar at or before the selected time…';
  const latest=Math.floor(time/300000)*300000;
  try {
    let found=null;
    for(let offset=0;offset<=6 && !found;offset+=2) {
      const attempts=await Promise.all([offset,offset+1].filter(value=>value<=6).map(async value=>{
        const timestamp=latest-value*300000;
        const date=iso(timestamp),url=`https://www.ipma.pt/resources.www/transf/radar/por/pcr-${date.slice(0,10)}T${date.slice(11,13)}${date.slice(14,16)}.png`;
        try {
          const image=await radarImage(url,controller.signal);
          return image ? {timestamp,url} : null;
        } catch { return null; }
      }));
      if(controller.signal.aborted) return;
      found=attempts.find(Boolean);
    }
    if(!found) throw new Error('No IPMA image in the preceding 30 minutes');
    if(version!==radarGeneration || !$('radar').checked) return;
    for(const layer of radarLayers) layer.remove();
    radarLayers=maps.map(map=>L.imageOverlay(found.url,[[34.011513,-12.454795],[43.792862,-4.345465]],{
      pane:'rain',opacity:.75,interactive:false,attribution:'Radar © IPMA'
    }).addTo(map));
    radarStatus.textContent=`IPMA radar: ${iso(found.timestamp)} · ${(time-found.timestamp)/60000} min before selection · original IPMA bounds.`;
    record.radar={slotUTC:iso(found.timestamp),selectionUTC:iso(time)};showRecord();
  } catch(error) {
    if(controller.signal.aborted || version!==radarGeneration) return;
    radarStatus.textContent=`IPMA radar unavailable: ${error.message}.`+(radarLayers.length ? ' Previous radar retained; see comparison record for its time.' : '');
  }
}

for(const map of maps) map.on('moveend',()=>{
  if(syncing) return;
  syncing=true;
  for(const other of maps) if(other!==map) other.setView(map.getCenter(),map.getZoom(),{animate:false});
  syncing=false;clearTimeout(moveTimer);
  if(metadata) moveTimer=setTimeout(loadComparison,500);
});
$('controls').addEventListener('submit',event=>{event.preventDefault();loadComparison();});
$('resolution').addEventListener('change',loadComparison);
$('maskEdges').addEventListener('change',loadComparison);
$('maskedView').addEventListener('change',()=>{
  const panel=panels.masked,canvas=panel.variants?.[$('maskedView').value];
  if(canvas) panel.overlay.setUrl(canvas.toDataURL('image/png'));
});
$('opacity').addEventListener('input',()=>{
  $('opacityValue').value=$('opacity').value+'%';
  for(const panel of Object.values(panels)) panel.overlay?.setOpacity(+$('opacity').value/100);
});
$('home').addEventListener('click',()=>maps[0].setView([39.2,-9.1],6,{animate:false}));
$('latest').addEventListener('click',()=>initialize());
$('radar').addEventListener('change',()=>{
  if($('radar').checked) {try {loadRadar(selectedTime());} catch(error) {radarStatus.textContent=error.message;}}
  else {radarRequest?.abort();radarGeneration++;for(const layer of radarLayers) layer.remove();radarLayers=[];radarStatus.textContent='';record.radar=null;showRecord();}
});
$('export').addEventListener('click',()=>download(new Blob([JSON.stringify({...record,notes:$('notes').value},null,2)],{type:'application/json'}),'skyflow-cloud-comparison.json'));
$('saveClouds').addEventListener('click',()=>panels.masked.canvas?.toBlob(blob=>{
  if(blob) download(blob,`skyflow-clouds-${iso(panels.masked.time).replaceAll(':','-')}.png`);
}));

async function initialize() {
  request?.abort();generation++;
  const controller=new AbortController();request=controller;
  $('overall').textContent='Reading satellite availability…';
  try {
    const available=await catalogue(controller.signal);
    if(controller.signal.aborted) return;
    metadata=available;
    const time=commonTime(metadata,Object.values(PRODUCTS));
    $('observation').value=iso(time).slice(0,16);
    await loadComparison();
  } catch(error) {
    if(controller.signal.aborted) return;
    $('overall').dataset.state='error';$('overall').textContent=`Availability failed: ${error.message}. Use Latest common time to retry.`;
  }
}

// Read-only diagnostics for repeatable browser checks; no credentials in state.
window.cloudLab={maps,panels,mapFeatures,loadComparison,get record(){return record;},get metadata(){return metadata;},registration};
initialize();
