/* Local regional context above satellite and radar, with independent controls. */
export function createMapFeatures(maps,onChange=()=>{}) {
  const $=id=>document.getElementById(id);
  let places=[],roads=null;
  const controls=['featurePlaces','featureRoads','featureOutlines','featureStrength'];
  const states=maps.map(map=>{
    for(const [name,z] of [['roads',410],['places',500]]) {
      map.createPane(name);map.getPane(name).style.zIndex=z;map.getPane(name).style.pointerEvents='none';
    }
    return {map,labels:L.layerGroup().addTo(map),roads:L.layerGroup().addTo(map)};
  });
  const settings=()=>({places:$('featurePlaces').checked,roads:$('featureRoads').checked,
    outlines:$('featureOutlines').checked,strength:+$('featureStrength').value/100});
  function draw(state) {
    const {map,labels}=state,zoom=map.getZoom(),viewport=map.getBounds();
    labels.clearLayers();state.roads.clearLayers();
    const occupied=[];
    const size=map.getSize();
    if($('featurePlaces').checked) for(const feature of places) {
      if(feature.properties.minZoom>zoom+.5) continue;
      const [lon,lat]=feature.geometry.coordinates,point=L.latLng(lat,lon);
      if(!viewport.contains(point)) continue;
      const screen=map.latLngToContainerPoint(point),name=feature.properties.name;
      const box={left:screen.x-3,top:screen.y-10,right:screen.x+10+name.length*7,bottom:screen.y+11};
      // Suppress overlapping or clipped labels, prioritising capitals/population.
      if(box.left<0 || box.right>size.x || box.top<0 || box.bottom>size.y || occupied.some(other=>
        box.left<other.right+6 && box.right+6>other.left && box.top<other.bottom+4 && box.bottom+4>other.top)) continue;
      occupied.push(box);
      const text=document.createElement('span');text.textContent=name;
      text.className='cloud-lab-place-text'+(feature.properties.capital ? ' capital' : '');
      L.marker(point,{pane:'places',interactive:false,keyboard:false,
        icon:L.divIcon({className:'cloud-lab-place',html:text,iconSize:[1,1],iconAnchor:[0,0]})}).addTo(labels);
    }
    if(roads && $('featureRoads').checked) {
      const visible=roads.features.filter(feature=>{
        const b=feature.bbox;
        return feature.properties.minZoom<=zoom && b[0]<=viewport.getEast() && b[2]>=viewport.getWest() &&
          b[1]<=viewport.getNorth() && b[3]>=viewport.getSouth();
      });
      const data={type:'FeatureCollection',features:visible};
      for(const style of [{color:'#fff',weight:3,opacity:.85},{color:'#986128',weight:1.2,opacity:1}])
        L.geoJSON(data,{pane:'roads',interactive:false,style:{...style,fill:false}}).addTo(state.roads);
    }
  }
  function apply() {
    const current=settings();$('featureStrengthValue').value=Math.round(current.strength*100)+'%';
    for(const state of states) {
      for(const [pane,enabled] of [['roads',current.roads],['places',current.places],['outlines',current.outlines]]) {
        state.map.getPane(pane).style.opacity=current.strength;
        state.map.getPane(pane).style.display=enabled ? '' : 'none';
      }
      draw(state);
    }
    onChange(current);
  }
  for(const control of controls) $(control).addEventListener(control==='featureStrength' ? 'input' : 'change',apply);
  for(const state of states) state.map.on('moveend',()=>draw(state));
  const ready=(async()=>{
    const results=await Promise.allSettled(['map-features','cloud-lab-places','cloud-lab-roads'].map(async name=>{
      const response=await fetch(`../../data/${name}.geojson`);
      if(!response.ok) throw new Error(name+' unavailable');return response.json();
    }));
    if(results[0].status==='fulfilled') for(const map of maps) {
      for(const style of [{color:'#fff',weight:3,opacity:.8},{color:'#243741',weight:1,opacity:.95}])
        L.geoJSON(results[0].value,{pane:'outlines',interactive:false,style:{...style,fill:false}}).addTo(map);
    }
    if(results[1].status==='fulfilled') places=results[1].value.features.sort((a,b)=>
      Number(b.properties.capital)-Number(a.properties.capital) || b.properties.population-a.properties.population);
    if(results[2].status==='fulfilled') roads=results[2].value;
    for(const map of maps) map.attributionControl.addAttribution('Map features: <a href="https://www.naturalearthdata.com/">Natural Earth</a>');
    $('featureStatus').textContent=results.some(result=>result.status==='rejected') ?
      'Some map features failed to load. Reload to retry.' : 'Regional cities and major roads; more detail appears as you zoom. Satellite imagery is unchanged.';
    apply();
  })();
  apply();
  return {ready,settings,states};
}
