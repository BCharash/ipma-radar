
"use strict";

const RADAR_BASE_URL =
  "https://www.ipma.pt/resources.www/transf/radar/por/";

const RADAR_BOUNDS = [
  [34.011513,-12.454795],
  [43.792862,-4.345465]
];

const RADAR_SITES = [
  {name:"Arouca",lat:40.84502,lon:-8.27972},
  {name:"Coruche",lat:39.07137,lon:-8.40011},
  {name:"Loulé",lat:37.30408,lon:-7.95308}
];

const RADAR_RANGE_KM = 120;

const IPMA_FRAME_MINUTES = 5;
const PLAYBACK_DELAY = 180;

const DEFAULT_LOCATION = {
  lat:39.0867,
  lon:-9.3777,
  zoom:7
};

let map = null;
let radarOverlays = [];
let radarFrames = [];
let currentFrameIndex = 0;

let playing = false;
let looping = false;

let playbackTimer = null;
let playbackView = null;
let loadGeneration = 0;

let locationMarker = null;
let locationAccuracy = null;

let radarRangeLayer = null;
let radarRangeVisible = false;

let minimumRainThreshold =
  Number(
    localStorage.getItem(
      "ipmaRadarMinimumRain"
    ) || "0.1"
  );

const imageCache = new Map();

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


function applyRadarThreshold(){

  let filter = "none";

  if(minimumRainThreshold === 0.5){
    filter =
      "url(#radar-threshold-05)";
  }

  for(const overlay of radarOverlays){

    const image =
      overlay.getElement();

    if(image){
      image.style.filter = filter;
    }
  }
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


function initializeMap(){

  map =
    L.map(
      "map",
      {
        zoomAnimation:false,
        fadeAnimation:false,
        markerZoomAnimation:false
      }
    );

  L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      maxZoom:19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }
  ).addTo(map);

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

  addLocationControl();

  setTimeout(
    () => map.invalidateSize(false),
    50
  );
}


function addLocationControl(){

  const LocationControl =
    L.Control.extend({

      options:{
        position:"topright"
      },

      onAdd:function(){

        const button =
          L.DomUtil.create(
            "button",
            "location-control"
          );

        button.type = "button";
        button.title =
          "Current location";

        button.setAttribute(
          "aria-label",
          "Current location"
        );

        button.innerHTML =
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
          '<circle cx="12" cy="12" r="3"></circle>' +
          '<line x1="12" y1="2" x2="12" y2="6"></line>' +
          '<line x1="12" y1="18" x2="12" y2="22"></line>' +
          '<line x1="2" y1="12" x2="6" y2="12"></line>' +
          '<line x1="18" y1="12" x2="22" y2="12"></line>' +
          '</svg>';

        L.DomEvent.disableClickPropagation(
          button
        );

        L.DomEvent.on(
          button,
          "click",
          () =>
            useCurrentLocation({
              silent:false
            })
        );

        return button;
      }
    });

  map.addControl(
    new LocationControl()
  );

  addRadarRangeControl();
}


function createRadarRangeLayer(){

  map.createPane("radarRangePane");
  map.getPane("radarRangePane").style.zIndex = 450;
  map.getPane("radarRangePane").style.pointerEvents = "none";

  radarRangeLayer = L.layerGroup();

  for(const site of RADAR_SITES){

    L.circle([site.lat,site.lon],{
      radius:RADAR_RANGE_KM * 1000,
      pane:"radarRangePane",
      color:"#555",
      weight:1.5,
      opacity:.62,
      fill:false,
      interactive:false
    }).addTo(radarRangeLayer);

    L.circleMarker([site.lat,site.lon],{
      pane:"radarRangePane",
      radius:4,
      color:"#555",
      weight:1.5,
      opacity:.85,
      fillOpacity:.85,
      interactive:false
    }).addTo(radarRangeLayer);
  }
}

function setRadarRangeVisible(value){

  radarRangeVisible = value;

  if(!radarRangeLayer){
    createRadarRangeLayer();
  }

  if(value){
    radarRangeLayer.addTo(map);
  }
  else if(map.hasLayer(radarRangeLayer)){
    map.removeLayer(radarRangeLayer);
  }

  const button = document.querySelector(".radar-range-control");

  if(button){
    button.classList.toggle("range-active",value);
    button.title = value ? "Radar range on" : "Radar range off";
    button.setAttribute("aria-label",value ? "Radar range on" : "Radar range off");
  }
}

function addRadarRangeControl(){

  const RadarRangeControl =
    L.Control.extend({

      options:{position:"topright"},

      onAdd:function(){

        const button =
          L.DomUtil.create("button","radar-range-control");

        button.type = "button";
        button.title = "Radar range off";
        button.setAttribute("aria-label","Radar range off");

        button.innerHTML =
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
          '<circle cx="12" cy="12" r="3"></circle>' +
          '<circle cx="12" cy="12" r="7"></circle>' +
          '<circle cx="12" cy="12" r="10"></circle>' +
          '</svg>';

        L.DomEvent.disableClickPropagation(button);

        L.DomEvent.on(button,"click",() => {
          setRadarRangeVisible(!radarRangeVisible);
        });

        return button;
      }
    });

  map.addControl(new RadarRangeControl());
}

