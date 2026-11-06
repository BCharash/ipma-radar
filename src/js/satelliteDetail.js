"use strict";

/* Stage one complete high-resolution movie; commit only between play-throughs.
 * Low and High use identical observation times and projected request bounds.
 * Source PNGs for both resolutions share the persistent satellite cache.
 */
const satelliteQualitySelect = document.getElementById("satelliteQuality");
let satelliteQualityActive = "low";
let satelliteQualityPending = false;
let satelliteDetailRequest = null;
let satelliteDetailTimer = null;
let satelliteDetailGeneration = 0;

function cancelSatelliteRefinement(){
  clearTimeout(satelliteDetailTimer);
  satelliteDetailGeneration++;
  satelliteDetailRequest?.abort();
  satelliteDetailRequest = null;
  satelliteQualityPending = false;
}

function commitSatelliteQuality(){
  if(!satelliteQualityPending || satelliteQualitySelect.value !== "high") return;
  if(!satelliteFrames.length || !satelliteFrames.every(frame => frame.detail)) return;
  satelliteQualityActive = "high";
  satelliteQualityPending = false;
  syncSatelliteToRadar();
}

function queueSatelliteRefinement(){
  clearTimeout(satelliteDetailTimer);
  if(satelliteLoading || satelliteCoveragePending || satelliteCoverageMessage || satelliteDetailRequest || satelliteQualitySelect.value !== "high" ||
    !SATELLITE_PRODUCTS[satelliteSelect.value] ||
    satelliteFrames.some(frame => frame.product !== satelliteSelect.value)) return;
  satelliteDetailTimer = setTimeout(() => refineSatelliteFrame(),400);
}

async function refineSatelliteFrame(){
  if(satelliteLoading || satelliteCoveragePending || satelliteCoverageMessage || satelliteDetailRequest || satelliteQualitySelect.value !== "high" ||
    !satelliteFrames.length) return;
  const generation = satelliteDetailGeneration;
  const frames = satelliteFrames.slice();
  const geometry = satelliteGeometry();
  const request = new AbortController();
  satelliteDetailRequest = request;
  let completed = 0;
  let next = frames.length-1;
  try{
    await Promise.all(Array.from({length:Math.min(2,frames.length)},async () => {
      while(next >= 0 && !request.signal.aborted){
        const frame = frames[next--];
        if(!frame.detail || frame.detail.geometry.bbox.join() !== geometry.bbox.join()){
          const image = await loadSatelliteImage(satelliteImageURL(
            SATELLITE_PRODUCTS[frame.product],frame.date,geometry),request.signal);
          if(request.signal.aborted || generation !== satelliteDetailGeneration) return;
          if(!image) continue;
          frame.detail?.overlay.remove();
          frame.detail = {geometry,overlay:L.imageOverlay(image,geometry.bounds,{
            pane:"satellitePane",opacity:0,interactive:false
          }).addTo(map)};
        }
        completed++;
        setSatelliteStatus("High resolution " + completed + "/" + frames.length +
          " · low-resolution playback retained…");
      }
    }));
    if(request.signal.aborted || generation !== satelliteDetailGeneration) return;
    const complete = frames.length === satelliteFrames.length && frames.every(frame =>
      satelliteFrames.includes(frame) && frame.detail &&
      frame.detail.geometry.bbox.join() === geometry.bbox.join());
    satelliteQualityPending = complete && satelliteQualitySelect.value === "high";
    if(complete && satelliteQualitySelect.value === "high"){
      if(playing) setSatelliteStatus("High resolution ready · switching at next loop…");
    }
    else if(!complete && satelliteQualitySelect.value === "high") setSatelliteStatus("High resolution incomplete · low resolution retained; select High to retry.","error");
  }
  finally{
    if(satelliteDetailRequest === request) satelliteDetailRequest = null;
    if(!playing) commitSatelliteQuality();
    if(satelliteQualitySelect.value === "low") syncSatelliteToRadar();
  }
}
