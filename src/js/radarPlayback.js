"use strict";

/* Shared playback controls: radar drives the clock when visible; otherwise
 * satellite observations drive it. Satellite frames are never future-matched.
 */
const PLAYBACK_DELAY = 180;
let playing = false;
let looping = false;
let playbackTimer = null;
let playbackView = null;

function playbackFrames(){
  return radarVisible ? radarFrames : satelliteFrames;
}

function playbackIndex(){
  return radarVisible ? currentFrameIndex : currentSatelliteIndex;
}

function displayPlaybackFrame(index){
  if(radarVisible){
    setVisibleFrame(index);
  }
  else{
    displaySatelliteFrame(index);
    updateFrameCounter();
  }
}

function stopPlayback(restoreView=true){
  if(playbackTimer !== null){
    clearTimeout(playbackTimer);
    playbackTimer = null;
  }
  if(playing) setPlayingUI(false);
  if(restoreView && playbackView && (
    map.getZoom() !== playbackView.zoom ||
    map.getCenter().distanceTo(playbackView.center) > 0.1
  )){
    map.setView(playbackView.center, playbackView.zoom, {animate:false});
  }
  playbackView = null;
}

function startPlayback(){
  if(playbackFrames().length < 2 || playing || satelliteLoading) return;
  playbackView = {center:map.getCenter(), zoom:map.getZoom()};
  displayPlaybackFrame(0);
  setPlayingUI(true);
  scheduleNextFrame();
}

function scheduleNextFrame(){
  if(!playing) return;
  playbackTimer = setTimeout(() => {
    if(!playing) return;
    const next = playbackIndex()+1;
    if(next >= playbackFrames().length){
      if(looping){
        displayPlaybackFrame(0);
        scheduleNextFrame();
      }
      else{
        displayPlaybackFrame(playbackFrames().length-1);
        stopPlayback(true);
      }
      return;
    }
    displayPlaybackFrame(next);
    scheduleNextFrame();
  }, PLAYBACK_DELAY);
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