function useCurrentLocation(
  options={}
){

  const silent =
    options.silent === true;

  if(!navigator.geolocation){

    if(!silent){
      alert(
        "Geolocation is not available in this browser."
      );
    }

    return;
  }

  if(!silent){
    showStatus(
      "Finding your location…"
    );
  }

  navigator.geolocation.getCurrentPosition(

    position => {

      const {
        latitude:lat,
        longitude:lon,
        accuracy
      } = position.coords;

      if(locationMarker){
        map.removeLayer(
          locationMarker
        );
      }

      if(locationAccuracy){
        map.removeLayer(
          locationAccuracy
        );
      }

      locationAccuracy =
        L.circle(
          [lat,lon],
          {
            radius:accuracy,
            weight:1,
            fillOpacity:.08
          }
        ).addTo(map);

      locationMarker =
        L.circleMarker(
          [lat,lon],
          {
            radius:6,
            weight:2,
            fillOpacity:.9
          }
        ).addTo(map);

      map.setView(
        [lat,lon],
        Math.max(
          map.getZoom(),
          8
        ),
        {
          animate:false
        }
      );

      if(!silent){
        hideStatus();
      }
    },

    () => {

      if(!silent){

        hideStatus();

        alert(
          "Unable to determine your location."
        );
      }
    },

    {
      enableHighAccuracy:true,
      timeout:10000,
      maximumAge:300000
    }
  );
}


function radarFilename(date){

  const yyyy =
    date.getUTCFullYear();

  const mm =
    String(
      date.getUTCMonth()+1
    ).padStart(2,"0");

  const dd =
    String(
      date.getUTCDate()
    ).padStart(2,"0");

  const hh =
    String(
      date.getUTCHours()
    ).padStart(2,"0");

  const min =
    String(
      date.getUTCMinutes()
    ).padStart(2,"0");

  return (
    "pcr-" +
    yyyy +
    "-" +
    mm +
    "-" +
    dd +
    "T" +
    hh +
    min +
    ".png"
  );
}


function radarURL(date){
  return (
    RADAR_BASE_URL +
    radarFilename(date)
  );
}


function floorToFiveMinutes(date){

  const d =
    new Date(date);

  d.setUTCSeconds(
    0,
    0
  );

  d.setUTCMinutes(
    Math.floor(
      d.getUTCMinutes() /
      IPMA_FRAME_MINUTES
    ) *
    IPMA_FRAME_MINUTES
  );

  return d;
}


function testImage(url){

  return new Promise(
    resolve => {

      const img =
        new Image();

      img.onload =
        () => resolve(true);

      img.onerror =
        () => resolve(false);

      img.src = url;
    }
  );
}


async function findLatestFrame(){

  let candidate =
    floorToFiveMinutes(
      new Date()
    );

  for(
    let i=0;
    i<=6;
    i++
  ){

    const url =
      radarURL(candidate);

    if(imageCache.has(url)){
      return candidate;
    }

    if(await testImage(url)){
      return candidate;
    }

    candidate =
      new Date(
        candidate.getTime() -
        IPMA_FRAME_MINUTES *
        60 *
        1000
      );
  }

  return null;
}


async function buildFrameList(
  historyHours,
  intervalMinutes,
  generation
){

  const newest =
    await findLatestFrame();

  if(
    !newest ||
    generation !== loadGeneration
  ){
    return [];
  }

  const frameCount =
    Math.floor(
      historyHours *
      60 /
      intervalMinutes
    );

  const frames = [];

  for(
    let i=frameCount;
    i>=0;
    i--
  ){

    if(
      generation !==
      loadGeneration
    ){
      return [];
    }

    const date =
      new Date(
        newest.getTime() -
        i *
        intervalMinutes *
        60 *
        1000
      );

    frames.push({
      date,
      url:radarURL(date),
      loaded:false
    });
  }

  return frames;
}


function preloadFrame(frame){

  if(imageCache.has(frame.url)){

    frame.image =
      imageCache.get(frame.url);

    frame.loaded = true;

    return Promise.resolve(
      frame.image
    );
  }

  return new Promise(
    resolve => {

      const img =
        new Image();

      img.decoding = "sync";

      img.onload =
        async () => {

          try{
            if(img.decode){
              await img.decode();
            }
          }
          catch(e){}

          imageCache.set(
            frame.url,
            img
          );

          frame.image = img;
          frame.loaded = true;

          resolve(img);
        };

      img.onerror =
        () => {

          frame.loaded = false;

          resolve(null);
        };

      img.src = frame.url;
    }
  );
}


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


function removeRadarOverlays(){

  for(
    const overlay of radarOverlays
  ){

    if(map.hasLayer(overlay)){
      map.removeLayer(
        overlay
      );
    }
  }

  radarOverlays = [];
}


function createRadarOverlays(){

  removeRadarOverlays();

  for(
    let i=0;
    i<radarFrames.length;
    i++
  ){

    const overlay =
      L.imageOverlay(
        radarFrames[i].url,
        RADAR_BOUNDS,
        {
          opacity:0,
          interactive:false,
          zIndex:100
        }
      );

    overlay.addTo(map);

    radarOverlays.push(
      overlay
    );
  }

  setVisibleFrame(
    currentFrameIndex
  );

  applyRadarThreshold();
}


function setVisibleFrame(index){

  if(
    index<0 ||
    index>=radarOverlays.length
  ){
    return;
  }

  for(
    let i=0;
    i<radarOverlays.length;
    i++
  ){

    radarOverlays[i].setOpacity(
      i===index
        ? .80
        : 0
    );
  }

  currentFrameIndex =
    index;

  updateFrameCounter();
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
  rebuildRadar
);


intervalSelect.addEventListener(
  "change",
  rebuildRadar
);


refreshButton.addEventListener(
  "click",
  rebuildRadar
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


async function initialize(){

  initializeMap();

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


initialize();
