"use strict";

/*
 * app.js
 * Coordinate shared timeline state, loading batches, refresh, events, and startup.
 * Loaded last: all feature scripts must be available before initialize() runs.
 */

let radarFrames = [];

let currentFrameIndex = 0;

let loadGeneration = 0;


async function preloadFrames(
  frames,
  generation
){

  const batchSize = 4;

  for(
    let i=0;
    i<frames.length;
    i+=batchSize
  ){

    if(
      generation !==
      loadGeneration
    ){
      return;
    }

    await Promise.all(
      frames
        .slice(
          i,
          i+batchSize
        )
        .map(preloadFrame)
    );

    const loaded =
      frames.filter(
        frame => frame.loaded
      ).length;

    showStatus(
      "Loading radar " +
      loaded +
      " of " +
      frames.length +
      "…"
    );
  }
}


async function rebuildRadar(){

  stopPlayback(false);

  const previousNewestTime =
    radarFrames.length
      ? radarFrames[
          radarFrames.length-1
        ].date.getTime()
      : null;

  const generation =
    ++loadGeneration;

  showStatus(
    "Loading radar…"
  );

  try{

    const historyHours =
      Number(
        historySelect.value
      );

    const intervalMinutes =
      Number(
        intervalSelect.value
      );

    let frames =
      await buildFrameList(
        historyHours,
        intervalMinutes,
        generation
      );

    if(
      generation !==
      loadGeneration
    ){
      return;
    }

    if(!frames.length){
      throw new Error(
        "No current IPMA radar frame is available."
      );
    }

    await preloadFrames(
      frames,
      generation
    );

    if(
      generation !==
      loadGeneration
    ){
      return;
    }

    frames =
      frames.filter(
        frame => frame.loaded
      );

    if(!frames.length){
      throw new Error(
        "No radar images could be loaded."
      );
    }

    radarFrames =
      frames;

    currentFrameIndex =
      radarFrames.length-1;

    createRadarOverlays();
    updatePlaybackControls();

    if(radarRangeVisible && radarRangeLayer && !map.hasLayer(radarRangeLayer)){
      radarRangeLayer.addTo(map);
    }

    updateFrameCounter();

    const newNewestTime =
      radarFrames[
        radarFrames.length-1
      ].date.getTime();

    if(
      previousNewestTime !== null &&
      newNewestTime ===
      previousNewestTime
    ){

      showStatus(
        "Radar is current"
      );

      setTimeout(
        hideStatus,
        2500
      );

    }
    else{
      hideStatus();
    }

  }
  catch(error){

    console.error(
      "Radar error:",
      error
    );

    if(
      generation ===
      loadGeneration
    ){

      showStatus(
        "Unable to load radar."
      );

      setTimeout(
        hideStatus,
        3000
      );
    }
  }
}


async function initialize(){

  initializeMap();

  initializeSatellite();
  initializeMapFeatures();

  initializeMinimumRainThreshold();

  setLoopUI(false);

  map.setView(
    [
      DEFAULT_LOCATION.lat,
      DEFAULT_LOCATION.lon
    ],
    DEFAULT_LOCATION.zoom,
    {
      animate:false
    }
  );

  useCurrentLocation({
    silent:true
  });

  await rebuildRadar();
}


function refreshImagery(){
  return Promise.all([refreshSatellite(), rebuildRadar()]);
}

// Bind controls only after all feature scripts have loaded.
thresholdSelect.addEventListener(
  "change",
  () => {

    minimumRainThreshold =
      Number(
        thresholdSelect.value
      );

    localStorage.setItem(
      "ipmaRadarMinimumRain",
      String(
        minimumRainThreshold
      )
    );

    applyRadarThreshold();
  }
);


historySelect.addEventListener(
  "change",
  refreshImagery
);


intervalSelect.addEventListener(
  "change",
  rebuildRadar
);


refreshButton.addEventListener(
  "click",
  refreshImagery
);


previousButton.addEventListener(
  "click",
  showPreviousFrame
);


nextButton.addEventListener(
  "click",
  showNextFrame
);


playButton.addEventListener(
  "click",
  () => {

    if(playing){
      stopPlayback(true);
      queueSatelliteRefinement();
    }
    else{
      startPlayback();
    }
  }
);


loopButton.addEventListener(
  "click",
  () => {

    setLoopUI(
      !looping
    );
  }
);


initialize();
