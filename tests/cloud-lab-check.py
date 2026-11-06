#!/usr/bin/env python3
"""Isolated SkyFlow cloud-lab checks: live WMS plus controlled raster fixtures."""
import base64, http.server, json, os, pathlib, socket, struct, subprocess, sys, threading, time, urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
import importlib.util
spec=importlib.util.spec_from_file_location('cloud_lab_server',ROOT/'scripts/serve-cloud-lab.py')
lab_server=importlib.util.module_from_spec(spec);spec.loader.exec_module(lab_server)
server=lab_server.LabServer(('127.0.0.1',0))
threading.Thread(target=server.serve_forever,daemon=True).start()
profile = pathlib.Path('/private/tmp') / ('skyflow-cloud-lab-browser-' + str(os.getpid()))
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
    port=(profile/'DevToolsActivePort').read_text().splitlines()[0]
    target=json.load(urllib.request.urlopen(urllib.request.Request(f'http://127.0.0.1:{port}/json/new?about:blank',method='PUT')))
    c=CDP(target['webSocketDebuggerUrl'])
    c.call('Page.enable')
    c.call('Page.addScriptToEvaluateOnNewDocument',{'source':'window.testErrors=[];window.addEventListener("error",e=>testErrors.push(e.message));window.addEventListener("unhandledrejection",e=>testErrors.push(String(e.reason)));'})
    c.call('Emulation.setDeviceMetricsOverride',{'width':1440,'height':1080,'deviceScaleFactor':1,'mobile':False})
    c.call('Page.navigate',{'url':f'http://127.0.0.1:{server.server_port}/labs/clouds/'})
    for _ in range(450):
        if c.evaluate('window.cloudLab && cloudLab.record.runs.at(-1)?.finishedUTC'): break
        time.sleep(.2)
    result=c.evaluate('({status:document.getElementById("overall").textContent,run:cloudLab.record.runs.at(-1),vector:document.getElementById("vectorMapStatus").textContent,errors:testErrors})')
    print('LIVE',json.dumps(result),flush=True)
    assert result['run']['baseline']['state']=='ready' and result['run']['vector']['state']=='ready' and not result['errors'],result
    result=c.evaluate("""(async()=>{
      const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      const {panels,renderers}=cloudLab,gl=renderers.vector.gl;
      for(let i=0;i<150 && !gl.areTilesLoaded();i++)await sleep(100);
      const sharedPixels=panels.baseline.canvas===panels.vector.canvas && panels.baseline.time===panels.vector.time;
      const order=gl.getStyle().layers.map(layer=>layer.id),cloudIndex=order.indexOf('skyflow-clouds');
      const contextAbove=renderers.vector.context.every(layer=>order.indexOf(layer.id)>cloudIndex);
      const detailedFeatures=gl.queryRenderedFeatures().some(feature=>['transportation','place','transportation_name'].includes(feature.sourceLayer));
      const registered=Object.values(panels).filter(panel=>panel.time!==undefined).every(panel=>cloudLab.registration(panel)<2);
      const prior=panels.vector.canvas,runs=cloudLab.record.runs.length;
      document.getElementById('featurePlaces').checked=false;document.getElementById('featurePlaces').dispatchEvent(new Event('change'));
      const labelLayers=renderers.vector.context.filter(layer=>layer.type==='symbol');
      const labelsHidden=labelLayers.every(layer=>gl.getLayoutProperty(layer.id,'visibility')==='none');
      document.getElementById('featurePlaces').checked=true;document.getElementById('featurePlaces').dispatchEvent(new Event('change'));
      document.getElementById('featureStrength').value='35';document.getElementById('featureStrength').dispatchEvent(new Event('input'));
      const independent=gl.getPaintProperty('skyflow-clouds','raster-opacity')===1 && panels.vector.canvas===prior && cloudLab.record.runs.length===runs;
      document.getElementById('featureStrength').value='85';document.getElementById('featureStrength').dispatchEvent(new Event('input'));
      document.getElementById('opacity').value='40';document.getElementById('opacity').dispatchEvent(new Event('input'));
      const fade=gl.getPaintProperty('skyflow-clouds','raster-opacity')===.4 && panels.baseline.overlay.options.opacity===.4;
      document.getElementById('opacity').value='100';document.getElementById('opacity').dispatchEvent(new Event('input'));
      await sleep(800);
      const textLayers=labelLayers.filter(layer=>layer.layout?.['text-field']).map(layer=>layer.id);
      const renderedText=gl.queryRenderedFeatures(undefined,{layers:textLayers}).length>0;
      return {sharedPixels,contextAbove,detailedFeatures,renderedText,registered,labelsHidden,independent,fade,vectorErrors:renderers.vector.errors,providerInactive:document.getElementById('providerEnabled').disabled,errors:testErrors};
    })()""")
    print('VECTOR_COMPARISON',result,flush=True)
    assert all(value for key,value in result.items() if key not in ['errors','vectorErrors']) and not result['errors'] and not result['vectorErrors'],result
    screenshot=c.call('Page.captureScreenshot',{'format':'png'})
    pathlib.Path('/private/tmp/skyflow-cloud-lab-desktop.png').write_bytes(base64.b64decode(screenshot['data']))
    result=c.evaluate("""(async()=>{
      const originalFetch=window.fetch,calls=[];let release;
      const gate=new Promise(resolve=>{release=resolve;});let delayed=false;
      window.fetch=async(url,options)=>{
        const address=String(url);
        if(address==='/__lab/status') return new Response(JSON.stringify({meteomaticsConfigured:true}),{headers:{'Content-Type':'application/json'}});
        if(address.includes('request=GetMap') || address.startsWith('/__lab/meteomatics?')){
          const q=new URL(address,location.href).searchParams;calls.push({provider:address.startsWith('/__lab/'),query:[...q.keys()],width:+q.get('width'),bbox:q.get('bbox')});
          if(delayed)await gate;
          const canvas=document.createElement('canvas');canvas.width=+q.get('width');canvas.height=+q.get('height');
          const ctx=canvas.getContext('2d');ctx.fillStyle='#789abc';ctx.fillRect(canvas.width/2,0,canvas.width/2,canvas.height);
          const blob=await new Promise(resolve=>canvas.toBlob(resolve));return new Response(blob,{headers:{'Content-Type':'image/png'}});
        }
        return originalFetch(url,options);
      };
      try {
        await cloudLab.checkProvider();document.getElementById('providerEnabled').checked=true;
        document.getElementById('cacheMode').value='network';await cloudLab.loadComparison();
        const provider=cloudLab.record.runs.at(-1).provider;
        const providerConnected=provider.state==='ready' && provider.product==='sat_cloud_layer:idx' && cloudLab.renderers.provider.gl.getSource('skyflow-clouds');
        const noCredentials=calls.filter(call=>call.provider).every(call=>call.query.every(key=>['time','bbox','width','height'].includes(key)));
        const sharedGrid=calls.every(call=>call.bbox===calls[0].bbox);
        const prior=cloudLab.panels.vector.canvas;
        delayed=true;document.getElementById('resolution').value='768';const old=cloudLab.loadComparison();
        await new Promise(resolve=>setTimeout(resolve,20));
        const retained=cloudLab.panels.vector.canvas===prior && document.getElementById('vectorStatus').textContent.includes('Previous image retained');
        document.getElementById('resolution').value='256';const newer=cloudLab.loadComparison();release();await Promise.all([old,newer]);
        const staleIgnored=Math.max(cloudLab.panels.vector.geometry.width,cloudLab.panels.vector.geometry.height)===256;
        const before=cloudLab.record.runs.length;
        cloudLab.maps[1].panBy([100,0],{animate:false});
        const linked=cloudLab.maps.every(map=>map.getCenter().distanceTo(cloudLab.maps[0].getCenter())<.1);
        for(let i=0;i<200 && cloudLab.record.runs.length===before;i++)await new Promise(resolve=>setTimeout(resolve,10));
        for(let i=0;i<200 && !cloudLab.record.runs.at(-1).finishedUTC;i++)await new Promise(resolve=>setTimeout(resolve,10));
        const expanded=cloudLab.record.runs.length>before;
        cloudLab.maps[1].setView([38.72,-9.14],17,{animate:false});
        const gl=cloudLab.renderers.vector.gl;
        await new Promise(resolve=>setTimeout(resolve,800));
        for(let i=0;i<200 && !gl.areTilesLoaded();i++)await new Promise(resolve=>setTimeout(resolve,100));
        const streetDetail=gl.queryRenderedFeatures().some(feature=>feature.sourceLayer==='transportation_name' && feature.properties.name);
        const zoomAligned=cloudLab.maps.every(map=>map.getZoom()===17) && cloudLab.registration(cloudLab.panels.vector)<2;
        return {streetDetail,zoomAligned,zoomDiagnostic:{imageError:cloudLab.registration(cloudLab.panels.vector),viewportError:cloudLab.renderers.vector.registration(cloudLab.maps[1].getBounds()),glZoom:gl.getZoom(),leafletZoom:cloudLab.maps[1].getZoom()},providerConnected:!!providerConnected,noCredentials,sharedGrid,retained,staleIgnored,linked,expanded,errors:testErrors};
      } finally {release();window.fetch=originalFetch;}
    })()""")
    print('PROVIDER_AND_COVERAGE',result,flush=True)
    assert all(value for key,value in result.items() if key!='errors') and not result['errors'],result
    c.call('Emulation.setDeviceMetricsOverride',{'width':390,'height':844,'deviceScaleFactor':1,'mobile':True})
    c.evaluate('cloudLab.maps.forEach(map=>map.invalidateSize())')
    time.sleep(1)
    result=c.evaluate('({overflow:document.documentElement.scrollWidth>innerWidth,errors:testErrors})')
    print('MOBILE',result,flush=True)
    assert not result['overflow'] and not result['errors'],result
    print('PASS: live vector map, shared GeoColour, context above imagery, opacity, registration, provider fixtures, cancellation and coverage.',flush=True)
finally:
    chrome.terminate()
    try:chrome.wait(timeout=10)
    except subprocess.TimeoutExpired:chrome.kill()
    server.shutdown()
