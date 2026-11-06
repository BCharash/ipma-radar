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
let playbackSource = "radar";
let playbackTime = null;
let playbackSatelliteTimes = new Set();

function playbackFrames(){ return (playing ? playbackSource === "radar" : radarVisible) ? radarFrames : satelliteFrames; }
function playbackIndex(){ return (playing ? playbackSource === "radar" : radarVisible) ? currentFrameIndex : currentSatelliteIndex; }

function availablePlaybackFrames(){
  const frames = playbackFrames();
  if((playing ? playbackSource === "radar" : radarVisible) && satelliteLoading && satelliteFrames.length){
    return frames.filter(frame => frame.date.getTime() >= satelliteFrames[0].date.getTime());
  }
  return frames;
}

function displayPlaybackFrame(index){
  const frame = playbackFrames()[index];
  if(frame) displayPlaybackTime(frame.date.getTime());
  if(!playing) queueSatelliteRefinement();
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
}

function startPlayback(){
  if(playing || (satelliteLoading && satelliteFrames.length < 2)) return;
  const frames = availablePlaybackFrames();
  if(frames.length < 2) return;
  cancelSatelliteRefinement();
  playbackSource = radarVisible ? "radar" : "satellite";
  playbackView = {center:map.getCenter(),zoom:map.getZoom()};
  playbackTimeline = frames.map(frame => frame.date.getTime());
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
      if(looping){
        playbackTimeline = availablePlaybackFrames().map(frame => frame.date.getTime());
        playbackSatelliteTimes = new Set(satelliteFrames.map(frame => frame.date.getTime()));
        playbackCursor = 0;
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

function showPreviousFrame(){
  stopPlayback(false);
  const count = playbackFrames().length;
  if(count) displayPlaybackFrame((playbackIndex()-1+count)%count);
}

function showNextFrame(){
  stopPlayback(false);
  const count = playbackFrames().length;
  if(count) displayPlaybackFrame((playbackIndex()+1)%count);
}
