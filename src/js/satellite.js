"use strict";

/* Public EUMETView WMS observations, without an API key.
 * Every animation image is requested in EPSG:3857 for its exact overlay bounds.
 * Radar and satellite keep separate timestamps; no future satellite is paired
 * with a historical radar frame. Low-resolution history loads progressively.
 */
const SATELLITE_WMS_URL = "https://view.eumetsat.int/geoserver/wms";
const SATELLITE_PRODUCTS = {
  visible:{layer:"mtg_fd:vis06_hrfi", label:"Visible (daylight)"},
  infrared:{layer:"msg_fes:ir108", label:"Infrared"},
  hybrid:{layer:"mtg_fd:rgb_geocolour", label:"GeoColour"}
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
let satelliteHistoryIncomplete = false;
let satelliteLoadTimings = {};
let satelliteRequestedDates = [];
let satelliteRequestedProduct = null;
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

function satelliteObservationTime(date){
  return new Intl.DateTimeFormat("en-GB",{
    timeZone:"Europe/Lisbon",day:"2-digit",month:"2-digit",
    hour:"2-digit",minute:"2-digit",hour12:false
  }).format(date);
}

function removeSatelliteLayer(){
  for(const frame of satelliteFrames){
    frame.overlay.remove();
    if(frame.detail) frame.detail.overlay.remove();
  }
  satelliteFrames = [];
  satelliteLayer = null;
  currentSatelliteIndex = 0;
}

async function getSatelliteCatalogue(signal, force, layerName){
  if(!force && satelliteCatalogue && satelliteCatalogue[layerName] && Date.now()-satelliteCatalogueTime < 60000){
    return satelliteCatalogue;
  }

  const response = await fetch(
    SATELLITE_WMS_URL + "?service=WMS&request=GetCapabilities&version=1.3.0&namespace=" +
      encodeURIComponent(layerName.split(":")[0]),
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
  const size = map.getSize().x <= 600 ? 512 : 768;
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
  let selected = null;
  for(let i=0; i<satelliteFrames.length; i++){
    const candidate = satelliteFrames[i];
    const detailFits = satelliteQualityActive === "high" && candidate.detail;
    const overlay = detailFits ? candidate.detail.overlay : candidate.overlay;
    candidate.overlay.setOpacity(i === index && !detailFits ? satelliteOpacity : 0);
    if(candidate.detail) candidate.detail.overlay.setOpacity(i === index && detailFits ? satelliteOpacity : 0);
    if(i === index) selected = overlay;
  }
  satelliteLayer = selected;
  updateFrameCounter();
  if(!frame){
    if(!satelliteLoading && SATELLITE_PRODUCTS[satelliteSelect.value]){
      setSatelliteStatus("No matching satellite image for this radar time.","ready");
    }
    return;
  }
  currentSatelliteIndex = index;
  if(satelliteLoading || satelliteDetailRequest || satelliteQualityPending || satelliteCoveragePending) return;
  setSatelliteStatus(SATELLITE_PRODUCTS[frame.product || satelliteSelect.value].label +
    " · " + satelliteStepMs/60000 + "-min observations" +
    (frame.detail && selected === frame.detail.overlay ? " · high resolution" : " · low resolution") +
    (satelliteCoverageMessage ? " · " + satelliteCoverageMessage : "") +
    (satelliteHistoryIncomplete ? " · history incomplete; Refresh to retry" : "") +
    (satelliteMissingCount ? " · " + satelliteMissingCount + " unavailable images skipped" : "") +
    (playbackTime !== null && playbackTime-frame.date.getTime() >= satelliteStepMs
      ? " · " + Math.round((playbackTime-frame.date.getTime())/60000) + " min before timeline" : ""),"ready");
}

function syncSatelliteToRadar(time=playbackTime){
  if(!satelliteFrames.length) return;
  if(time === null && (!radarVisible || !radarFrames.length)){
    displaySatelliteFrame(currentSatelliteIndex);
    return;
  }
  if(time === null) time = radarFrames[currentFrameIndex].date.getTime();
  let index = -1;
  for(let i=0; i<satelliteFrames.length; i++){
    if(playing && !playbackSatelliteTimes.has(satelliteFrames[i].date.getTime())) continue;
    if(satelliteFrames[i].date.getTime() <= time) index = i;
  }
  displaySatelliteFrame(index);
}

async function updateSatellite(force=false,coverageOnly=false){
  const started = performance.now();
  clearTimeout(satelliteMoveTimer);
  const previousLoading=satelliteLoading;
  const previousDates=satelliteRequestedProduct===satelliteSelect.value ? satelliteRequestedDates.slice() : [];
  const queuedDates=satelliteCoveragePending?.product===satelliteSelect.value
    ? satelliteCoveragePending.frames.map(frame=>frame.date) : [];
  cancelSatelliteRefinement();
  discardSatelliteCoverage();
  satelliteCoverageMessage="";
  const generation = ++satelliteGeneration;
  if(satelliteRequest) satelliteRequest.abort();
  const productKey = satelliteSelect.value;
  const product = SATELLITE_PRODUCTS[productKey];
  setGeoColourMapEnabled(productKey === "hybrid");
  if(satelliteFrames.some(frame => frame.product !== productKey)) stopPlayback(false);
  satelliteLoading = !!product;
  satelliteOpacityControl.disabled = !product;
  updatePlaybackControls();
  satelliteQualitySelect.disabled = !product;
  if(!product){
    if(playing && playbackSource === "satellite") stopPlayback(false);
    removeSatelliteLayer();
    setSatelliteStatus("");
    updateFrameCounter();
    return;
  }
  const oldFrames = satelliteFrames;
  const timings = {};
  satelliteLoadTimings = timings;
  const staged = [];
  let committed = false;
  let atomicCoverage = false;
  let handedOff = false;
  const missingTimes = new Set();
  setSatelliteStatus("Loading " + product.label + " history" +
    (oldFrames.length ? " · previous imagery retained…" : "…"));
  const request = new AbortController();
  satelliteRequest = request;
  const timeout = setTimeout(() => request.abort(),15000);
  const historyTimeout = setTimeout(() => request.abort(),60000);
  try{
    const catalogue = await getSatelliteCatalogue(request.signal,force,product.layer);
    timings.catalogueMs = performance.now()-started;
    clearTimeout(timeout);
    if(generation !== satelliteGeneration) return;
    const metadata = catalogue[product.layer];
    if(!metadata) throw new Error("No satellite observation metadata");
    const detailGeometry = satelliteGeometry();
    const scale = 256/Math.max(detailGeometry.width,detailGeometry.height);
    const geometry = {...detailGeometry,
      width:Math.max(1,Math.round(detailGeometry.width*scale)),
      height:Math.max(1,Math.round(detailGeometry.height*scale))};
    atomicCoverage=oldFrames.length>0 && oldFrames.every(frame=>frame.product===productKey) &&
      oldFrames.some(frame=>frame.geometry.bbox.join()!==geometry.bbox.join());
    if(!atomicCoverage){satelliteQualityActive="low";syncSatelliteToRadar();}
    const newest = Date.parse(metadata.timestamp);
    const oldest = newest-Number(historySelect.value)*3600000;
    const dates = [];
    if(atomicCoverage && coverageOnly){
      // Reframe the same observations: zooming must not refresh the clock.
      const roster=queuedDates.length ? queuedDates : previousLoading && previousDates.length
        ? previousDates : oldFrames.map(frame=>frame.date);
      dates.push(...roster.sort((a,b)=>b-a));
    }
    else for(let time=newest; time>=oldest; time-=metadata.stepMs) dates.push(new Date(time));
    satelliteRequestedDates=dates.slice();satelliteRequestedProduct=productKey;
    const load = async (date, renderGeometry=geometry, preview=false, timeoutMs=20000) => {
      const image = await loadSatelliteImage(satelliteImageURL(product,date,renderGeometry),request.signal,timeoutMs);
      if(generation !== satelliteGeneration || request.signal.aborted) return;
      if(!image){ missingTimes.add(date.getTime()); return; }
      missingTimes.delete(date.getTime());
      const overlay = L.imageOverlay(image,renderGeometry.bounds,{
        pane:"satellitePane",opacity:0,interactive:false,
        attribution:'Satellite © <a href="https://www.eumetsat.int/">EUMETSAT</a>'
      }).addTo(map);
      const selectedTime = satelliteFrames[currentSatelliteIndex]?.date.getTime();
      staged.push({date,overlay,geometry:renderGeometry,product:productKey,preview:true});
      staged.sort((a,b) => a.date-b.date);
      if(atomicCoverage){
        setSatelliteStatus("Loading expanded view " + staged.length + "/" + dates.length +
          " · current movie retained…");
        return;
      }
      const sameProduct = !satelliteFrames.length || satelliteFrames[0].product === productKey;
      const clock = playbackTime ?? Infinity;
      if(sameProduct || staged.some(frame => frame.date.getTime() <= clock)){
        if(!committed){
          if(!sameProduct){
            for(const frame of oldFrames){ frame.overlay.remove(); frame.detail?.overlay.remove(); }
            satelliteFrames = [];
          }
          satelliteStepMs = metadata.stepMs;
          satelliteHistoryIncomplete = false;
          committed = true;
          timings.firstImageMs = performance.now()-started;
        }
        // Replace only this observation. Older coverage remains until its own
        // same-time image arrives, so a pan never clears the running movie.
        for(const incoming of staged.filter(frame => !satelliteFrames.includes(frame))){
          const existing = satelliteFrames.findIndex(frame => +frame.date === +incoming.date);
          if(existing >= 0){
            satelliteFrames[existing].overlay.remove();
            satelliteFrames[existing].detail?.overlay.remove();
            satelliteFrames.splice(existing,1);
          }
          satelliteFrames.push(incoming);
        }
        satelliteFrames.sort((a,b) => a.date-b.date);
        const preserved = satelliteFrames.findIndex(frame => +frame.date === selectedTime);
        currentSatelliteIndex = preserved >= 0 ? preserved : satelliteFrames.length-1;
        syncSatelliteToRadar();
        updatePlaybackControls();
      }
      const shown = satelliteFrames.find(frame => frame.overlay === satelliteLayer);
      setSatelliteStatus((committed && shown
        ? (shown.preview ? "Preview " : "Satellite ") + satelliteObservationTime(shown.date) + " Lisbon · "
        : "") + "Loading animation " + staged.length + "/" + dates.length +
        (oldFrames.length && !committed ? " · previous imagery retained" : "…"));
    };
    // Request newest to oldest. Two workers let an earlier image recover
    // from a slow or unavailable latest observation.
    let next = 0;
    await Promise.all(Array.from({length:Math.min(2,dates.length)},async () => {
      while(next < dates.length && !request.signal.aborted){
        const date = dates[next++];
        await load(date,geometry,true,15000);
      }
    }));
    if(generation !== satelliteGeneration) return;
    if(atomicCoverage){
      if(request.signal.aborted || missingTimes.size || staged.length!==dates.length)
        throw new Error("Expanded coverage is incomplete");
      satelliteLoading=false;
      satelliteCoveragePending={generation,product:productKey,frames:staged,stepMs:metadata.stepMs};
      handedOff=true;
      timings.historyMs=performance.now()-started;
      setSatelliteStatus(playing ? "Expanded view ready · switching after this pass…" : "Expanded view ready…");
      if(!playing) commitSatelliteCoverage();
      return;
    }
    if(!committed) throw new Error("No replacement satellite imagery at the selected time");
    const wanted = new Set(dates.map(date => +date));
    satelliteFrames = satelliteFrames.filter(frame => {
      if(wanted.has(+frame.date)) return true;
      frame.overlay.remove(); frame.detail?.overlay.remove(); return false;
    });
    satelliteLoading = false;
    satelliteMissingCount = missingTimes.size;
    satelliteHistoryIncomplete = request.signal.aborted;
    timings.historyMs = performance.now()-started;
    syncSatelliteToRadar();
  }
  catch(error){
    if(generation === satelliteGeneration){
      console.error("Satellite error:",error);
      if(atomicCoverage) satelliteCoverageMessage="expanded view incomplete; previous coverage retained · Refresh to retry";
      setSatelliteStatus(atomicCoverage ? "Expanded view incomplete · previous coverage retained. Refresh to retry." : satelliteFrames.length
        ? "Satellite update failed · previous imagery retained. Try Refresh."
        : "Satellite unavailable. Map and radar retained; try Refresh.","error");
    }
  }
  finally{
    clearTimeout(timeout);
    clearTimeout(historyTimeout);
    if(!committed && !handedOff) for(const frame of staged) frame.overlay.remove();
    if(generation === satelliteGeneration){
      satelliteLoading = false;
      updatePlaybackControls();
      updateFrameCounter();
      queueSatelliteRefinement();
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
    if(control === playButton && playing){ control.disabled = false; continue; }
    control.disabled = !active || (satelliteLoading && satelliteFrames.length < 2) ||
      availablePlaybackFrames().length < (control === playButton ? 2 : 1);
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
  satelliteQualitySelect.addEventListener("change", () => {
    if(satelliteQualitySelect.value === "low"){
      satelliteQualityActive = "low";
      satelliteQualityPending = false;
      syncSatelliteToRadar();
    }
    queueSatelliteRefinement();
  });
  map.on("moveend", () => {
    syncSatelliteToRadar();
    clearTimeout(satelliteMoveTimer);
    satelliteMoveTimer = setTimeout(() => {
      if(!SATELLITE_PRODUCTS[satelliteSelect.value]) return;
      const geometry = satelliteGeometry();
      const uncovered = !satelliteFrames.length || satelliteFrames.some(frame =>
        frame.geometry.bbox.join() !== geometry.bbox.join());
      if(uncovered) updateSatellite(false,true);
      else queueSatelliteRefinement();
    },350);
  });
}
