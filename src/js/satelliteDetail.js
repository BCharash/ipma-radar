"use strict";

/* Keep the overview history through every zoom. Fetch detail only for the
 * displayed observation while paused; never restart an entire animation load.
 */
let satelliteDetailRequest = null;
let satelliteDetailTimer = null;
let satelliteDetailGeneration = 0;

function cancelSatelliteRefinement(){
  clearTimeout(satelliteDetailTimer);
  satelliteDetailGeneration++;
  if(satelliteDetailRequest) satelliteDetailRequest.abort();
  satelliteDetailRequest = null;
}

function queueSatelliteRefinement(){
  cancelSatelliteRefinement();
  if(playing || satelliteLoading || !SATELLITE_PRODUCTS[satelliteSelect.value]) return;
  satelliteDetailTimer = setTimeout(() => refineSatelliteFrame(),400);
}

async function refineSatelliteFrame(){
  if(playing || satelliteLoading || !satelliteLayer) return;
  const frame = satelliteFrames.find(candidate => candidate.overlay === satelliteLayer || candidate.detail?.overlay === satelliteLayer);
  if(!frame || frame.product !== satelliteSelect.value || satelliteStatus.dataset.state === "error") return;
  if(frame.detail && frame.detail.geometry.bounds.contains(map.getBounds()) &&
    Math.abs(frame.detail.geometry.zoom-map.getZoom()) <= 1) return;
  const generation = ++satelliteDetailGeneration;
  if(satelliteDetailRequest) satelliteDetailRequest.abort();
  const request = new AbortController();
  satelliteDetailRequest = request;
  try{
    const geometry = satelliteGeometry();
    const product = SATELLITE_PRODUCTS[frame.product];
    const image = await loadSatelliteImage(satelliteImageURL(product,frame.date,geometry),request.signal);
    if(!image || request.signal.aborted || generation !== satelliteDetailGeneration ||
      !satelliteFrames.includes(frame) || playing) return;
    const overlay = L.imageOverlay(image,geometry.bounds,{
      pane:"satellitePane",opacity:0,interactive:false
    }).addTo(map);
    if(frame.detail) frame.detail.overlay.remove();
    frame.detail = {overlay,geometry};
    syncSatelliteToRadar();
  }
  catch(error){
    // The registered overview remains available if refinement fails.
    console.error("Satellite detail error:",error);
  }
  finally{
    if(satelliteDetailRequest === request) satelliteDetailRequest = null;
  }
}
