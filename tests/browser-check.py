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
    result=c.evaluate("(async()=>{historySelect.value='1'; await rebuildRadar();return {frames:radarFrames.length,errors:testErrors};})()")
    print('RADAR',result,flush=True)
    assert result['frames'] > 1 and not result['errors']
    for mode in (['hybrid'] if '--quick' in sys.argv else ['hybrid','visible','infrared']):
        result = c.evaluate("""(async () => {
          satelliteSelect.value = %s;
          await updateSatellite(true);
          return {mode:satelliteSelect.value,state:satelliteStatus.dataset.state,status:satelliteStatus.textContent,
            frames:satelliteFrames.length,loading:satelliteLoading,errors:testErrors,
            satelliteOpacity:satelliteOpacity,radarFrames:radarFrames.length};
        })()""" % json.dumps(mode))
        print('SATELLITE', result, flush=True)
        assert result['state'] == 'ready' and result['frames'] > 1 and not result['errors'], result
        if mode == 'hybrid':
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
      const savedDate=radarFrames[currentFrameIndex].date;
      radarFrames[currentFrameIndex].date=new Date(latest.date.getTime()+30*60000);
      syncSatelliteToRadar();
      const lagLabel=satelliteLayer===latest.overlay && satelliteStatus.textContent.includes('min before radar');
      radarFrames[currentFrameIndex].date=savedDate;
      syncSatelliteToRadar();
      satelliteSelect.value='map'; await updateSatellite();
      return {opacity,satelliteOnly,satelliteAnimated,combinedAnimated,matching,lagLabel,mapRestored:!satelliteLayer && !satelliteFrames.length && satelliteStatus.hidden,errors:testErrors};
    })()""")
    print('PLAYBACK',result,flush=True)
    assert all(result[k] for k in ['opacity','satelliteOnly','satelliteAnimated','combinedAnimated','matching','lagLabel','mapRestored']) and not result['errors'],result
    result=c.evaluate("""(async()=>{
      const originalFetch=window.fetch;
      const originalLoader=loadSatelliteImage;
      try{
        satelliteSelect.value='hybrid';
        window.fetch=async()=>{throw new Error('test offline');};
        await updateSatellite(true);
        const offline=satelliteStatus.dataset.state==='error' && !satelliteFrames.length && radarFrames.length>0;
        window.fetch=originalFetch;
        loadSatelliteImage=async()=>null;
        await updateSatellite();
        const imageFailure=satelliteStatus.dataset.state==='error' && !satelliteFrames.length;
        let complete;
        window.fetch=()=>new Promise(resolve=>{complete=resolve;});
        const pending=updateSatellite(true);
        satelliteSelect.value='map';await updateSatellite();
        complete(new Response('<WMS_Capabilities xmlns="http://www.opengis.net/wms"/>'));
        await pending;
        const staleIgnored=!satelliteFrames.length && satelliteStatus.hidden;
        return {offline,imageFailure,staleIgnored,errors:testErrors};
      }finally{window.fetch=originalFetch;loadSatelliteImage=originalLoader;}
    })()""")
    print('RECOVERY',result,flush=True)
    assert all(result[k] for k in ['offline','imageFailure','staleIgnored']) and not result['errors'],result
    print('PASS: live history, opacity, standalone/combined animation, projection registration after pan/zoom, and recovery.',flush=True)

finally:
    chrome.terminate()
    try: chrome.wait(timeout=10)
    except subprocess.TimeoutExpired: chrome.kill()
    server.shutdown()
