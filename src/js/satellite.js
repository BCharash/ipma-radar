"use strict";

/* Public EUMETView WMS observations, without an API key.
 * Every animation image is requested in EPSG:3857 for its exact overlay bounds.
 * Radar and satellite keep separate timestamps; no future satellite is paired
 * with a historical radar frame. All images are preloaded before playback.
 */
const SATELLITE_WMS_URL = "https://view.eumetsat.int/geoserver/wms";
const SATELLITE_PRODUCTS = {
  visible:{layer:"mtg_fd:vis06_hrfi", label:"Visible (daylight)"},
  infrared:{layer:"msg_fes:ir108", label:"Infrared"},
  hybrid:{layer:"mtg_fd:rgb_geocolour", label:"Hybrid (Geo Colour)"}
};
let satelliteLayer = null;
let satelliteFrames = [];
let currentSatelliteIndex = 0;
let satelliteGeneration = 0;
let satelliteCatalogue = null;
let satelliteCatalogueTime = 0;
let satelliteRequest = null;
let satelliteLoading = false;
let satelliteMissingCount = 0;
let satelliteStepMs = 600000;
let satelliteOpacity = 0.6;
let satelliteMoveTimer = null;
const satelliteScenes = [];

const satelliteSelect = document.getElementById("satelliteSelect");
const satelliteStatus = document.getElementById("satelliteStatus");
const radarToggle = document.getElementById("radarToggle");
const satelliteOpacityControl = document.getElementById("satelliteOpacity");
const radarOpacityControl = document.getElementById("radarOpacity");

function setSatelliteStatus(message, state="loading"){
  satelliteStatus.hidden = !message;
  satelliteStatus.textContent = message;
  satelliteStatus.dataset.state = state;
}

function removeSatelliteLayer(){
  for(const frame of satelliteFrames){
    frame.overlay.remove();
  }
  satelliteFrames = [];
  satelliteLayer = null;
  currentSatelliteIndex = 0;
}

async function getSatelliteCatalogue(signal, force){
  if(!force && satelliteCatalogue && Date.now()-satelliteCatalogueTime < 60000){
    return satelliteCatalogue;
  }

  const response = await fetch(
    SATELLITE_WMS_URL + "?service=WMS&request=GetCapabilities&version=1.3.0",
    {signal, cache:"no-cache", credentials:"omit"}
  );
  if(!response.ok){
    throw new Error("Satellite catalogue HTTP " + response.status);
  }

  const xml = new DOMParser().parseFromString(await response.text(), "application/xml");
  if(xml.getElementsByTagName("parsererror").length){
    throw new Error("Invalid satellite catalogue");
  }

  const catalogue = {};
  const namespace = "http://www.opengis.net/wms";
  for(const layer of xml.getElementsByTagNameNS(namespace, "Layer")){
    // Direct children belong to this layer, rather than a nested product.
    const children = Array.from(layer.children);
    const name = children.find(child => child.localName === "Name");
    const time = children.find(child =>
      child.localName === "Dimension" && child.getAttribute("name") === "time"
    );
    if(name && time){
      const timestamp = time.getAttribute("default");
      if(Number.isFinite(Date.parse(timestamp))){
        const duration = (time.textContent || "").trim().split("/").pop();
        const minutes = /^PT(\d+)M$/.exec(duration);
        catalogue[name.textContent.trim()] = {
          timestamp, stepMs:(minutes ? Number(minutes[1]) : 15)*60000
        };
      }
    }
  }

  if(signal.aborted){
    throw new Error("Satellite request superseded");
  }

  satelliteCatalogue = catalogue;
  satelliteCatalogueTime = Date.now();
  return catalogue;
}

// The request rectangle and Leaflet overlay use the same projected corners.
// Never place an arbitrary satellite JPEG in the IPMA radar rectangle.
function satelliteGeometry(){
  const viewport = map.getBounds();
  const zoom = map.getZoom();
  const reusable = satelliteScenes.find(scene =>
    Math.abs(scene.zoom-zoom) <= 1 && scene.bounds.contains(viewport)
  );
  if(reusable) return reusable;
  const visible = viewport.pad(0.35);
  const crs = L.CRS.EPSG3857;
  const sw = crs.project(L.latLng(Math.max(-70,visible.getSouth()),Math.max(-180,visible.getWest())));
  const ne = crs.project(L.latLng(Math.min(70,visible.getNorth()),Math.min(180,visible.getEast())));
  const grid = 100000/Math.pow(2,Math.max(0,Math.floor((zoom-7)/2)));
  const bbox = [Math.floor(sw.x/grid)*grid,Math.floor(sw.y/grid)*grid,
    Math.ceil(ne.x/grid)*grid,Math.ceil(ne.y/grid)*grid];
  if(bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) throw new Error("Viewport outside satellite coverage");
  const bounds = L.latLngBounds(crs.unproject(L.point(bbox[0],bbox[1])),
    crs.unproject(L.point(bbox[2],bbox[3])));
  const ratio = (bbox[2]-bbox[0])/(bbox[3]-bbox[1]);
  const size = map.getSize().x <= 600 ? 768 : 1024;
  const geometry = {bounds,bbox,zoom,
    width:Math.max(1,Math.round(ratio >= 1 ? size : size*ratio)),
    height:Math.max(1,Math.round(ratio >= 1 ? size/ratio : size))};
  satelliteScenes.unshift(geometry);
  if(satelliteScenes.length > 8) satelliteScenes.pop();
  return geometry;
}

