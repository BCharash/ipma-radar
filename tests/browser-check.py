#!/usr/bin/env python3
"""Live Chrome acceptance checks; uses public imagery and no API keys.

Run on macOS: python3 tests/browser-check.py
Uses an isolated Chrome profile, local server, and the Python standard library.
Network availability affects imagery checks. The short history limits downloads.
"""
import base64, http.server, json, os, pathlib, socket, struct, subprocess, sys, threading, time, urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs): super().__init__(*args, directory=str(ROOT), **kwargs)
    def log_message(self, *args): pass
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
profile = pathlib.Path('/private/tmp') / ('ipma-satellite-browser-' + str(os.getpid()))
chrome = subprocess.Popen(['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '--headless', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + str(profile), 'about:blank'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
class CDP:
    def __init__(self, url):
        from urllib.parse import urlsplit
        u = urlsplit(url)
        self.sock = socket.create_connection((u.hostname, u.port), timeout=90)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall(f'GET {u.path} HTTP/1.1\r\nHost: {u.hostname}:{u.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n'.encode())
        response = b''
        while not response.endswith(b'\r\n\r\n'): response += self.sock.recv(1)
        assert response.startswith(b'HTTP/1.1 101 '), response
        self.n = 0
    def read(self, size):
        b = b''
        while len(b) < size:
            chunk = self.sock.recv(size-len(b))
            if not chunk: raise RuntimeError('CDP disconnected')
            b += chunk
        return b
    def call(self, method, params=None):
        self.n += 1
        body = json.dumps({'id':self.n,'method':method,'params':params or {}}).encode()
        mask = os.urandom(4)
        size = len(body)
        head = bytes([0x81, 0x80 | size]) if size < 126 else bytes([0x81, 0x80 | 126]) + struct.pack('!H', size)
        self.sock.sendall(head + mask + bytes(v ^ mask[i%4] for i,v in enumerate(body)))
        while True:
            h = self.read(2); size = h[1] & 127
            if size == 126: size = struct.unpack('!H', self.read(2))[0]
            elif size == 127: size = struct.unpack('!Q', self.read(8))[0]
            message = json.loads(self.read(size))
            if message.get('id') == self.n:
                if 'error' in message: raise RuntimeError(message)
                return message.get('result', {})
    def evaluate(self, expression):
        result = self.call('Runtime.evaluate', {'expression':expression,'awaitPromise':True,'returnByValue':True})
        if 'exceptionDetails' in result: raise RuntimeError(result)
        return result.get('result',{}).get('value')
try:
    for _ in range(100):
        if (profile / 'DevToolsActivePort').exists(): break
        time.sleep(.1)
    port = (profile / 'DevToolsActivePort').read_text().splitlines()[0]
    target = json.load(urllib.request.urlopen(urllib.request.Request(f'http://127.0.0.1:{port}/json/new?about:blank', method='PUT')))
    c = CDP(target['webSocketDebuggerUrl'])
    c.call('Page.enable')
    c.call('Page.addScriptToEvaluateOnNewDocument', {'source':'window.testErrors=[]; window.addEventListener("error", e=>testErrors.push(e.message)); window.addEventListener("unhandledrejection", e=>testErrors.push(String(e.reason)));'})
    c.call('Emulation.setDeviceMetricsOverride', {'width':390,'height':844,'deviceScaleFactor':1,'mobile':True})
    c.call('Page.navigate', {'url':f'http://127.0.0.1:{server.server_port}/index.html'})
    for _ in range(200):
        if c.evaluate('typeof initializeSatellite === "function" && typeof radarFrames !== "undefined" && !!map'): break
        time.sleep(.2)
    print('STARTUP', c.evaluate('({errors:testErrors, overflow:document.documentElement.scrollWidth>innerWidth})'), flush=True)
    assert c.evaluate('satelliteSelect.value==="map" && radarToggle.checked && !geoColourMapState.desired && satelliteHighEnabled && !document.getElementById("satelliteQuality")')
    result=c.evaluate("""(async()=>{
      cancelSatellitePreload();
      const originalCatalogue=getSatelliteCatalogue, originalLoad=loadSatelliteImage;
      const originalHistory=historySelect.value;
      const calls=[];
      try{
        historySelect.value='1';
        getSatelliteCatalogue=async()=>({[SATELLITE_PRODUCTS.hybrid.layer]:{
          timestamp:'2026-11-07T12:00:00Z',stepMs:600000}});
        loadSatelliteImage=async(url,signal)=>{
          const q=new URL(url).searchParams;
          calls.push(Math.max(Number(q.get('width')),Number(q.get('height'))));
          return {};
        };
        await preloadGeoColour();
        const ordered=calls.length===14 && calls.slice(0,7).every(n=>n===256) && calls.slice(7).every(n=>n>256);
        const hidden=satelliteSelect.value==='map' && satelliteFrames.length===0 && !satelliteLoading && !geoColourMapState.desired;
        await preloadGeoColour();
        const reused=calls.length===14;
        calls.length=0;
        loadSatelliteImage=async()=>{calls.push(256);cancelSatellitePreload();return null;};
        await preloadGeoColour(true);
        return {ordered,hidden,reused,cancelled:calls.length===1 && satellitePreloadRequest===null};
      }finally{
        getSatelliteCatalogue=originalCatalogue;loadSatelliteImage=originalLoad;
        historySelect.value=originalHistory;satellitePreloadKey=null;
      }
    })()""")
    print('GECOLOUR_PRELOAD',result,flush=True)
    assert all(result.values()),result
    result=c.evaluate("(async()=>{historySelect.value='1'; await Promise.all([rebuildRadar(),updateSatellite()]);return {frames:radarFrames.length,errors:testErrors};})()")
    print('RADAR',result,flush=True)
    assert result['frames'] > 1 and not result['errors']
    result=c.evaluate("""(async()=>{
      stopPlayback(false);cancelSatellitePreload();cancelSatelliteRefinement();
      const saved={radarFrames,radarOverlays,satelliteFrames,currentFrameIndex,currentSatelliteIndex,
        playbackTime,radarVisible,radarFrameAvailable,product:satelliteSelect.value,
        queue:queueSatelliteRefinement,coverage:commitSatelliteCoverage,quality:commitSatelliteQuality};
      const overlays=[];
      const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      const base=Date.parse('2026-11-08T12:00:00Z'),minute=60000;
      const frame=time=>{
        const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;
        const overlay=L.imageOverlay(canvas.toDataURL(),map.getBounds(),{opacity:0}).addTo(map);
        overlays.push(overlay);return {date:new Date(time),overlay,product:'visible',geometry:{width:2,height:2}};
      };
      try{
        queueSatelliteRefinement=()=>{};commitSatelliteCoverage=()=>{};commitSatelliteQuality=()=>{};
        satelliteSelect.value='visible';radarVisible=true;
        radarFrames=Array.from({length:7},(_,i)=>frame(base+i*20*minute));
        radarOverlays=radarFrames.map(f=>f.overlay);
        satelliteFrames=Array.from({length:19},(_,i)=>frame(base+(i*10-30)*minute));
        currentFrameIndex=0;currentSatelliteIndex=0;
        const merged=availablePlaybackTimes();
        const allFrames=merged.length===19 && [...radarFrames,...satelliteFrames].every(f=>merged.includes(+f.date));
        let held=true;
        for(const t of merged){
          displayPlaybackTime(t);
          const r=radarFrames.filter(f=>+f.date<=t).pop(),sat=satelliteFrames.filter(f=>+f.date<=t).pop();
          held=held && (r ? radarFrameAvailable && radarFrames[currentFrameIndex]===r : !radarFrameAvailable)
            && satelliteLayer===(sat?.overlay ?? null);
        }
        displayPlaybackTime(base-31*minute);
        const noFuture=!radarFrameAvailable && !satelliteLayer;
        // Different observation minutes must survive the merge too.
        radarFrames.forEach(f=>f.date=new Date(+f.date+5*minute));
        const distinct=availablePlaybackTimes().length===26;
        playbackTime=base;showNextFrame();
        const next=playbackTime===base+5*minute;
        const satelliteHeld=+satelliteFrames.find(f=>f.overlay===satelliteLayer).date===base;
        showPreviousFrame();const previous=playbackTime===base;
        playbackTime=availablePlaybackTimes()[0];showPreviousFrame();
        const wraps=playbackTime===availablePlaybackTimes().at(-1);
        setLoopUI(false);startPlayback();
        const clock=JSON.stringify(playbackTimeline),timer=playbackTimer,time=playbackTime;
        setRadarVisible(false);setRadarVisible(true);
        const toggleStable=playing && playbackTime===time && playbackTimer===timer && JSON.stringify(playbackTimeline)===clock;
        satelliteFrames.unshift(frame(base-40*minute));
        const arrivalsStable=JSON.stringify(playbackTimeline)===clock;
        playbackCursor=playbackTimeline.length-1;await sleep(220);
        const expanded=playing && playbackTimeline.length===27 && playbackTimeline[0]===base-40*minute;
        // A new satellite image can share an existing radar timestamp. It still
        // needs a pass even though the merged timestamp count has not changed.
        satelliteFrames.push(frame(base+5*minute));satelliteFrames.sort((a,b)=>a.date-b.date);
        displayPlaybackTime(base+5*minute);
        const overlapHeld=+satelliteFrames.find(f=>f.overlay===satelliteLayer).date===base;
        playbackCursor=playbackTimeline.length-1;await sleep(220);
        const overlapAdopted=playing && playbackTimeline.length===27 && playbackSatelliteTimes.has(base+5*minute);
        playbackCursor=playbackTimeline.length-1;await sleep(220);
        const respectsLoop=!playing;
        // Starting with radar disabled and enabling it must produce the same union next pass.
        setRadarVisible(false);setLoopUI(true);startPlayback();setRadarVisible(true);
        playbackCursor=playbackTimeline.length-1;await sleep(220);
        const toggleOrder=JSON.stringify(playbackTimeline)===JSON.stringify(availablePlaybackTimes());
        stopPlayback(false);satelliteSelect.value='map';
        const mapOnly=availablePlaybackTimes().length===7;
        radarVisible=false;
        const none=availablePlaybackTimes().length===0;
        return {allFrames,held,noFuture,distinct,next,satelliteHeld,previous,wraps,toggleStable,arrivalsStable,expanded,overlapHeld,overlapAdopted,respectsLoop,toggleOrder,mapOnly,none};
      }finally{
        stopPlayback(false);overlays.forEach(o=>o.remove());
        radarFrames=saved.radarFrames;radarOverlays=saved.radarOverlays;satelliteFrames=saved.satelliteFrames;
        currentFrameIndex=saved.currentFrameIndex;currentSatelliteIndex=saved.currentSatelliteIndex;
        playbackTime=saved.playbackTime;radarVisible=saved.radarVisible;radarToggle.checked=radarVisible;
        radarFrameAvailable=saved.radarFrameAvailable;satelliteSelect.value=saved.product;
        queueSatelliteRefinement=saved.queue;commitSatelliteCoverage=saved.coverage;commitSatelliteQuality=saved.quality;
        satelliteLayer=null;setLoopUI(false);
        if(playbackTime!==null)displayPlaybackTime(playbackTime);
        updatePlaybackControls();
      }
    })()""")
    print('COMBINED_TIMELINE',result,flush=True)
    assert all(result.values()),result
    for mode in (['hybrid'] if '--quick' in sys.argv else ['hybrid','visible','infrared']):
        result = c.evaluate("""(async () => {
          satelliteSelect.value = %s;
          await updateSatellite(true);
          return {mode:satelliteSelect.value,state:satelliteStatus.dataset.state,status:satelliteStatus.textContent,
            frames:satelliteFrames.length,loading:satelliteLoading,errors:testErrors,
            satelliteOpacity:satelliteOpacity,radarFrames:radarFrames.length,timings:satelliteLoadTimings};
        })()""" % json.dumps(mode))
        print('SATELLITE', result, flush=True)
        assert result['state'] == 'ready' and result['frames'] > 1 and not result['errors'], result
        if mode == 'hybrid':
            result=c.evaluate("""(async()=>{
              await geoColourMapState.loading;
              const ready=geoColourMapState.ready && !map.hasLayer(baseMapLayer);
              const gl=geoColourMapState.layers[1]?.getMaplibreMap();
              for(let i=0;i<200 && gl && !gl.areTilesLoaded();i++)await new Promise(resolve=>setTimeout(resolve,100));
              const textLayers=gl?.getStyle().layers.filter(layer=>layer.type==='symbol' && layer.layout?.['text-field']).map(layer=>layer.id);
              const text=!!gl && gl.queryRenderedFeatures(undefined,{layers:textLayers}).length>0;
              const layersAbove=+map.getPane('geoColourContextPane')?.style.zIndex>+map.getPane('overlayPane').style.zIndex &&
                +map.getPane('geoColourBasePane')?.style.zIndex<+map.getPane('satellitePane').style.zIndex;
              const beforeTime=playbackTime,beforeFrame=satelliteLayer;
              satelliteOpacityControl.value='100';satelliteOpacityControl.dispatchEvent(new Event('input'));
              const independentOpacity=satelliteLayer.options.opacity===1 && geoColourMapState.ready && playbackTime===beforeTime && satelliteLayer===beforeFrame;
              const footer=document.getElementById('frameCounter').getBoundingClientRect(),credits=map.attributionControl.getContainer().getBoundingClientRect();
              const clearCredits=footer.bottom<=credits.top;
              const savedView={center:map.getCenter(),zoom:map.getZoom()};
              map.setView([38.72,-9.14],17,{animate:false});clearTimeout(satelliteMoveTimer);
              await new Promise(resolve=>setTimeout(resolve,600));
              for(let i=0;i<150 && !gl.areTilesLoaded();i++)await new Promise(resolve=>setTimeout(resolve,100));
              const streetNames=gl.queryRenderedFeatures().some(feature=>feature.sourceLayer==='transportation_name' && feature.properties.name);
              const rect=gl.getCanvas().getBoundingClientRect(),parent=map.getContainer().getBoundingClientRect();
              const vectorError=Math.max(...[map.getBounds().getSouthWest(),map.getBounds().getNorthEast(),map.getCenter()].map(point=>{
                const projected=gl.project([point.lng,point.lat]);
                return map.latLngToContainerPoint(point).distanceTo(L.point(rect.left-parent.left+projected.x,rect.top-parent.top+projected.y));
              }));
              const zoomRegistration=vectorError<2 && map.getMaxZoom()===19 && playbackTime===beforeTime;
              map.setView(savedView.center,savedView.zoom,{animate:false});clearTimeout(satelliteMoveTimer);
              await new Promise(resolve=>setTimeout(resolve,250));
              const attribution=map.attributionControl.getContainer().textContent;
              const correctAttribution=attribution.includes('OpenFreeMap') && attribution.includes('OpenMapTiles') && attribution.includes('OpenStreetMap') && !attribution.includes('Natural Earth');
              return {ready,text,layersAbove,independentOpacity,clearCredits,correctAttribution,streetNames,zoomRegistration,vectorError,mapError:geoColourMapState.error,vectorErrors:geoColourMapState.errors,errors:testErrors};
            })()""")
            print('GEOCOLOUR_MAP',result,flush=True)
            assert all(result[key] for key in ['ready','text','layersAbove','independentOpacity','clearCredits','correctAttribution','streetNames','zoomRegistration']) and not result['vectorErrors'] and not result['errors'],result
            shot=c.call('Page.captureScreenshot',{'format':'png'})
            pathlib.Path('/private/tmp/ipma-satellite-mobile.png').write_bytes(base64.b64decode(shot['data']))
        result=c.evaluate("""(async()=>{
          const checks=[];
          function registration(){
            const g=satelliteFrames[0].geometry;
            const el=satelliteFrames[0].overlay.getElement().getBoundingClientRect();
            const mapRect=map.getContainer().getBoundingClientRect();
            const points=[g.bounds.getCenter(),g.bounds.getSouthWest(),g.bounds.getNorthEast()];
            return Math.max(...points.map(p=>{
              const q=L.CRS.EPSG3857.project(p);
              const x=el.left-mapRect.left+(q.x-g.bbox[0])/(g.bbox[2]-g.bbox[0])*el.width;
              const y=el.top-mapRect.top+(g.bbox[3]-q.y)/(g.bbox[3]-g.bbox[1])*el.height;
              return map.latLngToContainerPoint(p).distanceTo(L.point(x,y));
            }));
          }
          checks.push(registration());
          const frame=satelliteFrames[0];
          map.panBy([10,10],{animate:false});
          checks.push(registration());
          // Zoom updates geometry by a debounce; check the existing registered image first.
          map.setZoom(map.getZoom()+1,{animate:false});
          clearTimeout(satelliteMoveTimer);
          checks.push(registration());
          const request=new URL(satelliteImageURL(SATELLITE_PRODUCTS[satelliteSelect.value],frame.date,frame.geometry));
          return {maxError:Math.max(...checks),crs:request.searchParams.get('srs'),bbox:request.searchParams.get('bbox'),expected:frame.geometry.bbox.join(',')};
        })()""")
        print('REGISTRATION',result,flush=True)
        assert result['maxError'] < 2 and result['crs']=='EPSG:3857' and result['bbox']==result['expected'], result
        # Restore initial view for subsequent product request, cancel the debounced reload.
        c.evaluate("map.setView([39.0867,-9.3777],7,{animate:false});clearTimeout(satelliteMoveTimer)")
    result=c.evaluate("""(async()=>{
      cancelSatelliteRefinement();
      const originalLoader=loadSatelliteImage;
      const calls=[];
      let releaseHistory,releaseHigh,releaseCoverage;
      let holdCoverage=false,coverageRequests=0;
      const historyGate=new Promise(resolve=>{releaseHistory=resolve;});
      const highGate=new Promise(resolve=>{releaseHigh=resolve;});
      const coverageGate=new Promise(resolve=>{releaseCoverage=resolve;});
      const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      try{
        satelliteSelect.value='map';await updateSatellite();
        satelliteSelect.value='hybrid';satelliteHighEnabled=true;
        await getSatelliteCatalogue(new AbortController().signal,false,SATELLITE_PRODUCTS.hybrid.layer);
        satelliteCatalogueTime=Date.now();
        const newest=Date.parse(satelliteCatalogue[SATELLITE_PRODUCTS.hybrid.layer].timestamp);
        playbackTime=newest;
        const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;
        const source=canvas.toDataURL();
        loadSatelliteImage=async(url,signal)=>{
          const query=new URL(url).searchParams;
          const call={time:Date.parse(query.get('time')),size:Math.max(+query.get('width'),+query.get('height')),bbox:query.get('bbox')};
          calls.push(call);
          if(call.size<=256 && calls.filter(c=>c.size<=256).length>=3)await historyGate;
          if(call.size>256)await highGate;
          if(holdCoverage && ++coverageRequests>=2)await coverageGate;
          const image=new Image();image.src=source;await image.decode();return image;
        };
        const pending=updateSatellite();
        for(let i=0;i<100 && satelliteFrames.length<2;i++)await sleep(5);
        setRadarVisible(false);setLoopUI(false);startPlayback();
        const playableWhileLoading=playing && satelliteLoading;
        const newestFirst=calls[0].time===newest && calls.every((c,i)=>!i || c.time<=calls[i-1].time);
        await sleep(850);
        const repeatsWhileLoading=playing;
        const time=playbackTime,clock=JSON.stringify(playbackTimeline),timer=playbackTimer;
        setRadarVisible(true);setRadarVisible(false);
        const togglesContinue=playing && playbackTime===time && playbackTimer===timer && JSON.stringify(playbackTimeline)===clock;
        const lowFinishesBeforeHigh=!calls.some(call=>call.size>256);
        releaseHistory();await pending;
        const arrivalsKeepClock=playbackTime===time && JSON.stringify(playbackTimeline)===clock;
        playbackCursor=playbackTimeline.length-1;await sleep(220);
        const historyAdopted=playing && playbackTimeline.length===satelliteFrames.length;
        setLoopUI(true);
        satelliteHighEnabled=true;
        for(let i=0;i<150 && !satelliteDetailRequest;i++)await sleep(5);
        const autoHighStarted=!!satelliteDetailRequest && calls.some(call=>call.size>256);
        const high=(async()=>{while(satelliteDetailRequest)await sleep(5)})();
        const lowUntilComplete=satelliteQualityActive==='low' && !satelliteQualityPending && playing;
        satelliteHighEnabled=false;cancelSatelliteRefinement();satelliteQualityActive='low';syncSatelliteToRadar();
        releaseHigh();await high;
        const lateHighRespectsLow=satelliteQualityActive==='low' && !satelliteQualityPending;
        satelliteHighEnabled=true;await refineSatelliteFrame();
        const waitsForBoundary=satelliteQualityActive==='low' && satelliteQualityPending;
        playbackCursor=playbackTimeline.length-1;await sleep(220);
        const allHigh=satelliteQualityActive==='high' && satelliteFrames.every(f=>f.detail);
        const highReadout=document.getElementById('satelliteFrameCounter').textContent.includes('High 2×2 px');
        let uniformHigh=true;
        for(const t of playbackTimeline){displayPlaybackTime(t);uniformHigh=uniformHigh && satelliteFrames.some(f=>f.detail.overlay===satelliteLayer);}
        satelliteHighEnabled=false;cancelSatelliteRefinement();satelliteQualityActive='low';syncSatelliteToRadar();
        const lowInstant=satelliteQualityActive==='low' && satelliteFrames.some(f=>f.overlay===satelliteLayer);
        const lowReadout=document.getElementById('satelliteFrameCounter').textContent.includes('Low 2×2 px');
        const before=calls.length;
        satelliteHighEnabled=true;await refineSatelliteFrame();
        const highReuse=calls.length===before;
        playbackCursor=playbackTimeline.length-1;await sleep(220);
        satelliteHighEnabled=false;cancelSatelliteRefinement();satelliteQualityActive='low';syncSatelliteToRadar();
        const missing=satelliteFrames[satelliteFrames.length-1];missing.detail.overlay.remove();delete missing.detail;
        const goodLoader=loadSatelliteImage;
        loadSatelliteImage=async(url,signal)=>Date.parse(new URL(url).searchParams.get('time'))===+missing.date ? null : goodLoader(url,signal);
        satelliteHighEnabled=true;await refineSatelliteFrame();
        const partialWaitsForBoundary=satelliteQualityActive==='low' && satelliteQualityPending && !missing.detail;
        playbackCursor=playbackTimeline.length-1;await sleep(220);
        displayPlaybackTime(+missing.date);
        const missingUsesLow=satelliteQualityActive==='high' && satelliteLayer===missing.overlay;
        const fallbackReported=document.getElementById('satelliteHighStatus').textContent.includes('1 Low fallbacks') &&
          !satelliteHighRetry.hidden;
        let otherFramesUseHigh=true;
        for(const frame of satelliteFrames.filter(frame=>frame!==missing)){
          displayPlaybackTime(+frame.date);otherFramesUseHigh=otherFramesUseHigh && satelliteLayer===frame.detail.overlay;
        }
        const persistentCount=document.getElementById('satelliteHighStatus').textContent.includes(
          'High ready '+(satelliteFrames.length-1)+'/'+satelliteFrames.length);
        queueSatelliteRefinement();
        const noAutomaticRetry=satelliteDetailTimer===null && !satelliteDetailRequest;
        loadSatelliteImage=goodLoader;
        let releaseRetry;
        const retryGate=new Promise(resolve=>{releaseRetry=resolve});
        loadSatelliteImage=async(url,signal)=>{await retryGate;return goodLoader(url,signal)};
        const retryURL=satelliteImageURL(SATELLITE_PRODUCTS[missing.product],missing.date,satelliteGeometry());
        satelliteFailedUntil.set(retryURL,Date.now()+45000);
        satelliteHighRetry.click();clearTimeout(satelliteDetailTimer);satelliteDetailTimer=null;
        const explicitRetryClearsFailure=!satelliteFailedUntil.has(retryURL);
        const retry=refineSatelliteFrame();await sleep(10);
        const retryProgressInStatus=document.getElementById('satelliteHighStatus').textContent.includes('processed') &&
          !document.getElementById('satelliteHighStatus').hidden &&
          document.getElementById('satelliteHighStatus').compareDocumentPosition(document.getElementById('opacityControls'))===Node.DOCUMENT_POSITION_FOLLOWING &&
          !document.getElementById('satelliteFrameCounter').textContent.includes('processed');
        releaseRetry();await retry;
        displayPlaybackTime(+missing.date);
        const retryHeldUntilBoundary=satelliteLayer===missing.overlay && !missing.detail && satelliteQualityPending;
        playbackCursor=playbackTimeline.length-1;await sleep(220);
        displayPlaybackTime(+missing.date);
        const retryUpgradesAtBoundary=satelliteLayer===missing.detail.overlay && satelliteHighRetry.hidden &&
          document.getElementById('satelliteHighStatus').textContent.includes('0 Low fallbacks');
        satelliteHighEnabled=false;cancelSatelliteRefinement();satelliteQualityActive='low';syncSatelliteToRadar();
        const retainedDetails=satelliteFrames.map(frame=>frame.detail);
        for(const frame of satelliteFrames)delete frame.detail;
        const staleOverlay=L.imageOverlay(source,missing.geometry.bounds,{pane:'satellitePane',opacity:0}).addTo(map);
        missing.detail={geometry:{...missing.geometry,bbox:missing.geometry.bbox.map(n=>n+1)},overlay:staleOverlay};
        loadSatelliteImage=async()=>null;
        satelliteHighEnabled=true;await refineSatelliteFrame();
        playbackCursor=playbackTimeline.length-1;await sleep(220);
        const allFailedUsesLow=satelliteQualityActive==='high' && satelliteHighProgress.finished &&
          satelliteHighProgress.processed===satelliteFrames.length && satelliteHighProgress.ready===0 &&
          !satelliteQualityPending && satelliteFrames.every(frame=>!frame.detail) && !map.hasLayer(staleOverlay);
        satelliteHighEnabled=false;cancelSatelliteRefinement();satelliteQualityActive='low';syncSatelliteToRadar();
        satelliteFrames.forEach((frame,i)=>{frame.detail=retainedDetails[i]});
        loadSatelliteImage=goodLoader;
        const priorBounds=satelliteFrames[0].geometry.bounds;
        const oldMovie=satelliteFrames.slice();
        holdCoverage=true;
        const priorTime=playbackTime;
        const beforeCoverage=calls.length;
        map.setZoom(map.getZoom()-2,{animate:false});
        const coverageKeepsClock=playing && playbackTime===priorTime;
        for(let i=0;i<200 && calls.length===beforeCoverage;i++)await sleep(5);
        await sleep(220);
        const keepsWholeMovie=playing && satelliteLoading && satelliteFrames.length===oldMovie.length && satelliteFrames.every((frame,i)=>frame===oldMovie[i]);
        clearTimeout(playbackTimer);
        const beforeBatchTime=playbackTime;
        releaseCoverage();
        for(let i=0;i<200 && satelliteLoading;i++)await sleep(5);
        const waitsForCoverageBoundary=!!satelliteCoveragePending && satelliteFrames.every((frame,i)=>frame===oldMovie[i]) && playbackTime===beforeBatchTime;
        playbackCursor=playbackTimeline.length-1;scheduleNextFrame();await sleep(220);
        holdCoverage=false;
        const expanded=satelliteFrames.every(f=>f.geometry.bounds.contains(map.getBounds())) &&
          !priorBounds.contains(map.getBounds());
        const zoomNewestFirst=calls[beforeCoverage]?.time===newest;
        const frame=satelliteFrames[0],g=frame.geometry;
        const rect=frame.overlay.getElement().getBoundingClientRect(),mr=map.getContainer().getBoundingClientRect();
        const registrationError=Math.max(...[g.bounds.getCenter(),g.bounds.getSouthWest(),g.bounds.getNorthEast()].map(p=>{
          const q=L.CRS.EPSG3857.project(p);
          return map.latLngToContainerPoint(p).distanceTo(L.point(rect.left-mr.left+(q.x-g.bbox[0])/(g.bbox[2]-g.bbox[0])*rect.width,
            rect.top-mr.top+(g.bbox[3]-q.y)/(g.bbox[3]-g.bbox[1])*rect.height));
        }));
        stopPlayback(false);cancelSatelliteRefinement();satelliteHighEnabled=false;
        const expandedMovie=satelliteFrames.slice(),pausedTime=playbackTime;
        const workingLoader=loadSatelliteImage;
        const failedTime=+expandedMovie[0].date;
        loadSatelliteImage=async(url,signal)=>Date.parse(new URL(url).searchParams.get('time'))===failedTime ? null : workingLoader(url,signal);
        map.setZoom(map.getZoom()-1,{animate:false});clearTimeout(satelliteMoveTimer);
        await updateSatellite(false,true);
        const failedCoverageRetainsMovie=satelliteFrames.every((frame,i)=>frame===expandedMovie[i]) && satelliteCoveragePending===null && !!satelliteCoverageMessage && playbackTime===pausedTime;
        loadSatelliteImage=workingLoader;
        await updateSatellite(false,true);
        const pausedCoverageCommits=satelliteCoveragePending===null && satelliteFrames.every(frame=>!expandedMovie.includes(frame)) && playbackTime===pausedTime && satelliteFrames.every(frame=>frame.geometry.bounds.contains(map.getBounds()));
        const fullHistory=satelliteFrames.slice();
        displayPlaybackTime(+fullHistory[fullHistory.length-1].date);
        for(const frame of fullHistory.slice(0,-2)) frame.overlay.remove();
        satelliteFrames=fullHistory.slice(-2);currentSatelliteIndex=1;satelliteLoading=true;
        map.setZoom(map.getZoom()+2,{animate:false});clearTimeout(satelliteMoveTimer);
        await updateSatellite(false,true);
        const initialHistorySurvivesReframe=satelliteFrames.length===fullHistory.length && satelliteFrames.every((frame,i)=>+frame.date===+fullHistory[i].date);
        const beforeBoth=Math.min(+radarFrames[0].date,+satelliteFrames[0].date)-60000;
        displayPlaybackTime(beforeBoth);
        const noFutureFrames=!radarFrameAvailable && !satelliteLayer;
        displayPlaybackTime(newest);setRadarVisible(true);
        const radar=document.getElementById('radarFrameCounter'),sat=document.getElementById('satelliteFrameCounter');
        const sideBySide=Math.abs(radar.getBoundingClientRect().top-sat.getBoundingClientRect().top)<2 && radar.getBoundingClientRect().right<=sat.getBoundingClientRect().left;
        return {lowFinishesBeforeHigh,autoHighStarted,newestFirst,playableWhileLoading,repeatsWhileLoading,togglesContinue,arrivalsKeepClock,historyAdopted,
          lowUntilComplete,lateHighRespectsLow,waitsForBoundary,allHigh,highReadout,uniformHigh,lowInstant,lowReadout,highReuse,partialWaitsForBoundary,missingUsesLow,fallbackReported,otherFramesUseHigh,persistentCount,noAutomaticRetry,explicitRetryClearsFailure,allFailedUsesLow,retryProgressInStatus,retryHeldUntilBoundary,retryUpgradesAtBoundary,coverageKeepsClock,keepsWholeMovie,waitsForCoverageBoundary,expanded,zoomNewestFirst,failedCoverageRetainsMovie,pausedCoverageCommits,initialHistorySurvivesReframe,
          registered:registrationError<2,noFutureFrames,sideBySide,errors:testErrors};
      }finally{
        releaseHistory();releaseHigh();releaseCoverage();stopPlayback(false);cancelSatelliteRefinement();
        satelliteHighEnabled=false;loadSatelliteImage=originalLoader;setLoopUI(false);setRadarVisible(true);
        map.setView([39.0867,-9.3777],7,{animate:false});clearTimeout(satelliteMoveTimer);
      }
    })()""")
    print('PROGRESSIVE_PLAYBACK',result,flush=True)
    assert all(value for key,value in result.items() if key!='errors') and not result['errors'],result
    result=c.evaluate("""(async()=>{
      stopPlayback(false);cancelSatelliteRefinement();
      const savedFrames=satelliteFrames,savedDates=satelliteRequestedDates;
      const savedHighEnabled=satelliteHighEnabled;
      const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      const results={};
      const image=document.createElement('canvas');image.width=2;image.height=2;
      const source=image.toDataURL();
      const makeFrame=frame=>({...frame,detail:undefined,overlay:L.imageOverlay(source,frame.geometry.bounds,
        {pane:'satellitePane',opacity:0,interactive:false}).addTo(map)});
      try{
        setRadarVisible(false);
        for(const kind of ['coverage','quality'])for(const loop of [false,true]){
          satelliteFrames=savedFrames.slice(-3).map(makeFrame);
          satelliteRequestedDates=satelliteFrames.map(frame=>frame.date);
          satelliteHighEnabled=false;satelliteQualityActive='low';
          satelliteLoading=false;setLoopUI(loop);startPlayback();
          const original=satelliteFrames.slice(),clock=JSON.stringify(playbackTimeline);
          // Complete a replacement halfway through the pass, without moving its clock.
          await sleep(PLAYBACK_DELAY+25);
          if(kind==='coverage') satelliteCoveragePending={generation:satelliteGeneration,
            product:satelliteSelect.value,frames:original.map(makeFrame),stepMs:satelliteStepMs};
          else{
            satelliteHighEnabled=true;
            for(const frame of original)frame.detail={geometry:frame.geometry,overlay:makeFrame(frame).overlay};
            satelliteQualityPending=true;
          }
          const held=playing && JSON.stringify(playbackTimeline)===clock &&
            satelliteFrames.every((frame,i)=>frame===original[i]) && satelliteQualityActive==='low';
          await sleep(PLAYBACK_DELAY*2);
          const committed=kind==='coverage' ? satelliteFrames.every(frame=>!original.includes(frame)) : satelliteQualityActive==='high';
          results[kind+(loop?'Loop':'Once')]=held && committed && (loop ?
            playing && playbackCursor===0 && playbackTime===+satelliteFrames[0].date :
            !playing && playbackTime===+satelliteFrames[satelliteFrames.length-1].date);
          stopPlayback(false);cancelSatelliteRefinement();
          for(const frame of satelliteFrames){frame.overlay.remove();frame.detail?.overlay.remove();}
        }
        // An unfinished expanded view must not force a one-shot movie to repeat.
        satelliteFrames=savedFrames.slice(-3).map(makeFrame);
        satelliteRequestedDates=satelliteFrames.map(frame=>frame.date);
        satelliteHighEnabled=false;satelliteQualityActive='low';setLoopUI(false);
        startPlayback();satelliteLoading=true;
        await sleep(PLAYBACK_DELAY*3+25);
        results.unreadyCoverageFinishesOnce=!playing && playbackTime===+satelliteFrames.at(-1).date;
        satelliteLoading=false;
        satelliteCoveragePending={generation:satelliteGeneration,product:satelliteSelect.value,
          frames:satelliteFrames.map(makeFrame),stepMs:satelliteStepMs};
        commitSatelliteCoverage();
        results.lateCoverageWaitsForPlay=!playing && playbackTimer===null;
        startPlayback();results.playUsesReplacement=playing && playbackTime===+satelliteFrames[0].date;
        return {...results,errors:testErrors};
      }finally{
        satelliteLoading=false;stopPlayback(false);cancelSatelliteRefinement();
        for(const frame of satelliteFrames){frame.overlay.remove();frame.detail?.overlay.remove();}
        satelliteFrames=savedFrames;satelliteRequestedDates=savedDates;
        satelliteHighEnabled=savedHighEnabled;satelliteQualityActive='low';
        setLoopUI(false);setRadarVisible(true);displayPlaybackTime(+savedFrames.at(-1).date);
      }
    })()""")
    print('REPLACEMENT_PLAYBACK_BOUNDARIES',result,flush=True)
    assert all(value for key,value in result.items() if key!='errors') and not result['errors'],result
    result=c.evaluate("""(async()=>{
      cancelSatelliteRefinement();
      const before=satelliteCacheStats.networkLoads;
      const existing=new Set(satelliteImageCache.keys());
      const originalFetch=window.fetch;
      const requested=[];
      window.fetch=(url,options)=>{
        if(String(url).includes('request=GetMap'))requested.push(String(url));
        return originalFetch(url,options);
      };
      satelliteCatalogueTime=Date.now();
      try{await updateSatellite();}finally{window.fetch=originalFetch;}
      cancelSatelliteRefinement();
      await satelliteCacheWrites;
      const cache=await openSatelliteCache();
      const keys=cache?await cache.keys():[];
      const memoryReuse=requested.every(url=>!existing.has(url));
      const diskWritten=!!cache && keys.length>0;
      // Drop only this test's memory entries; persistent entries must still work.
      const sample=keys[0] && keys[0].url;
      let diskReuse=false;
      if(sample){
        const entry=satelliteImageCache.get(sample);
        if(entry){satelliteMemoryBytes-=entry.bytes;satelliteImageCache.delete(sample);URL.revokeObjectURL(entry.objectURL);}
        const count=satelliteCacheStats.networkLoads;
        const image=await loadSatelliteImage(sample,new AbortController().signal);
        diskReuse=!!image && satelliteCacheStats.networkLoads===count && satelliteCacheStats.diskHits>0;
      }
      satelliteOpacityControl.value='100';satelliteOpacityControl.dispatchEvent(new Event('input'));
      for(let i=0;i<50 && !mapFeatureLayer;i++)await new Promise(r=>setTimeout(r,100));
      const pane=map.getPane('mapFeaturesPane');
      const outlines=!!mapFeatureLayer && map.hasLayer(mapFeatureLayer) && pane.querySelectorAll('path').length>0 &&
        Number(pane.style.zIndex)>Number(map.getPane('satellitePane').style.zIndex) && satelliteLayer.options.opacity===1;
      return {memoryReuse,diskWritten,diskReuse,outlines,requests:requested.length,cacheStats:satelliteCacheStats,errors:testErrors};
    })()""")
    print('CACHE_AND_OUTLINES',result,flush=True)
    assert all(result[k] for k in ['memoryReuse','diskWritten','diskReuse','outlines']) and not result['errors'],result
    result=c.evaluate("""(async()=>{
      satelliteOpacityControl.value='35';satelliteOpacityControl.dispatchEvent(new Event('input'));
      radarOpacityControl.value='50';radarOpacityControl.dispatchEvent(new Event('input'));
      const opacity=satelliteOpacity===.35 && radarOpacity===.5 && satelliteLayer.options.opacity===.35;
      setRadarVisible(false);
      const satelliteOnly=!playButton.disabled && document.getElementById('radarLegend').hidden && radarOverlays.every(x=>x.options.opacity===0);
      startPlayback();await new Promise(r=>setTimeout(r,220));
      const satelliteAnimated=playing && currentSatelliteIndex>0 && currentSatelliteIndex<satelliteFrames.length;
      stopPlayback(false);
      setRadarVisible(true);
      const pairs=[];
      for(let i=0;i<radarFrames.length;i++){
        setVisibleFrame(i);
        if(satelliteLayer){
          const sat=satelliteFrames.find(f=>f.overlay===satelliteLayer);
          pairs.push(sat.date.getTime()<=radarFrames[i].date.getTime());
        }
      }
      startPlayback();await new Promise(r=>setTimeout(r,650));
      const combinedAnimated=playing && currentFrameIndex>0;
      stopPlayback(false);
      const matching=pairs.length>0 && pairs.every(Boolean);
      const latest=satelliteFrames[satelliteFrames.length-1];
      const savedTime=playbackTime;
      displayPlaybackTime(latest.date.getTime()+30*60000);
      const lagLabel=satelliteLayer===latest.overlay && satelliteStatus.textContent.includes('min before timeline');
      displayPlaybackTime(savedTime);
      satelliteSelect.value='map'; await updateSatellite();
      return {opacity,satelliteOnly,satelliteAnimated,combinedAnimated,matching,lagLabel,mapRestored:!satelliteLayer && !satelliteFrames.length && satelliteStatus.hidden,errors:testErrors};
    })()""")
    print('PLAYBACK',result,flush=True)
    assert all(result[k] for k in ['opacity','satelliteOnly','satelliteAnimated','combinedAnimated','matching','lagLabel','mapRestored']) and not result['errors'],result
    result=c.evaluate("""(async()=>{
      const originalFetch=window.fetch;
      const originalLoader=loadSatelliteImage;
      const catalogue={...satelliteCatalogue};
      try{
        satelliteSelect.value='hybrid';
        satelliteCatalogueTime=Date.now();
        await updateSatellite();
        const prior=satelliteLayer;
        const priorFrames=satelliteFrames;
        let reject;
        window.fetch=()=>new Promise((resolve,fail)=>{reject=fail;});
        const pending=updateSatellite(true);
        const visibleWhileLoading=satelliteLayer===prior && map.hasLayer(prior) && prior.options.opacity>0;
        reject(new Error('test offline'));
        await pending;
        const retainedOnFailure=satelliteLayer===prior && satelliteFrames===priorFrames && map.hasLayer(prior) && satelliteStatus.dataset.state==='error';
        window.fetch=originalFetch;
        satelliteSelect.value='map';await updateSatellite();
        satelliteSelect.value='hybrid';
        satelliteCatalogue=catalogue;satelliteCatalogueTime=Date.now();
        loadSatelliteImage=async()=>null;
        await updateSatellite();
        const imageFailure=satelliteStatus.dataset.state==='error' && !satelliteFrames.length;
        let complete;
        window.fetch=()=>new Promise(resolve=>{complete=resolve;});
        const late=updateSatellite(true);
        satelliteSelect.value='map';await updateSatellite();
        complete(new Response('<WMS_Capabilities xmlns="http://www.opengis.net/wms"/>'));
        await late;
        const staleIgnored=!satelliteFrames.length && satelliteStatus.hidden;
        return {visibleWhileLoading,retainedOnFailure,imageFailure,staleIgnored,errors:testErrors};
      }finally{window.fetch=originalFetch;loadSatelliteImage=originalLoader;}
    })()""")
    print('RECOVERY',result,flush=True)
    assert all(result[k] for k in ['visibleWhileLoading','retainedOnFailure','imageFailure','staleIgnored']) and not result['errors'],result
    result=c.evaluate("""(async()=>{
      stopPlayback(false);cancelSatelliteRefinement();
      const saved=geoColourWebGLAvailable;
      satelliteSelect.value='map';await updateSatellite();
      const originalMap=baseMapLayer,center=map.getCenter(),zoom=map.getZoom();
      const standardRestored=map.hasLayer(originalMap) && !geoColourMapState.layers.length && map.getPane('mapFeaturesPane').style.display!== 'none' && !map.attributionControl.getContainer().textContent.includes('OpenFreeMap');
      try{
        geoColourWebGLAvailable=()=>false;
        await setGeoColourMapEnabled(true);
        const fallback=map.hasLayer(originalMap) && !geoColourMapState.ready && document.getElementById('mapRenderingStatus').textContent.includes('standard map retained');
        await setGeoColourMapEnabled(false);geoColourWebGLAvailable=saved;
        await setGeoColourMapEnabled(true);
        const recovered=geoColourMapState.ready && map.getZoom()===zoom && map.getCenter().distanceTo(center)<.1;
        await setGeoColourMapEnabled(false);
        return {standardRestored,fallback,recovered,originalMapRetained:baseMapLayer===originalMap && map.hasLayer(originalMap),errors:testErrors};
      }finally{geoColourWebGLAvailable=saved;await setGeoColourMapEnabled(false);}
    })()""")
    print('MAP_SWITCH_AND_FALLBACK',result,flush=True)
    assert all(value for key,value in result.items() if key!='errors') and not result['errors'],result
    print('PASS: satellite cache, GeoColour vector map, fallback, playback, timestamp matching, and registration.',flush=True)

finally:
    chrome.terminate()
    try: chrome.wait(timeout=10)
    except subprocess.TimeoutExpired: chrome.kill()
    server.shutdown()
