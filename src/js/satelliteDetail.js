"use strict";

/* Stage a movie with High where available and Low fallbacks; commit between passes.
 * Low and High use identical observation times and projected request bounds.
 * Source PNGs for both resolutions share the persistent satellite cache.
 */
// High is automatic after Low history; a future data-saving setting can disable it.
let satelliteHighEnabled = true;
let satelliteQualityActive = "low";
let satelliteQualityPending = false;
let satelliteDetailRequest = null;
let satelliteDetailTimer = null;
let satelliteDetailGeneration = 0;
let satelliteDetailPrepared = null;
let satelliteHighProgress = null;
const satelliteHighRetry = document.getElementById("satelliteHighRetry");

function discardSatelliteDetails(){
  if(satelliteDetailPrepared){
    for(const [frame,detail] of satelliteDetailPrepared.details){
      if(frame.detail !== detail) detail.overlay.remove();
    }
  }
  satelliteDetailPrepared = null;
}

function cancelSatelliteRefinement(){
  clearTimeout(satelliteDetailTimer);
  satelliteDetailTimer=null;
  satelliteDetailGeneration++;
  satelliteDetailRequest?.abort();
  satelliteDetailRequest = null;
  satelliteQualityPending = false;
  discardSatelliteDetails();
  satelliteHighProgress = null;
}

function commitSatelliteQuality(){
  if(satelliteDetailRequest) return;
  if(!satelliteQualityPending || !satelliteHighEnabled) return;
  if(!satelliteFrames.length) return;
  if(satelliteDetailPrepared){
    const prepared=satelliteDetailPrepared;
    if(prepared.frames.length!==satelliteFrames.length ||
      !prepared.frames.every(frame=>satelliteFrames.includes(frame))) return;
    for(const frame of prepared.frames){
      const detail=prepared.details.get(frame);
      if(frame.detail !== detail) frame.detail?.overlay.remove();
      if(detail) frame.detail=detail;
      else delete frame.detail;
    }
    satelliteDetailPrepared=null;
  }
  satelliteQualityActive = "high";
  satelliteQualityPending = false;
  syncSatelliteToRadar();
}

function queueSatelliteRefinement(force=false){
  clearTimeout(satelliteDetailTimer);
  satelliteDetailTimer=null;
  if(satelliteLoading || satelliteCoveragePending || satelliteCoverageMessage || satelliteDetailRequest || !satelliteHighEnabled ||
    !SATELLITE_PRODUCTS[satelliteSelect.value] ||
    satelliteFrames.some(frame => frame.product !== satelliteSelect.value)) return;
  if(!force && satelliteHighProgress?.finished &&
    satelliteHighProgress.frames.length===satelliteFrames.length &&
    satelliteHighProgress.frames.every(frame=>satelliteFrames.includes(frame))) return;
  if(force){
    const geometry=satelliteGeometry();
    for(const frame of satelliteFrames){
      if(!frame.detail || frame.detail.geometry.bbox.join()!==geometry.bbox.join())
        satelliteFailedUntil.delete(satelliteImageURL(SATELLITE_PRODUCTS[frame.product],frame.date,geometry));
    }
  }
  satelliteDetailTimer = setTimeout(() => {satelliteDetailTimer=null;refineSatelliteFrame();},400);
}

async function refineSatelliteFrame(){
  if(satelliteLoading || satelliteCoveragePending || satelliteCoverageMessage || satelliteDetailRequest || !satelliteHighEnabled ||
    !satelliteFrames.length) return;
  discardSatelliteDetails();
  satelliteQualityPending=false;
  const generation = satelliteDetailGeneration;
  const frames = satelliteFrames.slice();
  const geometry = satelliteGeometry();
  const request = new AbortController();
  satelliteDetailRequest = request;
  const details = new Map();
  satelliteDetailPrepared={frames,details};
  satelliteHighProgress={frames,processed:0,ready:0,finished:false};
  updateFrameCounter();
  let completed = 0;
  let next = frames.length-1;
  try{
    await Promise.all(Array.from({length:Math.min(SATELLITE_CONCURRENT_REQUESTS,frames.length)},async () => {
      while(next >= 0 && !request.signal.aborted){
        const frame = frames[next--];
        let detail=frame.detail;
        if(!detail || detail.geometry.bbox.join() !== geometry.bbox.join()){
          const image = await loadSatelliteImage(satelliteImageURL(
            SATELLITE_PRODUCTS[frame.product],frame.date,geometry),request.signal);
          if(request.signal.aborted || generation !== satelliteDetailGeneration) return;
          detail = image ? {geometry,overlay:L.imageOverlay(image,geometry.bounds,{
            pane:"satellitePane",opacity:0,interactive:false
          }).addTo(map)} : null;
        }
        if(detail) details.set(frame,detail);
        completed++;
        satelliteHighProgress.processed=completed;
        satelliteHighProgress.ready=details.size;
        updateFrameCounter();
        setSatelliteStatus("High " + completed + "/" + frames.length +
          " processed · " + details.size + " ready · current playback retained…");
      }
    }));
    if(request.signal.aborted || generation !== satelliteDetailGeneration) return;
    const complete = frames.length === satelliteFrames.length && frames.every(frame =>
      satelliteFrames.includes(frame));
    satelliteQualityPending = complete && satelliteHighEnabled;
    satelliteHighProgress.finished=true;
    if(satelliteQualityPending && playing)
      setSatelliteStatus("High ready " + details.size + "/" + frames.length +
        " · " + (frames.length-details.size) + " Low fallbacks · switching after this pass…");
  }
  finally{
    if(satelliteDetailRequest === request) satelliteDetailRequest = null;
    if(generation === satelliteDetailGeneration && !request.signal.aborted && !playing) commitSatelliteQuality();
    if(!satelliteHighEnabled) syncSatelliteToRadar();
    updateFrameCounter();
  }
}

satelliteHighRetry.addEventListener("click",()=>queueSatelliteRefinement(true));
