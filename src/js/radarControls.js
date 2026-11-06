"use strict";

/*
 * radarControls.js
 * Own control elements, status/time display, and playback/threshold presentation.
 */

let minimumRainThreshold =
  Number(
    localStorage.getItem(
      "ipmaRadarMinimumRain"
    ) || "0.1"
  );

const historySelect =
  document.getElementById(
    "historySelect"
  );

const intervalSelect =
  document.getElementById(
    "intervalSelect"
  );

const thresholdSelect =
  document.getElementById(
    "thresholdSelect"
  );

const refreshButton =
  document.getElementById(
    "refreshButton"
  );

const previousButton =
  document.getElementById(
    "previousButton"
  );

const playButton =
  document.getElementById(
    "playButton"
  );

const loopButton =
  document.getElementById(
    "loopButton"
  );

const nextButton =
  document.getElementById(
    "nextButton"
  );

const playIcon =
  document.getElementById(
    "playIcon"
  );

const pauseIcon =
  document.getElementById(
    "pauseIcon"
  );

const statusElement =
  document.getElementById(
    "status"
  );

const frameCounter =
  document.getElementById(
    "frameCounter"
  );


function showStatus(message){
  statusElement.textContent = message;
  statusElement.style.display = "block";
}


function hideStatus(){
  statusElement.style.display = "none";
}


function updateFrameCounter(){

  if(!radarFrames.length){
    frameCounter.style.display = "none";
    return;
  }

  const frame =
    radarFrames[currentFrameIndex];

  const localTime =
    new Intl.DateTimeFormat(
      "en-GB",
      {
        timeZone:"Europe/Lisbon",
        hour:"2-digit",
        minute:"2-digit",
        hour12:false
      }
    ).format(frame.date);

  frameCounter.textContent =
    "Image " +
    (currentFrameIndex + 1) +
    " of " +
    radarFrames.length +
    " · " +
    localTime;

  frameCounter.style.display = "block";
}


function initializeMinimumRainThreshold(){

  const allowed =
    [0.1,0.5];

  if(!allowed.includes(
    minimumRainThreshold
  )){
    minimumRainThreshold = 0.1;
  }

  thresholdSelect.value =
    String(minimumRainThreshold);
}


function setLoopUI(value){

  looping = value;

  loopButton.classList.toggle(
    "loop-active",
    value
  );

  loopButton.title =
    value
      ? "Loop on"
      : "Loop off";

  loopButton.setAttribute(
    "aria-label",
    value
      ? "Loop playback on"
      : "Loop playback off"
  );
}


function setPlayingUI(value){

  playing = value;

  playIcon.style.display =
    value
      ? "none"
      : "block";

  pauseIcon.style.display =
    value
      ? "block"
      : "none";

  playButton.title =
    value
      ? "Pause"
      : "Play";

  playButton.setAttribute(
    "aria-label",
    value
      ? "Pause radar animation"
      : "Play radar animation"
  );
}