function satelliteImageURL(product, date, geometry){
  const query = new URLSearchParams({
    service:"WMS", version:"1.1.1", request:"GetMap", layers:product.layer,
    styles:"", format:"image/png", transparent:"false", srs:"EPSG:3857",
    bbox:geometry.bbox.join(","), width:String(geometry.width),
    height:String(geometry.height), time:date.toISOString()
  });
  return SATELLITE_WMS_URL + "?" + query;
}

function displaySatelliteFrame(index){
  const frame = satelliteFrames[index];
  for(let i=0; i<satelliteFrames.length; i++){
    satelliteFrames[i].overlay.setOpacity(i === index ? satelliteOpacity : 0);
  }
  satelliteLayer = frame ? frame.overlay : null;
  if(!frame){
    if(!satelliteLoading && SATELLITE_PRODUCTS[satelliteSelect.value]){
      setSatelliteStatus("No matching satellite image for this radar time.", "ready");
    }
    return;
  }
  currentSatelliteIndex = index;
  if(satelliteLoading) return;
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone:"Europe/Lisbon", day:"2-digit", month:"2-digit",
    hour:"2-digit", minute:"2-digit", hour12:false
  }).format(frame.date);
  setSatelliteStatus(SATELLITE_PRODUCTS[frame.product || satelliteSelect.value].label + " · " + time +
    " Lisbon · " + (index+1) + "/" + satelliteFrames.length +
    " · " + satelliteStepMs/60000 + "-min observations" +
    (satelliteMissingCount ? " · " + satelliteMissingCount + " unavailable images skipped" : "") +
    (radarVisible && radarFrames.length &&
      radarFrames[currentFrameIndex].date-frame.date >= satelliteStepMs
      ? " · " + Math.round((radarFrames[currentFrameIndex].date-frame.date)/60000) + " min before radar" : "") +
    (Date.now()-frame.date.getTime() > 90*60000 && index === satelliteFrames.length-1 ? " · older image" : ""), "ready");
}

function syncSatelliteToRadar(){
  if(!satelliteFrames.length) return;
  if(!radarVisible || !radarFrames.length){
    displaySatelliteFrame(currentSatelliteIndex);
    return;
  }
  const time = radarFrames[currentFrameIndex].date.getTime();
  let index = -1;
  for(let i=0; i<satelliteFrames.length; i++){
    if(satelliteFrames[i].date.getTime() <= time) index = i;
  }
  displaySatelliteFrame(index);
}

