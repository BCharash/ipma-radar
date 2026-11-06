/* One MapLibre renderer per Leaflet panel: base, weather image, roads/labels. */
const STYLE='https://tiles.openfreemap.org/styles/liberty';
export function createVectorMap(map,status) {
  let gl=null,context=[],basePaint=new Map(),failure=null;
  const errors=[];
  const weather=new Map();
  const settings=()=>({places:document.getElementById('featurePlaces').checked,
    roads:document.getElementById('featureRoads').checked,outlines:document.getElementById('featureOutlines').checked,
    strength:+document.getElementById('featureStrength').value/100});
  const category=layer=>layer.type==='symbol' ? 'places' :
    /transportation/.test(layer['source-layer'] || '') ? 'roads' : 'outlines';
  function scaledOpacity(original,strength) {
    // MapLibre requires zoom expressions at the top level. Scale their stop
    // outputs rather than wrapping the entire camera expression in a multiply.
    if(Array.isArray(original) && ['interpolate','step'].includes(original[0])) {
      const copy=original.slice(),firstOutput=copy[0]==='step' ? 2 : 4;
      for(let index=firstOutput;index<copy.length;index+=2) copy[index]=['*',copy[index],strength];
      return copy;
    }
    return ['*',original,strength];
  }
  function apply() {
    if(!gl) return;
    const state=settings();
    for(const layer of context) {
      if(!gl.getLayer(layer.id)) continue;
      gl.setLayoutProperty(layer.id,'visibility',state[category(layer)] ? 'visible' : 'none');
      const properties=layer.type==='symbol' ? ['text-opacity','icon-opacity'] : [`${layer.type}-opacity`];
      for(const property of properties) {
        const original=basePaint.get(layer.id)?.[property] ?? 1;
        gl.setPaintProperty(layer.id,property,scaledOpacity(original,state.strength));
      }
    }
  }
  const ready=(async()=>{
    try {
      if(!window.maplibregl || !L.maplibreGL) throw new Error('Vector-map library unavailable');
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
      let style;
      try {const response=await fetch(STYLE,{signal:controller.signal});if(!response.ok) throw new Error('Vector style HTTP '+response.status);style=await response.json();}
      finally {clearTimeout(timer);}
      const isContext=layer=>layer.type==='line' || layer.type==='symbol' || /transportation/.test(layer['source-layer'] || '');
      context=style.layers.filter(isContext);
      style.layers=[...style.layers.filter(layer=>!isContext(layer)),...context];
      for(const layer of context) basePaint.set(layer.id,{...layer.paint});
      const bridge=L.maplibreGL({style,interactive:false,padding:0,attributionControl:false,preserveDrawingBuffer:true}).addTo(map);
      gl=bridge.getMaplibreMap();
      gl.on('error',event=>{errors.push(event.error?.message || 'Vector rendering error');status.textContent='Some vector-map resources could not load; pan or reload to retry.';});
      // Ensure a failed style load cannot leave the satellite operation waiting.
      await new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>reject(new Error('Vector map load timed out')),25000);
        gl.once('load',()=>{clearTimeout(timeout);resolve();});
      });
      map.attributionControl.addAttribution('<a href="https://openfreemap.org/">OpenFreeMap</a> · © <a href="https://openmaptiles.org/">OpenMapTiles</a> · © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>');
      apply();status.textContent='Live vector map · streets, paths and labels gain detail as you zoom.';
      return true;
    } catch(error) {failure=error.message;status.textContent='Vector map unavailable: '+failure;return false;}
  })();
  for(const id of ['featurePlaces','featureRoads','featureOutlines','featureStrength'])
    document.getElementById(id).addEventListener(id==='featureStrength' ? 'input' : 'change',apply);
  function coordinates(bounds) {return [[bounds.getWest(),bounds.getNorth()],[bounds.getEast(),bounds.getNorth()],
    [bounds.getEast(),bounds.getSouth()],[bounds.getWest(),bounds.getSouth()]];}
  async function putImage(id,url,bounds,opacity=1) {
    if(!await ready) throw new Error(failure || 'Vector map unavailable');
    const corners=coordinates(bounds),source=gl.getSource(id);
    if(source) source.updateImage({url,coordinates:corners});
    else {
      gl.addSource(id,{type:'image',url,coordinates:corners});
      const before=id==='skyflow-clouds' && gl.getLayer('skyflow-radar') ? 'skyflow-radar' : context[0]?.id;
      gl.addLayer({id,type:'raster',source:id,paint:{'raster-opacity':opacity,'raster-fade-duration':0}},before);
    }
    gl.setPaintProperty(id,'raster-opacity',opacity);weather.set(id,{bounds,corners});
  }
  function removeImage(id) {if(gl?.getLayer(id)) gl.removeLayer(id);if(gl?.getSource(id)) gl.removeSource(id);weather.delete(id);}
  function setOpacity(opacity) {if(gl?.getLayer('skyflow-clouds')) gl.setPaintProperty('skyflow-clouds','raster-opacity',opacity);}
  function registration(bounds) {
    if(!gl) return null;
    const rect=gl.getCanvas().getBoundingClientRect(),parent=map.getContainer().getBoundingClientRect();
    return Math.max(...[bounds.getSouthWest(),bounds.getNorthEast(),bounds.getCenter()].map(point=>{
      const projected=gl.project([point.lng,point.lat]);
      return map.latLngToContainerPoint(point).distanceTo(L.point(rect.left-parent.left-map.getContainer().clientLeft+projected.x,rect.top-parent.top-map.getContainer().clientTop+projected.y));
    }));
  }
  return {ready,putImage,removeImage,setOpacity,registration,settings,get gl(){return gl;},get context(){return context;},errors};
}
