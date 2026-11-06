#!/usr/bin/env python3
"""Local SkyFlow lab server; optional Meteomatics credentials stay in environment."""
import argparse,base64,datetime,getpass,http.server,json,math,os,pathlib,threading,urllib.error,urllib.parse,urllib.request
from collections import OrderedDict
ROOT=pathlib.Path(__file__).resolve().parents[1]

def provider_url(query):
    values=urllib.parse.parse_qs(query,strict_parsing=True)
    if set(values)!={'time','bbox','width','height'} or any(len(v)!=1 for v in values.values()):raise ValueError('Invalid query fields')
    width,height=(int(values[key][0]) for key in ['width','height'])
    if not 2<=width<=1024 or not 2<=height<=1024:raise ValueError('Image size outside lab limits')
    bbox=[float(value) for value in values['bbox'][0].split(',')]
    if len(bbox)!=4 or not all(math.isfinite(v) and abs(v)<=20037509 for v in bbox) or bbox[0]>=bbox[2] or bbox[1]>=bbox[3]:raise ValueError('Invalid projected bounds')
    time=datetime.datetime.fromisoformat(values['time'][0].replace('Z','+00:00'))
    if time.tzinfo is None:raise ValueError('UTC offset required')
    params={'VERSION':'1.3.0','REQUEST':'GetMap','LAYERS':'sat_cloud_layer:idx','CRS':'EPSG:3857',
        'BBOX':','.join(str(value) for value in bbox),'WIDTH':width,'HEIGHT':height,'FORMAT':'image/png',
        'TIME':time.astimezone(datetime.timezone.utc).isoformat(),'TRANSPARENT':'true'}
    return 'https://api.meteomatics.com/wms?'+urllib.parse.urlencode(params)

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None

class LabHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(ROOT),**kwargs)
    def log_message(self,*args):pass
    def reply(self,status,data,kind='application/json'):
        if not isinstance(data,bytes):data=json.dumps(data).encode()
        self.send_response(status);self.send_header('Content-Type',kind);self.send_header('Content-Length',str(len(data)))
        self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff');self.end_headers()
        try:self.wfile.write(data)
        except (BrokenPipeError,ConnectionResetError):pass
    def do_GET(self):
        parsed=urllib.parse.urlsplit(self.path)
        if not parsed.path.startswith('/__lab/'):
            if any(part.startswith('.') for part in urllib.parse.unquote(parsed.path).split('/') if part):return self.reply(403,{'error':'Not served'})
            return super().do_GET()
        host=self.headers.get('Host','')
        if host not in [f'127.0.0.1:{self.server.server_port}',f'localhost:{self.server.server_port}']:return self.reply(403,{'error':'Local access only'})
        if self.headers.get('Sec-Fetch-Site')=='cross-site' or self.headers.get('Origin',f'http://{host}')!=f'http://{host}':return self.reply(403,{'error':'Same-origin access only'})
        configured=bool(self.server.provider_username and self.server.provider_password)
        if parsed.path=='/__lab/status':return self.reply(200,{'meteomaticsConfigured':configured})
        if parsed.path!='/__lab/meteomatics':return self.reply(404,{'error':'Unknown lab endpoint'})
        if not configured:return self.reply(503,{'error':'Meteomatics credentials are not configured on the local lab server'})
        try:url=provider_url(parsed.query)
        except (ValueError,TypeError,OverflowError):return self.reply(400,{'error':'Invalid time, size or projected bounds'})
        if not self.server.provider_slots.acquire(blocking=False):return self.reply(429,{'error':'Two provider requests already running; try again shortly'})
        try:
            with self.server.cache_lock:
                data=self.server.provider_cache.get(url)
            if data is None:
                credentials=(self.server.provider_username+':'+self.server.provider_password).encode()
                request=urllib.request.Request(url,headers={'Authorization':'Basic '+base64.b64encode(credentials).decode(),'User-Agent':'SkyFlow-local-cloud-lab'})
                response=urllib.request.build_opener(NoRedirect()).open(request,timeout=25)
                with response:
                    data=response.read(10*1024*1024+1)
                    if len(data)>10*1024*1024 or not data.startswith(b'\x89PNG\r\n\x1a\n'):return self.reply(502,{'error':'Provider returned an exception or unsupported image'})
                with self.server.cache_lock:
                    self.server.provider_cache[url]=data
                    while len(self.server.provider_cache)>16 or sum(map(len,self.server.provider_cache.values()))>32*1024*1024:self.server.provider_cache.popitem(last=False)
            return self.reply(200,data,'image/png')
        except urllib.error.HTTPError as error:return self.reply(502,{'error':f'Meteomatics returned HTTP {error.code}; verify satellite access on your account'})
        except Exception:return self.reply(502,{'error':'Meteomatics request failed or timed out; check the connection and account access'})
        finally:self.server.provider_slots.release()

class LabServer(http.server.ThreadingHTTPServer):
    daemon_threads=True
    def __init__(self,address):
        super().__init__(address,LabHandler)
        self.provider_username=os.environ.get('METEOMATICS_USERNAME','')
        self.provider_password=os.environ.get('METEOMATICS_PASSWORD','')
        self.provider_slots=threading.BoundedSemaphore(2);self.cache_lock=threading.Lock();self.provider_cache=OrderedDict()

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--port',type=int,default=8766)
    parser.add_argument('--prompt',action='store_true',help='Read account credentials interactively without saving them')
    args=parser.parse_args()
    if args.prompt:
        os.environ['METEOMATICS_USERNAME']=input('Meteomatics username: ').strip()
        os.environ['METEOMATICS_PASSWORD']=getpass.getpass('Meteomatics password: ')
    server=LabServer(('127.0.0.1',args.port))
    print(f'Cloud lab: http://127.0.0.1:{server.server_port}/labs/clouds/')
    print('Meteomatics: '+('configured (access not yet tested)' if server.provider_username and server.provider_password else 'not configured; vector comparison works without credentials'))
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()
