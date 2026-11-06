import {createMapFeatures} from './map-features.js';
import {createVectorMap} from './vector-map.js';
import {PRODUCTS,catalogue,commonTime,slotAtOrBefore,geometryFor,imageURL,raster,canvasFor,timedFetch} from './cloud-sources.js';
const $=id=>document.getElementById(id),iso=time=>new Date(time).toISOString();
const maps=['baselineMap','vectorMap','providerMap'].map((id,index)=>{
  const map=L.map(id,{zoomControl:true}).setView([39.2,-9.1],6);
  if(index===0) L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
    attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',maxZoom:18
  }).addTo(map);
  for(const [pane,zIndex] of [['clouds',300],['rain',350],['outlines',450]]) {
    map.createPane(pane);map.getPane(pane).style.zIndex=zIndex;map.getPane(pane).style.pointerEvents='none';
  }
  return map;
});
const renderers={vector:createVectorMap(maps[1],$('vectorMapStatus')),provider:createVectorMap(maps[2],$('providerMapStatus'))};
const panels={baseline:{map:maps[0],status:$('baselineStatus')},vector:{map:maps[1],status:$('vectorStatus'),renderer:renderers.vector},
  provider:{map:maps[2],status:$('providerStatus'),renderer:renderers.provider}};
let metadata=null,request=null,generation=0,moveTimer=null,syncing=false;
let radarRequest=null,radarGeneration=0,radarLayers=[];
let record={lab:'SkyFlow cloud comparison',stage:'still images',runs:[]};
const mapFeatures=createMapFeatures([maps[0]],settings=>{record.mapFeatures=settings;});
const radarStatus=document.createElement('p');radarStatus.id='radarStatus';radarStatus.className='hint';$('overall').after(radarStatus);
function selectedTime() {
  const time=Date.parse($('observation').value+'Z');
  if(!Number.isFinite(time)) throw new Error('Choose a valid UTC observation time');return time;
}
function showRecord() {
  const run=record.runs.at(-1);if(!run) return;
  const describe=(name,item)=>!item ? `${name}: loading` : item.state!=='ready' ? `${name}: ${item.error || item.reason || item.state}` :
    `${name}: ${item.requestedSlotUTC} | ${(item.elapsedMs/1000).toFixed(2)} s | placement error ${item.registrationErrorCssPx?.toFixed(2) ?? 'pending'} CSS px`;
  $('metrics').textContent=[`Selection: ${run.selectionUTC}`,`Image grid: ${run.pixels.join(' × ')} px | ${run.crs}`,
    describe('GeoColour reference',run.baseline),describe('GeoColour + vector map',run.vector),describe('Meteomatics',run.provider),
    record.radar ? `IPMA radar: ${record.radar.slotUTC}` : 'IPMA radar: off or unavailable',
    `${record.runs.length} run(s) in download; provider credentials are never included.`].join('\n');
}
function registration(panel) {return panel.renderer ? panel.renderer.registration(panel.geometry.bounds) : leafletRegistration(panel);}
function leafletRegistration(panel) {
  if(!panel.overlay) return null;
  const {map,geometry}=panel,rect=panel.overlay.getElement().getBoundingClientRect(),parent=map.getContainer().getBoundingClientRect(),b=geometry.bbox;
  return Math.max(...[geometry.bounds.getSouthWest(),geometry.bounds.getNorthEast(),geometry.bounds.getCenter()].map(point=>{
    const q=L.CRS.EPSG3857.project(point);
    return map.latLngToContainerPoint(point).distanceTo(L.point(rect.left-parent.left-map.getContainer().clientLeft+(q.x-b[0])/(b[2]-b[0])*rect.width,
      rect.top-parent.top-map.getContainer().clientTop+(b[3]-q.y)/(b[3]-b[1])*rect.height));
  }));
}
function retained(panel) {return panel.time===undefined ? '' : `\nPrevious image retained: ${iso(panel.time)}.`;}
async function commit(key,canvas,time,geometry,run,version) {
  const panel=panels[key];
  if(panel.renderer && !await panel.renderer.ready) throw new Error('Vector map unavailable; see map status');
  if(version!==generation) return;
  if(panel.renderer) await panel.renderer.putImage('skyflow-clouds',canvas.toDataURL(),geometry.bounds,+$('opacity').value/100);
  else {
    const overlay=L.imageOverlay(canvas.toDataURL(),geometry.bounds,{pane:'clouds',opacity:+$('opacity').value/100,interactive:false,
      attribution:'Satellite © <a href="https://www.eumetsat.int/">EUMETSAT</a>'}).addTo(panel.map);
    panel.overlay?.remove();panel.overlay=overlay;
    overlay.once('load',()=>{if(version===generation) {run[key].registrationErrorCssPx=registration(panel);showRecord();}});
  }
  Object.assign(panel,{canvas,time,geometry});
  if(panel.renderer) run[key].registrationErrorCssPx=registration(panel);
  panel.status.dataset.state='ready';
  panel.status.textContent=`Requested slot: ${iso(time)}\n${geometry.width} × ${geometry.height} px · ${(run[key].elapsedMs/1000).toFixed(2)} s`+
    (key==='vector' ? '\nSame GeoColour pixels as panel 1; detailed map features above.' : '')+
    (key==='provider' ? '\nPhotographic cloud overlay · requested time; acquisition time not independently verified.' : '');
}
function fail(key,error,run,version) {
  if(version!==generation) return;
  run[key]={state:'error',error:error.message};panels[key].status.dataset.state='error';
  panels[key].status.textContent='Unavailable: '+error.message+retained(panels[key]);
}
async function loadGeoColour(time,geometry,run,version,signal) {
  let result;
  try {
    result=await raster(imageURL(PRODUCTS.baseline,time,geometry),signal,$('cacheMode').value);
    if(signal.aborted || version!==generation) return;
    const canvas=canvasFor(result.image);
    for(const key of ['baseline','vector']) run[key]={state:'ready',requestedSlotUTC:iso(time),elapsedMs:result.measurement.elapsedMs,
      sources:[result.measurement],sharedImage:true};
    await commit('baseline',canvas,time,geometry,run,version);
    try {await commit('vector',canvas,time,geometry,run,version);} catch(error) {fail('vector',error,run,version);}
  } catch(error) {if(!signal.aborted) for(const key of ['baseline','vector']) fail(key,error,run,version);}
  finally {result?.image.close();}
}
async function loadProvider(time,geometry,run,version,signal) {
  let image;
  try {
    const started=performance.now(),query=new URLSearchParams({time:iso(time),bbox:geometry.bbox.join(','),width:geometry.width,height:geometry.height});
    const blob=await timedFetch('/__lab/meteomatics?'+query,signal,30000,{cache:'no-store'});
    if(!blob.type.includes('image/png')) throw new Error('Meteomatics returned an exception instead of PNG');
    image=await createImageBitmap(blob);
    if(signal.aborted || version!==generation) return;
    run.provider={state:'ready',requestedSlotUTC:iso(time),elapsedMs:Math.round(performance.now()-started),product:'sat_cloud_layer:idx',bytes:blob.size};
    await commit('provider',canvasFor(image),time,geometry,run,version);
  } catch(error) {if(!signal.aborted) fail('provider',error,run,version);}
  finally {image?.close();}
}
export async function loadComparison() {
  if(!metadata) return;
  clearTimeout(moveTimer);request?.abort();const version=++generation,controller=new AbortController();request=controller;
  $('overall').dataset.state='loading';$('overall').textContent='Loading the same GeoColour observation in both reference views…';
  try {
    const time=selectedTime(),slot=slotAtOrBefore(metadata[PRODUCTS.baseline],time),geometry=geometryFor(maps,+$('resolution').value);
    const enabled=$('providerEnabled').checked;
    const run={startedUTC:iso(Date.now()),selectionUTC:iso(time),mapFeatures:mapFeatures.settings(),resolution:+$('resolution').value,
      cacheMode:$('cacheMode').value,crs:'EPSG:3857',bbox:geometry.bbox,pixels:[geometry.width,geometry.height],
      view:{center:maps[0].getCenter(),zoom:maps[0].getZoom()},baseline:null,vector:null,
      provider:enabled ? null : {state:'inactive',reason:'Not enabled; satellite account access required'}};
    record.runs.push(run);if(record.runs.length>20) record.runs.shift();showRecord();
    for(const key of enabled ? ['baseline','vector','provider'] : ['baseline','vector']) {
      panels[key].status.dataset.state='loading';panels[key].status.textContent=`Loading ${iso(slot)}…`+retained(panels[key]);
    }
    if($('radar').checked) loadRadar(time);
    await Promise.all([loadGeoColour(slot,geometry,run,version,controller.signal),
      enabled ? loadProvider(slot,geometry,run,version,controller.signal) : Promise.resolve()]);
    if(version!==generation) return;
    run.finishedUTC=iso(Date.now());showRecord();
    const keys=enabled ? ['baseline','vector','provider'] : ['baseline','vector'],good=keys.filter(key=>run[key]?.state==='ready').length;
    $('overall').dataset.state=good===keys.length ? 'ready' : 'error';
    $('overall').textContent=`${good}/${keys.length} comparisons ready · panels 1 and 2 use identical GeoColour pixels and requested UTC time.`;
  } catch(error) {if(version===generation) {$('overall').dataset.state='error';$('overall').textContent=error.message;}}
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
    const bounds=L.latLngBounds([[34.011513,-12.454795],[43.792862,-4.345465]]);
    radarLayers=[L.imageOverlay(found.url,bounds,{pane:'rain',opacity:.75,interactive:false,attribution:'Radar © IPMA'}).addTo(maps[0])];
    await Promise.all(Object.values(renderers).map(renderer=>renderer.putImage('skyflow-radar',found.url,bounds,.75)));
    if(version!==radarGeneration || !$('radar').checked) {
      for(const renderer of Object.values(renderers)) renderer.removeImage('skyflow-radar');return;
    }
    radarStatus.textContent=`IPMA radar: ${iso(found.timestamp)} · ${(time-found.timestamp)/60000} min before selection · original IPMA bounds.`;
    record.radar={slotUTC:iso(found.timestamp),selectionUTC:iso(time)};showRecord();
  } catch(error) {
    if(controller.signal.aborted || version!==radarGeneration) return;
    radarStatus.textContent=`IPMA radar unavailable: ${error.message}.`+(radarLayers.length ? ' Previous radar retained; see comparison record for its time.' : '');
  }
}

