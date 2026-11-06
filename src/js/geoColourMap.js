"use strict";

/* Detailed cartography for GeoColour only. Weather stays on its existing
 * registered Leaflet overlays, so playback never waits for a GL image upload.
 */
const GEOCOLOUR_VECTOR_CREDIT = '<a href="https://openfreemap.org/">OpenFreeMap</a> · © <a href="https://openmaptiles.org/">OpenMapTiles</a> · © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>';
const GEOCOLOUR_OUTLINE_CREDIT = 'Outlines: <a href="https://www.naturalearthdata.com/">Natural Earth</a>';
const geoColourMapState = {desired:false,ready:false,generation:0,layers:[],loading:null,style:null,error:null,errors:[]};
let geoColourLibraries = null;
let geoColourVectorCreditVisible = false;
let geoColourOutlineCreditVisible = false;

function setMapRenderingStatus(message){
  const status = document.getElementById("mapRenderingStatus");
  status.hidden = !message;
  status.textContent = message;
}

function geoColourWebGLAvailable(){
  const canvas=document.createElement("canvas");
  const context=canvas.getContext("webgl2",{failIfMajorPerformanceCaveat:false});
  if(!context) return false;
  context.getExtension("WEBGL_lose_context")?.loseContext();
  return true;
}

function loadGeoColourLibraries(){
  if(geoColourLibraries) return geoColourLibraries;
  const asset = (url,css=false) => new Promise((resolve,reject) => {
    const element = document.createElement(css ? "link" : "script");
    if(css){ element.rel="stylesheet"; element.href=url; }
    else element.src=url;
    const timer=setTimeout(() => finish(false),15000);
    function finish(ok){
      clearTimeout(timer);element.onload=element.onerror=null;
      if(ok) resolve();
      else {element.remove();reject(new Error("Map library unavailable"));}
    }
    element.onload=()=>finish(true);element.onerror=()=>finish(false);
    document.head.appendChild(element);
  });
  geoColourLibraries = (async()=>{
    await Promise.all([
      asset("https://unpkg.com/maplibre-gl@5.6.2/dist/maplibre-gl.css",true),
      window.maplibregl ? Promise.resolve() : asset("https://unpkg.com/maplibre-gl@5.6.2/dist/maplibre-gl.js")
    ]);
    if(!L.maplibreGL) await asset("https://unpkg.com/@maplibre/maplibre-gl-leaflet@0.1.4/leaflet-maplibre-gl.js");
  })().catch(error=>{geoColourLibraries=null;throw error;});
  return geoColourLibraries;
}

function geoColourOpacity(original,strength){
  if(Array.isArray(original) && ["step","interpolate"].includes(original[0])){
    const expression=original.slice(),first=expression[0]==="step" ? 2 : 4;
    for(let index=first;index<expression.length;index+=2) expression[index]=["*",expression[index],strength];
    return expression;
  }
  return ["*",original,strength];
}

function refreshGeoColourMapVisibility(){
  const active=geoColourMapState.desired && geoColourMapState.ready;
  const outlines=map.getPane("mapFeaturesPane");
  if(outlines) outlines.style.display=active ? "none" : "";
  if(active){
    if(map.hasLayer(baseMapLayer)) map.removeLayer(baseMapLayer);
  }
  else if(!map.hasLayer(baseMapLayer)) baseMapLayer.addTo(map);
  if(active!==geoColourVectorCreditVisible){
    if(active) map.attributionControl.addAttribution(GEOCOLOUR_VECTOR_CREDIT);
    else map.attributionControl.removeAttribution(GEOCOLOUR_VECTOR_CREDIT);
    geoColourVectorCreditVisible=active;
  }
  const showOutlines=!!mapFeatureLayer && !active;
  if(showOutlines!==geoColourOutlineCreditVisible){
    if(showOutlines) map.attributionControl.addAttribution(GEOCOLOUR_OUTLINE_CREDIT);
    else map.attributionControl.removeAttribution(GEOCOLOUR_OUTLINE_CREDIT);
    geoColourOutlineCreditVisible=showOutlines;
  }
}