async function updateSatellite(force=false){
  clearTimeout(satelliteMoveTimer);
  stopPlayback(false);
  const generation = ++satelliteGeneration;
  if(satelliteRequest) satelliteRequest.abort();
  const productKey = satelliteSelect.value;
  const product = SATELLITE_PRODUCTS[productKey];
  satelliteLoading = !!product;
  satelliteOpacityControl.disabled = !product;
  updatePlaybackControls();
  if(!product){
    removeSatelliteLayer();
    setSatelliteStatus("");
    updateFrameCounter();
    return;
  }
  const oldFrames = satelliteFrames;
  const staged = [];
  let committed = false;
  let missing = 0;
  setSatelliteStatus("Loading " + product.label + " history" +
    (oldFrames.length ? " · previous imagery retained…" : "…"));
  const request = new AbortController();
  satelliteRequest = request;
  const timeout = setTimeout(() => request.abort(),15000);
  try{
    const catalogue = await getSatelliteCatalogue(request.signal,force);
    clearTimeout(timeout);
    if(generation !== satelliteGeneration) return;
    const metadata = catalogue[product.layer];
    if(!metadata) throw new Error("No satellite observation metadata");
    const geometry = satelliteGeometry();
    const newest = Date.parse(metadata.timestamp);
    const oldest = newest-Number(historySelect.value)*3600000;
    const dates = [];
    for(let time=newest; time>=oldest; time-=metadata.stepMs) dates.push(new Date(time));
    const load = async date => {
      const image = await loadSatelliteImage(satelliteImageURL(product,date,geometry),request.signal);
      if(generation !== satelliteGeneration || request.signal.aborted) return;
      if(!image){ missing++; return; }
      const overlay = L.imageOverlay(image,geometry.bounds,{
        pane:"satellitePane",opacity:0,interactive:false,
        attribution:'Satellite © <a href="https://www.eumetsat.int/">EUMETSAT</a>'
      }).addTo(map);
      staged.push({date,overlay,geometry,product:productKey});
      staged.sort((a,b) => a.date-b.date);
      const radarTime = radarVisible && radarFrames.length ? radarFrames[currentFrameIndex].date.getTime() : Infinity;
      if(!committed && staged.some(frame => frame.date.getTime() <= radarTime)){
        // Keep the old scene until replacement imagery can actually be shown.
        for(const frame of oldFrames) frame.overlay.remove();
        satelliteFrames = staged;
        satelliteStepMs = metadata.stepMs;
        committed = true;
      }
      if(committed){
        currentSatelliteIndex = satelliteFrames.length-1;
        syncSatelliteToRadar();
      }
      setSatelliteStatus("Loading satellite " + staged.length + "/" + dates.length +
        (oldFrames.length && !committed ? " · previous imagery retained" : "…"));
    };
    // Workers continue as soon as one image finishes; a slow request does not
    // hold up an entire batch. Recent observations are queued first.
    let next = 0;
    await Promise.all(Array.from({length:Math.min(3,dates.length)},async () => {
      while(next < dates.length && !request.signal.aborted){
        await load(dates[next++]);
      }
    }));
    if(generation !== satelliteGeneration) return;
    if(!committed) throw new Error("No replacement satellite imagery at the selected time");
    satelliteLoading = false;
    satelliteMissingCount = missing;
    syncSatelliteToRadar();
  }
  catch(error){
    if(generation === satelliteGeneration){
      console.error("Satellite error:",error);
      setSatelliteStatus(satelliteFrames.length
        ? "Satellite update failed · previous imagery retained. Try Refresh."
        : "Satellite unavailable. Map and radar retained; try Refresh.","error");
    }
  }
  finally{
    clearTimeout(timeout);
    if(!committed) for(const frame of staged) frame.overlay.remove();
    if(generation === satelliteGeneration){
      satelliteLoading = false;
      updatePlaybackControls();
      updateFrameCounter();
    }
    if(satelliteRequest === request) satelliteRequest = null;
  }
}

function refreshSatellite(){ return updateSatellite(true); }

function updatePlaybackControls(){
  const active = radarVisible || !!SATELLITE_PRODUCTS[satelliteSelect.value];
  historySelect.disabled = !active;
  intervalSelect.disabled = !radarVisible;
  for(const control of [previousButton, nextButton, playButton, loopButton]){
    control.disabled = !active || satelliteLoading;
  }
}

function initializeSatellite(){
  map.createPane("satellitePane");
  map.getPane("satellitePane").style.zIndex = 250;
  map.getPane("satellitePane").style.pointerEvents = "none";
  satelliteSelect.addEventListener("change", () => updateSatellite());
  radarToggle.addEventListener("change", () => setRadarVisible(radarToggle.checked));
  satelliteOpacityControl.addEventListener("input", () => {
    satelliteOpacity = Number(satelliteOpacityControl.value)/100;
    document.getElementById("satelliteOpacityValue").value = satelliteOpacityControl.value + "%";
    if(satelliteLayer) satelliteLayer.setOpacity(satelliteOpacity);
  });
  radarOpacityControl.addEventListener("input", () => {
    radarOpacity = Number(radarOpacityControl.value)/100;
    document.getElementById("radarOpacityValue").value = radarOpacityControl.value + "%";
    setVisibleFrame(currentFrameIndex);
  });
  map.on("moveend", () => {
    clearTimeout(satelliteMoveTimer);
    if(!SATELLITE_PRODUCTS[satelliteSelect.value]) return;
    const geometry = satelliteFrames[0] && satelliteFrames[0].geometry;
    if(geometry && Math.abs(geometry.zoom-map.getZoom()) <= 1 && geometry.bounds.contains(map.getBounds())) return;
    stopPlayback(false);
    // The old rectangles remain registered while replacement coverage loads.
    satelliteMoveTimer = setTimeout(() => updateSatellite(), 400);
  });
}
