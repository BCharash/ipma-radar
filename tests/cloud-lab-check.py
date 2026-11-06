#!/usr/bin/env python3
"""Isolated SkyFlow cloud-lab checks: live WMS plus controlled raster fixtures."""
import base64, http.server, json, os, pathlib, socket, struct, subprocess, sys, threading, time, urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs): super().__init__(*args, directory=str(ROOT), **kwargs)
    def log_message(self, *args): pass
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
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
    port = (profile / 'DevToolsActivePort').read_text().splitlines()[0]
    target = json.load(urllib.request.urlopen(urllib.request.Request(f'http://127.0.0.1:{port}/json/new?about:blank', method='PUT')))
    c = CDP(target['webSocketDebuggerUrl'])
    c.call('Page.enable')
    c.call('Page.addScriptToEvaluateOnNewDocument', {'source':'window.testErrors=[]; window.addEventListener("error", e=>testErrors.push(e.message)); window.addEventListener("unhandledrejection", e=>testErrors.push(String(e.reason)));'})
    c.call('Emulation.setDeviceMetricsOverride', {'width':1440,'height':1080,'deviceScaleFactor':1,'mobile':False})
    c.call('Page.navigate', {'url':f'http://127.0.0.1:{server.server_port}/labs/clouds/index.html'})
    for _ in range(450):
        ready=c.evaluate('window.cloudLab && (cloudLab.record.runs.at(-1)?.finishedUTC || document.getElementById("overall").dataset.state === "error")')
        if ready: break
        time.sleep(.2)
    result=c.evaluate('({status:document.getElementById("overall").textContent,run:cloudLab.record.runs.at(-1),errors:testErrors})')
    print('LIVE',json.dumps(result),flush=True)
    assert result['run'] and result['run']['baseline']['state']=='ready' and result['run']['masked']['state']=='ready' and not result['errors'],result
    assert result['run']['baseline']['requestedSlotUTC']==result['run']['masked']['requestedSlotUTC'],result
    assert result['run']['masked']['mask']['cloud']>0 and result['run']['masked']['mask']['clear']>0,result
    result=c.evaluate("""(async()=>{
      await cloudLab.mapFeatures.ready;
      const map=cloudLab.maps[0],panel=cloudLab.panels.baseline;
      const original=panel.overlay,originalPixels=panel.canvas.toDataURL(),runs=cloudLab.record.runs.length;
      const labels=[...map.getPane('places').querySelectorAll('.cloud-lab-place-text')].map(node=>node.textContent);
      const namedPlaces=labels.includes('Lisbon') && labels.includes('Porto');
      const roads=cloudLab.mapFeatures.states[0].roads.getLayers().some(layer=>layer.getLayers().length>0);
      const aboveImagery=['places','roads','outlines'].every(name=>+map.getPane(name).style.zIndex>+map.getPane('rain').style.zIndex);
      document.getElementById('featurePlaces').checked=false;document.getElementById('featurePlaces').dispatchEvent(new Event('change'));
      const hidePlaces=map.getPane('places').style.display==='none' && map.getPane('roads').style.display!== 'none';
      document.getElementById('featureRoads').checked=false;document.getElementById('featureRoads').dispatchEvent(new Event('change'));
      document.getElementById('featureOutlines').checked=false;document.getElementById('featureOutlines').dispatchEvent(new Event('change'));
      const hideLines=map.getPane('roads').style.display==='none' && map.getPane('outlines').style.display==='none';
      for(const name of ['featurePlaces','featureRoads','featureOutlines']){document.getElementById(name).checked=true;document.getElementById(name).dispatchEvent(new Event('change'));}
      document.getElementById('featureStrength').value='35';document.getElementById('featureStrength').dispatchEvent(new Event('input'));
      const independentStrength=['places','roads','outlines'].every(name=>map.getPane(name).style.opacity==='0.35') && panel.overlay.options.opacity===1;
      document.getElementById('featureStrength').value='85';document.getElementById('featureStrength').dispatchEvent(new Event('input'));
      const untouchedPhotograph=panel.overlay===original && panel.canvas.toDataURL()===originalPixels && cloudLab.record.runs.length===runs;
      return {namedPlaces,roads,aboveImagery,hidePlaces,hideLines,independentStrength,untouchedPhotograph,labels,errors:testErrors};
    })()""")
    print('MAP_FEATURES',result,flush=True)
    assert all(result[key] for key in ['namedPlaces','roads','aboveImagery','hidePlaces','hideLines','independentStrength','untouchedPhotograph']) and not result['errors'],result
    result=c.evaluate("""(async()=>{
      document.getElementById('maskEdges').value='blended';await cloudLab.loadComparison();
      const run=cloudLab.record.runs.at(-1);
      document.getElementById('radar').checked=true;document.getElementById('radar').dispatchEvent(new Event('change'));
      for(let i=0;i<350 && document.getElementById('radarStatus').textContent.startsWith('Loading');i++)await new Promise(resolve=>setTimeout(resolve,100));
      const radar=cloudLab.record.radar;
      const radarBeforeSelection=radar && Date.parse(radar.slotUTC)<=Date.parse(radar.selectionUTC);
      const radarRegistered=cloudLab.maps.every(map=>[...map.getPane('rain').querySelectorAll('img')].length===1);
      document.getElementById('radar').checked=false;document.getElementById('radar').dispatchEvent(new Event('change'));
      return {mask:run.masked.mask,radarBeforeSelection,radarRegistered,errors:testErrors};
    })()""")
    print('LIVE_BLEND_AND_RADAR',result,flush=True)
    assert result['mask']['blended']>0 and result['radarBeforeSelection'] and result['radarRegistered'] and not result['errors'],result
    screenshot=c.call('Page.captureScreenshot',{'format':'png'})
    pathlib.Path('/private/tmp/skyflow-cloud-lab-desktop.png').write_bytes(base64.b64decode(screenshot['data']))
    result=c.evaluate("""(async()=>{
      const m=await import('./cloud-sources.js');
      const canvas=document.createElement('canvas');canvas.width=4;canvas.height=1;
      const ctx=canvas.getContext('2d');
      ctx.putImageData(new ImageData(new Uint8ClampedArray([21,45,67,255,80,90,100,255,110,120,130,255,140,150,160,255]),4,1),0,0);
      const mask=document.createElement('canvas');mask.width=4;mask.height=1;
      mask.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray([255,255,255,255,0,192,0,255,0,0,255,255,88,77,66,255]),4,1),0,0);
      const output=m.photographicClouds(canvas,mask),pixels=output.canvas.getContext('2d').getImageData(0,0,4,1).data;
      const photographic=pixels[0]===21 && pixels[1]===45 && pixels[2]===67 && pixels[3]===255;
      const transparent=[7,11,15].every(index=>pixels[index]===0);
      const edge=document.createElement('canvas');edge.width=4;edge.height=1;
      edge.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray([128,128,255,255,0,192,0,255,0,0,255,255,0,0,0,255]),4,1),0,0);
      const blended=m.photographicClouds(canvas,edge,'blended');
      const blendedAlpha=blended.canvas.getContext('2d').getImageData(0,0,4,1).data[3];
      const paletteReconstruction=blendedAlpha===128 && blended.stats.blended===1;
      const unknownReported=output.stats.unknown===1 && output.stats.clear===2 && output.stats.cloud===1;
      mask.width=3;let mismatchedRejected=false;
      try{m.photographicClouds(canvas,mask);}catch{mismatchedRejected=true;}
      const start=Date.parse('2026-11-06T00:00:00Z');
      const data={[m.PRODUCTS.baseline]:{start,end:start+12*3600000,step:600000},
        [m.PRODUCTS.texture]:{start,end:start+12*3600000,step:900000},
        [m.PRODUCTS.mask]:{start,end:start+12*3600000,step:900000}};
      const selected=start+11*3600000+17*60000;
      const baseline=m.slotAtOrBefore(data[m.PRODUCTS.baseline],selected),masked=m.commonTime(data,[m.PRODUCTS.mask,m.PRODUCTS.texture],selected);
      const honestSlots=baseline===start+11*3600000+10*60000 && masked===start+11*3600000+15*60000;
      const common=m.commonTime(data,Object.values(m.PRODUCTS),selected);
      const alignedCommon=common===start+11*3600000;
      const g=m.geometryFor(cloudLab.maps,256),query=new URL(m.imageURL(m.PRODUCTS.mask,masked,g)).searchParams;
      const nearestMask=query.get('interpolations')==='nearest neighbor' && query.get('srs')==='EPSG:3857';
      await cloudLab.loadComparison();
      const cached=Object.values(cloudLab.record.runs.at(-1)).filter(x=>x && x.sources).every(x=>x.sources.every(s=>s.origin==='memory' || s.origin==='disk'));
      const registered=Object.values(cloudLab.panels).every(p=>cloudLab.registration(p)<2);
      const outlines=cloudLab.maps.every(map=>map.getPane('outlines').querySelectorAll('path').length>0 && +map.getPane('outlines').style.zIndex>+map.getPane('clouds').style.zIndex);
      return {photographic,transparent,paletteReconstruction,unknownReported,mismatchedRejected,honestSlots,alignedCommon,nearestMask,cached,registered,outlines,errors:testErrors};
    })()""")
    print('RENDERING',result,flush=True)
    assert all(value for key,value in result.items() if key!='errors') and not result['errors'],result
    result=c.evaluate("""(async()=>{
      const originalFetch=window.fetch;
      const queries=[];
      let release;
      const gate=new Promise(resolve=>{release=resolve;});
      const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      let block=false;
      window.fetch=async(url,options)=>{
        if(!String(url).includes('request=GetMap')) return originalFetch(url,options);
        const q=new URL(url).searchParams;queries.push(q);
        if(block)await gate;
        const canvas=document.createElement('canvas');canvas.width=+q.get('width');canvas.height=+q.get('height');
        const ctx=canvas.getContext('2d');ctx.fillStyle=q.get('layers').endsWith(':clm') ? '#fff' : '#56789a';ctx.fillRect(0,0,canvas.width,canvas.height);
        if(q.get('layers').endsWith(':clm')){ctx.fillStyle='#00c000';ctx.fillRect(0,0,Math.floor(canvas.width/2),canvas.height);}
        const blob=await new Promise(resolve=>canvas.toBlob(resolve));return new Response(blob,{headers:{'Content-Type':'image/png'}});
      };
      try{
        document.getElementById('cacheMode').value='network';
        const old=cloudLab.panels.masked.overlay;
        const before=cloudLab.record.runs.length;
        cloudLab.maps[1].panBy([180,0],{animate:false});
        const linked=cloudLab.maps.every(map=>map.getCenter().distanceTo(cloudLab.maps[0].getCenter())<.1);
        for(let i=0;i<200 && cloudLab.record.runs.length===before;i++)await sleep(10);
        for(let i=0;i<200 && !cloudLab.record.runs.at(-1)?.finishedUTC;i++)await sleep(10);
        const expanded=queries.length>=3 && cloudLab.panels.masked.overlay!==old;
        const commonGrid=queries.slice(0,3).every(q=>q.get('bbox')===queries[0].get('bbox') && q.get('width')===queries[0].get('width') && q.get('height')===queries[0].get('height'));
        block=true;
        document.getElementById('resolution').value='768';
        const delayed=cloudLab.loadComparison();await sleep(20);
        const retained=cloudLab.panels.masked.overlay && cloudLab.panels.masked.map.hasLayer(cloudLab.panels.masked.overlay) && document.getElementById('maskedStatus').textContent.includes('Previous image retained');
        document.getElementById('resolution').value='256';
        const replacement=cloudLab.loadComparison();release();await Promise.all([delayed,replacement]);
        const staleIgnored=cloudLab.panels.masked.geometry.width<=256 && cloudLab.panels.masked.geometry.height<=256;
        document.getElementById('resolution').value='768';await cloudLab.loadComparison();
        const highWorks=Math.max(cloudLab.panels.masked.geometry.width,cloudLab.panels.masked.geometry.height)===768;
        const beforeCache=queries.length;document.getElementById('cacheMode').value='cached';await cloudLab.loadComparison();
        const highCached=queries.length===beforeCache;
        document.getElementById('resolution').value='256';document.getElementById('cacheMode').value='network';await cloudLab.loadComparison();
        const prior=cloudLab.panels.masked.overlay;
        window.fetch=async(url,options)=>String(url).includes('request=GetMap') ? new Response('offline',{status:503}) : originalFetch(url,options);
        await cloudLab.loadComparison();
        const recovery=cloudLab.panels.masked.overlay===prior && document.getElementById('maskedStatus').dataset.state==='error' && document.getElementById('maskedStatus').textContent.includes('Previous image retained');
        return {linked,expanded,commonGrid,retained,staleIgnored,highWorks,highCached,recovery,errors:testErrors};
      }finally{release();window.fetch=originalFetch;}
    })()""")
    print('COVERAGE_AND_RECOVERY',result,flush=True)
    assert all(value for key,value in result.items() if key!='errors') and not result['errors'],result
    c.call('Emulation.setDeviceMetricsOverride', {'width':390,'height':844,'deviceScaleFactor':1,'mobile':True})
    c.call('Page.reload',{'ignoreCache':True})
    for _ in range(450):
        if c.evaluate('window.cloudLab && cloudLab.record.runs.at(-1)?.finishedUTC'): break
        time.sleep(.2)
    result=c.evaluate('({overflow:document.documentElement.scrollWidth>innerWidth,errors:testErrors})')
    print('MOBILE',result,flush=True)
    assert not result['overflow'] and not result['errors'],result
    screenshot=c.call('Page.captureScreenshot',{'format':'png'})
    pathlib.Path('/private/tmp/skyflow-cloud-lab-mobile.png').write_bytes(base64.b64decode(screenshot['data']))
    print('PASS: live cloud texture/mask, transparency, caching, UTC slots, registration, linked coverage, cancellation, and retained-image recovery.',flush=True)
finally:
    chrome.terminate()
    try: chrome.wait(timeout=10)
    except subprocess.TimeoutExpired: chrome.kill()
    server.shutdown()
