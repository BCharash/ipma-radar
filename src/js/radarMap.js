"use strict";

/*
 * radarMap.js
 * Own the Leaflet map, radar overlays, intensity filter, and range controls.
 */

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

const DEFAULT_LOCATION = {
  lat:39.0867,
  lon:-9.3777,
  zoom:7
};

let map = null;
let baseMapLayer = null;

let radarOverlays = [];

let radarVisible = true;
let radarFrameAvailable = true;
let radarOpacity = 0.8;

let radarRangeLayer = null;

let radarRangeVisible = false;


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


function initializeMap(){

  map =
    L.map(
      "map",
      {
        maxZoom:19,
        zoomAnimation:false,
        fadeAnimation:false,
        markerZoomAnimation:false
      }
    );

  map.attributionControl.addAttribution(
    'Weather: <a href="https://open-meteo.com/" target="_blank" rel="noopener" title="Model-based conditions; temperature rounded">Open-Meteo</a>' +
    ' (<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>)'
  );

  baseMapLayer = L.tileLayer(
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


function setVisibleFrame(index,synchronize=true){

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
      radarVisible && i===index
        ? radarOpacity
        : 0
    );
  }

  currentFrameIndex =
    index;
  radarFrameAvailable = true;
  if(synchronize && !playing) playbackTime = radarFrames[index].date.getTime();

  updateFrameCounter();
  if(synchronize) syncSatelliteToRadar();
}


function setRadarVisible(value){

  const time = playbackTime ?? (radarVisible && radarFrames.length
    ? radarFrames[currentFrameIndex].date.getTime()
    : satelliteFrames[currentSatelliteIndex]?.date.getTime());
  radarVisible = value;
  radarToggle.checked = value;

  if(time !== undefined && time !== null) displayPlaybackTime(time);
  updateFrameCounter();

  document.getElementById("radarLegend").hidden = !value;

  updatePlaybackControls();
  queueSatelliteRefinement();
}
