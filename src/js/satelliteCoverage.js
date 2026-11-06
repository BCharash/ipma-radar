"use strict";

/* A viewport change stages a complete movie with matching UTC slots. Never
 * alternate old narrow rectangles and expanded images within one play-through.
 */
let satelliteCoveragePending = null;
let satelliteCoverageMessage = "";

function discardSatelliteCoverage(){
  if(satelliteCoveragePending){
    for(const frame of satelliteCoveragePending.frames){
      frame.overlay.remove();frame.detail?.overlay.remove();
    }
  }
  satelliteCoveragePending=null;
}

function commitSatelliteCoverage(){
  const pending=satelliteCoveragePending;
  if(!pending || satelliteLoading) return false;
  if(pending.generation!==satelliteGeneration || pending.product!==satelliteSelect.value){
    discardSatelliteCoverage();return false;
  }
  const selectedTime=satelliteFrames[currentSatelliteIndex]?.date.getTime();
  const previous=satelliteFrames;
  satelliteFrames=pending.frames;
  satelliteCoveragePending=null;satelliteCoverageMessage="";
  satelliteQualityActive="low";
  satelliteStepMs=pending.stepMs;
  satelliteMissingCount=0;satelliteHistoryIncomplete=false;
  const selected=satelliteFrames.findIndex(frame=>frame.date.getTime()===selectedTime);
  currentSatelliteIndex=selected>=0 ? selected : satelliteFrames.length-1;
  for(const frame of previous){frame.overlay.remove();frame.detail?.overlay.remove();}
  syncSatelliteToRadar();updatePlaybackControls();updateFrameCounter();
  queueSatelliteRefinement();
  return true;
}