for(const map of maps) map.on('moveend',()=>{
  if(syncing) return;syncing=true;
  for(const other of maps) if(other!==map) other.setView(map.getCenter(),map.getZoom(),{animate:false});
  syncing=false;clearTimeout(moveTimer);if(metadata) moveTimer=setTimeout(loadComparison,500);
});
$('controls').addEventListener('submit',event=>{event.preventDefault();loadComparison();});
$('resolution').addEventListener('change',loadComparison);
$('opacity').addEventListener('input',()=>{
  $('opacityValue').value=$('opacity').value+'%';panels.baseline.overlay?.setOpacity(+$('opacity').value/100);
  for(const renderer of Object.values(renderers)) renderer.setOpacity(+$('opacity').value/100);
});
$('home').addEventListener('click',()=>maps[0].setView([39.2,-9.1],6,{animate:false}));
$('latest').addEventListener('click',()=>initialize());
$('radar').addEventListener('change',()=>{
  if($('radar').checked) {try {loadRadar(selectedTime());} catch(error) {radarStatus.textContent=error.message;}}
  else {radarRequest?.abort();radarGeneration++;for(const layer of radarLayers) layer.remove();radarLayers=[];
    for(const renderer of Object.values(renderers)) renderer.removeImage('skyflow-radar');radarStatus.textContent='';record.radar=null;showRecord();}
});
$('export').addEventListener('click',()=>{
  const url=URL.createObjectURL(new Blob([JSON.stringify({...record,notes:$('notes').value},null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='skyflow-cloud-comparison.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
async function checkProvider() {
  try {
    const response=await fetch('/__lab/status',{cache:'no-store'});
    const status=response.ok ? await response.json() : {};
    $('providerEnabled').disabled=!status.meteomaticsConfigured;
    if(!status.meteomaticsConfigured) {
      $('providerEnabled').checked=false;renderers.provider.removeImage('skyflow-clouds');delete panels.provider.time;
    }
    panels.provider.status.textContent=status.meteomaticsConfigured ? 'Local connection configured. Enable Meteomatics to test satellite access.' :
      'Awaiting access · run the local lab server with Meteomatics satellite credentials to enable this comparison.';
  } catch {$('providerEnabled').disabled=true;panels.provider.status.textContent='Awaiting access · local Meteomatics connection is not running.';}
}
$('providerRetry').addEventListener('click',checkProvider);
$('providerEnabled').addEventListener('change',()=>{
  if(!$('providerEnabled').checked) {renderers.provider.removeImage('skyflow-clouds');delete panels.provider.time;}
  loadComparison();
});
async function initialize() {
  request?.abort();generation++;const controller=new AbortController();request=controller;
  $('overall').textContent='Reading GeoColour availability…';
  try {
    const available=await catalogue(controller.signal);if(controller.signal.aborted) return;metadata=available;
    $('observation').value=iso(commonTime(metadata,Object.values(PRODUCTS))).slice(0,16);await loadComparison();
  } catch(error) {if(!controller.signal.aborted) {$('overall').dataset.state='error';$('overall').textContent='Availability failed; use Latest GeoColour time to retry.';}}
}
window.cloudLab={maps,panels,mapFeatures,renderers,loadComparison,checkProvider,get record(){return record;},get metadata(){return metadata;},registration};
checkProvider();initialize();
