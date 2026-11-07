#!/usr/bin/env python3
"""Deterministic sky-header Chrome checks with mocked weather and startup GPS.

Run on macOS: python3 tests/sky-header-check.py
Uses isolated Chrome, a local server, and public map/browser assets.
"""
import base64, http.server, json, os, pathlib, socket, struct, subprocess, sys, threading, time, urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs): super().__init__(*args, directory=str(ROOT), **kwargs)
    def log_message(self, *args): pass
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
profile = pathlib.Path('/private/tmp') / ('ipma-sky-browser-' + str(os.getpid()))
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
    c.call('Page.addScriptToEvaluateOnNewDocument', {'source': """
      window.skyTestGpsCalls=0;window.skyTestWeatherCalls=0;
      navigator.geolocation.getCurrentPosition=(success,failure)=>{
        skyTestGpsCalls++;setTimeout(()=>location.search.includes('deny') ? failure({code:1}) :
          success({coords:{latitude:38.72,longitude:-9.14,accuracy:20}}),20);
      };
      const realFetch=window.fetch;
      window.fetch=(url,options)=>{
        if(String(url).startsWith('https://api.open-meteo.com/')){
          skyTestWeatherCalls++;
          return Promise.resolve({ok:true,json:async()=>({current:{time:Math.floor(Date.now()/1000),
            temperature_2m:18,cloud_cover:60,cloud_cover_low:60,cloud_cover_mid:20,cloud_cover_high:10,weather_code:2}})});
        }
        return realFetch(url,options);
      };
    """})
    c.call('Page.navigate', {'url':f'http://127.0.0.1:{server.server_port}/index.html'})
    for _ in range(200):
        if c.evaluate('typeof initializeSatellite === "function" && typeof radarFrames !== "undefined" && !!map'): break
        time.sleep(.2)

    for _ in range(100):
        if c.evaluate('typeof liveWeatherData!=="undefined" && !!liveWeatherData'): break
        time.sleep(.1)
    result=c.evaluate("""(()=>{
      cancelSatellitePreload();clearInterval(skyWeatherTimer);clearInterval(skyMinuteTimer);
      const results={singleGps:skyTestGpsCalls===1,singleWeather:skyTestWeatherCalls===1,
        startupLocation:currentSkyCoords.lat===38.72 && currentSkyCoords.lon===-9.14};
      const initial=JSON.stringify(currentSkyCoords);resolveSkyStartupLocation(40,-8,true);
      results.fixedLocation=JSON.stringify(currentSkyCoords)===initial;
      const startupPatch=Array.from(document.querySelectorAll('#skyLowClouds .sky-cloud-patch')).find(e=>e.style.opacity==='1');
      results.instantStartup=!!startupPatch && getComputedStyle(startupPatch).opacity==='1' &&
        getComputedStyle(document.getElementById('skyLowClouds')).opacity==='0.95' &&
        document.querySelectorAll('.cloud-layer').length===3 &&
        !Array.from(document.querySelectorAll('.sky-cloud-patch, .cloud-layer > g')).some(e=>e.getAnimations().some(a=>a instanceof CSSTransition));
      results.laterTransitions=getComputedStyle(startupPatch).transitionDuration.split(',').every(s=>s.trim()==='5s');
      const clear=getSkyPalette(40,{total:0,low:0,mid:0,high:0,weatherCode:0});
      results.clearHasNoClouds=clear.lowOpacity===0 && clear.midOpacity===0 && clear.highOpacity===0;
      const high=getSkyPalette(40,{total:100,low:0,mid:0,high:100,weatherCode:3});
      const mid=getSkyPalette(40,{total:60,low:0,mid:60,high:0,weatherCode:2});
      results.independentTiers=high.highOpacity===.75 && high.lowOpacity===0 && high.midOpacity===0 &&
        mid.midOpacity===.85 && mid.lowOpacity===0 && mid.highOpacity===0;
      const low=document.getElementById('skyLowClouds');
      const amount=()=>Array.from(low.children).reduce((n,e)=>n+Number(e.firstElementChild.style.opacity),0);
      renderSkyClouds(low,'low',20,.95);const small=amount(),first=low.firstElementChild;
      renderSkyClouds(low,'low',60,.95);const medium=amount();
      renderSkyClouds(low,'low',95,.95);const large=amount();
      results.coverageGrowth=Math.abs(small-4.8)<.001 && Math.abs(medium-14.4)<.001 && Math.abs(large-22.8)<.001;
      results.stablePatches=low.children.length===24 && low.firstElementChild===first;
      const tiers=['skyHighClouds','skyMidClouds','skyLowClouds'].map(id=>document.getElementById(id));
      results.distinctLayouts=new Set(tiers.map(e=>e.firstElementChild.getAttribute('transform'))).size===3;
      const drifts=Array.from(document.querySelectorAll('.cloud-layer')).map(e=>{
        const animation=e.getAnimations()[0],previous=animation.currentTime;
        animation.pause();animation.currentTime=0;
        const start=new DOMMatrix(getComputedStyle(e).transform).m41;
        animation.currentTime=10000;
        const delta=new DOMMatrix(getComputedStyle(e).transform).m41-start;
        animation.currentTime=previous;animation.play();return delta;
      });
      results.independentDrift=drifts[0]>0 && drifts[1]>drifts[0] && drifts[2]<0;
      renderSkyClouds(low,'low',0,0);results.zeroFootprint=amount()===0;
      results.intensity=getSkyCondition(61).intensity==='light' && getSkyCondition(63).intensity==='moderate' &&
        getSkyCondition(65).intensity==='heavy' && getSkyCondition(71).intensity==='light' &&
        getSkyCondition(75).intensity==='heavy' && getSkyCondition(51).drizzle;
      const oldSolar=getSolarElevation;getSolarElevation=()=>40;
      updateSkyTheme();
      results.dayStarsHidden=getComputedStyle(document.getElementById('skyStarsLayer')).display==='none';
      const badge=document.getElementById('skyWeatherBadge');badge.hidden=true;
      results.hiddenBadge=getComputedStyle(badge).display==='none';updateSkyTheme();
      results.precipitation=true;
      for(const code of [0,51,56,61,66,71,77,80,85,95,96,999]){
        liveWeatherData.weatherCode=code;updateSkyTheme();
        const kind=getSkyCondition(code).precipitation;
        const rain=getComputedStyle(document.getElementById('skyRainLayer')).display!=='none';
        const snow=getComputedStyle(document.getElementById('skySnowLayer')).display!=='none';
        results.precipitation &&=rain===(kind==='rain') && snow===(kind==='snow');
      }
      results.freezingAndSnow=getWeatherConditionName(66)==='Freezing Rain' &&
        getWeatherConditionName(85)==='Snow Showers' && getSkyCondition(75).precipitation==='snow' &&
        getWeatherIcon(999,true)==='';
      liveWeatherData.weatherCode=0;getSolarElevation=()=>-20;updateSkyTheme();
      results.clearNightStars=getComputedStyle(document.getElementById('skyStarsLayer')).display!=='none';
      liveWeatherData.total=100;updateSkyTheme();
      results.overcastHidesStars=getComputedStyle(document.getElementById('skyStarsLayer')).display==='none';
      getSolarElevation=oldSolar;
      const t=Date.now();liveWeatherData.timestamp=t-20*60000;liveWeatherData.conditionTime=t-20*60000;
      updateSkyTheme();results.staleLabel=badge.textContent.includes('stale');
      liveWeatherData.timestamp=t-61*60000;liveWeatherData.conditionTime=t-61*60000;liveWeatherData.weatherCode=75;
      updateSkyTheme();results.expiry=badge.textContent==='Weather unavailable' &&
        document.getElementById('skySnowLayer').hidden && document.getElementById('skyLowClouds').getAttribute('opacity')==='0.00';
      results.source=!!map.attributionControl.getContainer().querySelector('a[href="https://open-meteo.com/"]') &&
        !document.getElementById('header').querySelector('a[href="https://open-meteo.com/"]');
      return results;
    })()""")
    print('SKY_RENDERING',result,flush=True)
    assert all(result.values()),result
    result=c.evaluate("""(async()=>{
      localStorage.removeItem(WEATHER_CACHE_KEY);liveWeatherData=null;
      const originalFetch=fetch, pending=[];
      fetch=(url,options)=>new Promise(resolve=>pending.push({resolve,signal:options.signal}));
      const reply=temp=>({ok:true,json:async()=>({current:{time:Math.floor(Date.now()/1000),temperature_2m:temp,
        cloud_cover:0,cloud_cover_low:0,cloud_cover_mid:0,cloud_cover_high:0,weather_code:0}})});
      try{
        currentSkyCoords={lat:39,lon:-8};const old=fetchLiveWeather(39,-8);
        currentSkyCoords={lat:37,lon:-9};const recent=fetchLiveWeather(37,-9);
        pending[1].resolve(reply(25));await recent;pending[0].resolve(reply(10));await old;
        const rejectedOld=liveWeatherData.temperature===25 && liveWeatherData.lat===37 && pending[0].signal.aborted;
        const count=pending.length;await fetchLiveWeather(37,-9);
        const cacheReuse=pending.length===count;
        localStorage.removeItem(WEATHER_CACHE_KEY);liveWeatherData=null;
        fetch=async()=>({ok:true,json:async()=>({current:{time:null,temperature_2m:99}})});
        await fetchLiveWeather(37,-9);const invalidRejected=liveWeatherData===null;
        fetch=async()=>{throw new Error('offline')};await fetchLiveWeather(37,-9);
        const offline=document.getElementById('skyWeatherBadge').textContent==='Weather unavailable';
        return {rejectedOld,cacheReuse,invalidRejected,offline};
      }finally{fetch=originalFetch;}
    })()""")
    print('SKY_WEATHER',result,flush=True)
    assert all(result.values()),result
    c.call('Emulation.setEmulatedMedia',{'features':[{'name':'prefers-reduced-motion','value':'reduce'}]})
    assert c.evaluate("getComputedStyle(document.querySelector('.sky-cloud-patch')).transitionDuration==='0s'")
    assert c.evaluate("['.cloud-layer','.sky-rain-layer','.sky-snow-layer','.star'].every(s=>getComputedStyle(document.querySelector(s)).animationName==='none')")
    assert c.evaluate('document.documentElement.scrollWidth<=innerWidth && testErrors.length===0')
    c.call('Page.navigate',{'url':f'http://127.0.0.1:{server.server_port}/index.html?deny'})
    for _ in range(100):
        if c.evaluate('typeof liveWeatherData!=="undefined" && !!liveWeatherData'): break
        time.sleep(.1)
    assert c.evaluate('skyTestGpsCalls===1 && currentSkyCoords.lat===DEFAULT_LOCATION.lat && currentSkyCoords.lon===DEFAULT_LOCATION.lon && skyLocationLabel==="Default map location"')
    print('PASS: startup location, fallback, clouds, rain/snow, visibility, stale/expired data, races, cache, reduced motion and mobile layout.',flush=True)
finally:
    chrome.terminate()
    server.shutdown()
