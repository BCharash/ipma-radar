"use strict";

// Local geographic context above all imagery, independent of image opacity.
let mapFeatureLayer = null;
async function initializeMapFeatures(){
  map.createPane("mapFeaturesPane");
  map.getPane("mapFeaturesPane").style.zIndex = 460;
  map.getPane("mapFeaturesPane").style.pointerEvents = "none";
  try{
    const response = await fetch("data/map-features.geojson");
    if(!response.ok) throw new Error("Map outlines HTTP " + response.status);
    const data = await response.json();
    mapFeatureLayer = L.layerGroup([
      L.geoJSON(data, {pane:"mapFeaturesPane", interactive:false,
        style:{color:"#fff", weight:3, opacity:.8, fill:false}}),
      L.geoJSON(data, {pane:"mapFeaturesPane", interactive:false,
        style:feature => ({color:"#263238", weight:1.1, opacity:.9, fill:false,
          dashArray:feature.properties.kind === "border" ? "4 3" : null})})
    ]).addTo(map);
    map.attributionControl.addAttribution('Outlines: <a href="https://www.naturalearthdata.com/">Natural Earth</a>');
  }
  catch(error){
    console.error("Map outline error:", error);
    showStatus("Map outlines unavailable. Reload to retry.");
  }
}
