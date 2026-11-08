"use strict";

/* Snapshot observation times for a play-through. New low-resolution frames and
 * higher-detail replacements can arrive without changing the running clock.
 */
const PLAYBACK_DELAY = 180;
let playing = false;
let looping = false;
let playbackTimer = null;
let playbackView = null;
let playbackTimeline = [];
let playbackCursor = 0;
let playbackTime = null;
let playbackSatelliteTimes = new Set();

// Build from successfully loaded observations, not the catalogue's expected
// slots: missing downloads must not create empty steps or hide another source.
function availablePlaybackTimes(){
  const frames = [];
  if(radarVisible) frames.push(...radarFrames);
  if(SATELLITE_PRODUCTS[satelliteSelect.value]) frames.push(...satelliteFrames);
  return [...new Set(frames.map(frame => frame.date.getTime()))].sort((a,b) => a-b);
}

function displayPlaybackTime(time){
  playbackTime = time;
  let index = -1;
  for(let i=0;i<radarFrames.length;i++){
    if(radarFrames[i].date.getTime() <= time) index = i;
  }
  if(index >= 0) setVisibleFrame(index,false);
  else{
    radarFrameAvailable = false;
    for(const overlay of radarOverlays) overlay.setOpacity(0);
  }
  syncSatelliteToRadar(time);
  updateFrameCounter();
}

function stopPlayback(restoreView=true){
  if(playbackTimer !== null){
    clearTimeout(playbackTimer);
    playbackTimer = null;
  }
  if(playing) setPlayingUI(false);
  playbackTimeline = [];
  playbackCursor = 0;
  if(restoreView && playbackView && (
    map.getZoom() !== playbackView.zoom || map.getCenter().distanceTo(playbackView.center) > 0.1
  )){
    map.setView(playbackView.center,playbackView.zoom,{animate:false});
  }
  playbackView = null;
  commitSatelliteCoverage();
  commitSatelliteQuality();
}

function startPlayback(){
  if(playing) return;
  const times = availablePlaybackTimes();
  if(times.length < 2) return;
  playbackView = {center:map.getCenter(),zoom:map.getZoom()};
  playbackTimeline = times;
  playbackSatelliteTimes = new Set(satelliteFrames.map(frame => frame.date.getTime()));
  playbackCursor = 0;
  setPlayingUI(true);
  displayPlaybackTime(playbackTimeline[0]);
  scheduleNextFrame();
}

function scheduleNextFrame(){
  if(!playing) return;
  playbackTimer = setTimeout(() => {
    if(!playing) return;
    playbackCursor++;
    if(playbackCursor >= playbackTimeline.length){
      const availableTimes = availablePlaybackTimes();
      const historyExtended = availableTimes.some(time => !playbackTimeline.includes(time)) ||
        (!!SATELLITE_PRODUCTS[satelliteSelect.value] && satelliteFrames.some(frame =>
          !playbackSatelliteTimes.has(+frame.date)));
      // Initial history may grow while it loads. Reframing the same observations
      // or preparing High is a replacement, and must respect the Loop control.
      const historyGrowing = !!SATELLITE_PRODUCTS[satelliteSelect.value] && satelliteLoading && satelliteRequestedDates.some(date =>
        !satelliteFrames.some(frame => +frame.date === +date));
      if(looping || historyGrowing || historyExtended){
        commitSatelliteCoverage();
        commitSatelliteQuality();
        playbackTimeline = availablePlaybackTimes();
        playbackSatelliteTimes = new Set(satelliteFrames.map(frame => frame.date.getTime()));
        playbackCursor = 0;
        if(!playbackTimeline.length){ stopPlayback(false); return; }
      }
      else{
        stopPlayback(false);
        queueSatelliteRefinement();
        return;
      }
    }
    displayPlaybackTime(playbackTimeline[playbackCursor]);
    scheduleNextFrame();
  },PLAYBACK_DELAY);
}

function stepPlayback(direction){
  stopPlayback(false);
  const times = availablePlaybackTimes();
  if(!times.length) return;
  const time = playbackTime ?? (radarVisible && radarFrames.length
    ? +radarFrames[currentFrameIndex].date
    : +satelliteFrames[currentSatelliteIndex].date);
  const next = direction > 0 ? times.find(value => value > time)
    : times.slice().reverse().find(value => value < time);
  displayPlaybackTime(next ?? (direction > 0 ? times[0] : times[times.length-1]));
  queueSatelliteRefinement();
}

function showPreviousFrame(){ stepPlayback(-1); }
function showNextFrame(){ stepPlayback(1); }
