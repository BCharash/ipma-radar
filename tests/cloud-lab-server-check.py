#!/usr/bin/env python3
"""Check the local connector without network access or real credentials."""
import base64,importlib.util,io,json,pathlib,threading,types,unittest,urllib.parse
from collections import OrderedDict
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('lab_server',pathlib.Path(__file__).resolve().parents[1]/'scripts/serve-cloud-lab.py')
lab=importlib.util.module_from_spec(spec);spec.loader.exec_module(lab)
QUERY=urllib.parse.urlencode({'time':'2026-11-06T12:00:00Z','bbox':'-1500000,3900000,-600000,5600000','width':'256','height':'256'})
class Tests(unittest.TestCase):
    def handler(self,path='/__lab/status',configured=False,headers=None):
        handler=object.__new__(lab.LabHandler);handler.path=path
        handler.headers={'Host':'127.0.0.1:8766',**(headers or {})}
        handler.server=types.SimpleNamespace(server_port=8766,provider_username='fixture-user' if configured else '',provider_password='fixture-password' if configured else '',
            provider_slots=threading.BoundedSemaphore(2),cache_lock=threading.Lock(),provider_cache=OrderedDict())
        handler.results=[];handler.reply=lambda *args:handler.results.append(args)
        return handler
    def test_fixed_source_and_projection(self):
        url=urllib.parse.urlsplit(lab.provider_url(QUERY));q=urllib.parse.parse_qs(url.query)
        self.assertEqual(url.netloc,'api.meteomatics.com');self.assertEqual(q['LAYERS'],['sat_cloud_layer:idx'])
        self.assertEqual(q['CRS'],['EPSG:3857']);self.assertEqual(q['BBOX'],['-1500000.0,3900000.0,-600000.0,5600000.0'])
        self.assertNotIn('fixture-password',url)
    def test_reject_invalid_queries(self):
        for query in [QUERY+'&url=https://other.invalid',QUERY+'&width=10',QUERY.replace('width=256','width=9999'),QUERY.replace('-1500000','nan'),QUERY.replace('-1500000','999999999')]:
            with self.assertRaises(ValueError):lab.provider_url(query)
    def test_no_credentials_status(self):
        handler=self.handler();handler.do_GET();self.assertEqual(handler.results,[(200,{'meteomaticsConfigured':False})])
        handler=self.handler('/__lab/meteomatics?'+QUERY);handler.do_GET();self.assertEqual(handler.results[0][0],503)
    def test_cross_site_and_bad_host(self):
        for headers in [{'Sec-Fetch-Site':'cross-site'},{'Origin':'https://other.invalid'},{'Host':'other.invalid:8766'}]:
            handler=self.handler(configured=True,headers=headers);handler.do_GET();self.assertEqual(handler.results[0][0],403)
    def test_credentials_only_in_upstream_header_and_memory_cache(self):
        handler=self.handler('/__lab/meteomatics?'+QUERY,True)
        png=b'\x89PNG\r\n\x1a\nfixture'
        class Opener:
            def open(self,request,timeout):
                self.request=request;return io.BytesIO(png)
        opener=Opener()
        with patch.object(lab.urllib.request,'build_opener',return_value=opener) as build:
            handler.do_GET();handler.do_GET()
        self.assertEqual(build.call_count,1);self.assertEqual(handler.results[0],(200,png,'image/png'))
        expected='Basic '+base64.b64encode(b'fixture-user:fixture-password').decode()
        self.assertEqual(opener.request.get_header('Authorization'),expected)
        self.assertNotIn('fixture-password',str(handler.results));self.assertNotIn('fixture-user',opener.request.full_url)
if __name__=='__main__':unittest.main()
