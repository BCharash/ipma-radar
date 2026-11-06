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

function playbackFrames(){ return radarVisible ? radarFrames : satelliteFrames; }
function playbackIndex(){ return radarVisible ? currentFrameIndex : currentSatelliteIndex; }

function availablePlaybackFrames(){
  const frames = playbackFrames();
  if(radarVisible && satelliteLoading && satelliteFrames.length){
    return frames.filter(frame => frame.date.getTime() >= satelliteFrames[0].date.getTime());
  }
  return frames;
}

function displayPlaybackFrame(index){
  if(radarVisible) setVisibleFrame(index);
  else{
    displaySatelliteFrame(index);
    updateFrameCounter();
  }
  if(!playing) queueSatelliteRefinement();
}

function displayPlaybackTime(time){
  const index = playbackFrames().findIndex(frame => frame.date.getTime() === time);
  if(index < 0){ stopPlayback(false); return; }
  displayPlaybackFrame(index);
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
  playbackView = {center:map.getCenter(),zoom:map.getZoom()};
  playbackTimeline = frames.map(frame => frame.date.getTime());
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
        playbackCursor = 0;
      }
      else{
        stopPlayback(true);
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
