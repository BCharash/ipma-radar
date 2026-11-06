"use strict";

/*
 * radarPlayback.js
 * Own animation timers, looping state, frame stepping, and map-view restoration.
 */

const PLAYBACK_DELAY = 180;

let playing = false;

let looping = false;

let playbackTimer = null;

let playbackView = null;


function stopPlayback(
  restoreView=true
){

  if(
    playbackTimer !== null
  ){

    clearTimeout(
      playbackTimer
    );

    playbackTimer = null;
  }

  if(playing){
    setPlayingUI(false);
  }

  if(
    restoreView &&
    playbackView
  ){

    map.setView(
      playbackView.center,
      playbackView.zoom,
      {
        animate:false
      }
    );
  }

  playbackView = null;
}


function startPlayback(){

  if(
    radarFrames.length<2 ||
    playing
  ){
    return;
  }

  playbackView = {
    center:map.getCenter(),
    zoom:map.getZoom()
  };

  currentFrameIndex = 0;

  setVisibleFrame(
    currentFrameIndex
  );

  setPlayingUI(true);

  scheduleNextFrame();
}


function scheduleNextFrame(){

  if(!playing){
    return;
  }

  playbackTimer =
    setTimeout(
      () => {

        if(!playing){
          return;
        }

        const nextIndex =
          currentFrameIndex+1;

        if(
          nextIndex >=
          radarFrames.length
        ){

          if(looping){

            currentFrameIndex = 0;

            setVisibleFrame(
              currentFrameIndex
            );

            scheduleNextFrame();

            return;
          }

          currentFrameIndex =
            radarFrames.length-1;

          setVisibleFrame(
            currentFrameIndex
          );

          stopPlayback(true);

          return;
        }

        setVisibleFrame(
          nextIndex
        );

        scheduleNextFrame();

      },
      PLAYBACK_DELAY
    );
}


function showPreviousFrame(){

  stopPlayback(false);

  if(!radarFrames.length){
    return;
  }

  let index =
    currentFrameIndex-1;

  if(index<0){
    index =
      radarFrames.length-1;
  }

  setVisibleFrame(index);
}


function showNextFrame(){

  stopPlayback(false);

  if(!radarFrames.length){
    return;
  }

  let index =
    currentFrameIndex+1;

  if(
    index>=radarFrames.length
  ){
    index = 0;
  }

  setVisibleFrame(index);
}
