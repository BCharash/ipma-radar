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
  const radarReadout = document.getElementById("radarFrameCounter");
  const satelliteReadout = document.getElementById("satelliteFrameCounter");
  const clock = date => new Intl.DateTimeFormat("en-GB",{
    timeZone:"Europe/Lisbon",hour:"2-digit",minute:"2-digit",hour12:false
  }).format(date);
  radarReadout.hidden = !radarVisible || !radarFrames.length;
  if(!radarReadout.hidden){
    radarReadout.textContent = "Radar " + (radarFrameAvailable ? currentFrameIndex+1 : "—") + "/" + radarFrames.length +
      (radarFrameAvailable ? " · " + clock(radarFrames[currentFrameIndex].date) : "");
  }
  satelliteReadout.hidden = !SATELLITE_PRODUCTS[satelliteSelect.value] || !satelliteFrames.length;
  if(!satelliteReadout.hidden){
    const index = satelliteFrames.findIndex(frame => frame.overlay === satelliteLayer || frame.detail?.overlay === satelliteLayer);
    satelliteReadout.textContent = "Satellite " + (index < 0 ? "—" : index+1) + "/" + satelliteFrames.length +
      (index < 0 ? "" : " · " + clock(satelliteFrames[index].date));
  }
  frameCounter.style.display = radarReadout.hidden && satelliteReadout.hidden ? "none" : "flex";
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
      ? "Pause animation"
      : "Play animation"
  );
}