function disposeGeoColourMap(){
  for(const layer of geoColourMapState.layers) if(map.hasLayer(layer)){
    // A constructor failure can leave a Leaflet bridge without its GL map.
    if(!layer.getMaplibreMap()) layer.onRemove=()=>layer.getContainer()?.remove();
    layer.remove();
  }
  geoColourMapState.layers=[];geoColourMapState.ready=false;
  refreshGeoColourMapVisibility();
}

function setGeoColourMapEnabled(enabled){
  const state=geoColourMapState;
  if(state.desired===enabled && (state.ready || state.loading || !enabled)) return state.loading;
  state.desired=enabled;
  const generation=++state.generation;
  disposeGeoColourMap();
  state.loading=null;state.error=null;state.errors=[];
  if(!enabled){setMapRenderingStatus("");return Promise.resolve(false);}
  setMapRenderingStatus("Loading detailed map…");
  const attempt=(async()=>{
    try{
      await loadGeoColourLibraries();
      if(!geoColourWebGLAvailable()) throw new Error("WebGL unavailable");
      if(generation!==state.generation) return false;
      if(!state.style){
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
        try{
          const response=await fetch("https://tiles.openfreemap.org/styles/liberty",{signal:controller.signal,credentials:"omit"});
          if(!response.ok) throw new Error("Map style unavailable");
          state.style=await response.json();
        } finally {clearTimeout(timer);}
      }
      if(generation!==state.generation) return false;
      const style=state.style;
      const contextLayer=layer=>layer.type==="line" || layer.type==="symbol" || /transportation/.test(layer["source-layer"] || "");
      const definitions=[{pane:"geoColourBasePane",zIndex:210,context:false},{pane:"geoColourContextPane",zIndex:470,context:true}];
      const loading=[];
      for(const definition of definitions){
        if(!map.getPane(definition.pane)) map.createPane(definition.pane);
        const pane=map.getPane(definition.pane);pane.style.zIndex=definition.zIndex;pane.style.pointerEvents="none";pane.style.visibility="hidden";
        const layers=style.layers.filter(layer=>contextLayer(layer)===definition.context).map(layer=>{
          if(!definition.context) return layer;
          const paint={...layer.paint};
          for(const property of layer.type==="symbol" ? ["text-opacity","icon-opacity"] : [`${layer.type}-opacity`])
            paint[property]=geoColourOpacity(paint[property] ?? 1,.85);
          return {...layer,paint};
        });
        const bridge=L.maplibreGL({style:{...style,layers},pane:definition.pane,interactive:false,padding:0,attributionControl:false});
        state.layers.push(bridge);bridge.addTo(map);
        const gl=bridge.getMaplibreMap();
        gl.on("error",event=>{
          if(generation!==state.generation) return;
          state.errors.push(event.error?.message || "Vector map resource error");
          if(state.errors.length>20) state.errors.shift();
          if(state.ready) setMapRenderingStatus("Some map details unavailable. Switch to Map and back to GeoColour to retry.");
        });
        gl.getCanvas().addEventListener("webglcontextlost",()=>{
          if(generation!==state.generation || !state.desired) return;
          state.generation++;state.loading=null;state.error="Map renderer interrupted";disposeGeoColourMap();
          setMapRenderingStatus("Detailed map unavailable · standard map retained. Select GeoColour again to retry.");
        },{once:true});
        loading.push(new Promise((resolve,reject)=>{
          const timeout=setTimeout(()=>reject(new Error("Map loading timed out")),25000);
          gl.once("load",()=>{clearTimeout(timeout);resolve();});
        }));
      }
      await Promise.all(loading);
      if(generation!==state.generation) return false;
      state.ready=true;
      for(const definition of definitions) map.getPane(definition.pane).style.visibility="visible";
      refreshGeoColourMapVisibility();setMapRenderingStatus("");return true;
    }
    catch(error){
      if(generation===state.generation){
        state.error=error.message;disposeGeoColourMap();
        setMapRenderingStatus("Detailed map unavailable · standard map retained. Switch to Map and back to GeoColour to retry.");
      }
      return false;
    }
    finally {if(generation===state.generation) state.loading=null;}
  })();
  state.loading=attempt;
  return attempt;
}
