#!/usr/bin/env python3
"""Build regional lab labels/roads from pinned public-domain Natural Earth data."""
import argparse,json,pathlib,tempfile,urllib.request
REVISION='ca96624a56bd078437bca8184e78163e5039ad19'
BOUNDS=(-40,25,15,55)
ROOT=pathlib.Path(__file__).resolve().parents[1]

def clip_segment(a,b):
    x,y=a;dx=b[0]-x;dy=b[1]-y;low,high=0.,1.
    for p,q in [(-dx,x-BOUNDS[0]),(dx,BOUNDS[2]-x),(-dy,y-BOUNDS[1]),(dy,BOUNDS[3]-y)]:
        if p==0:
            if q<0:return None
        else:
            r=q/p
            if p<0:low=max(low,r)
            else:high=min(high,r)
            if low>high:return None
    return [[round(x+low*dx,5),round(y+low*dy,5)],[round(x+high*dx,5),round(y+high*dy,5)]]

def clip_line(line):
    parts=[];current=[]
    for a,b in zip(line,line[1:]):
        clipped=clip_segment(a,b)
        if not clipped:
            if len(current)>1:parts.append(current)
            current=[];continue
        a,b=clipped
        if current and current[-1]!=a:
            if len(current)>1:parts.append(current)
            current=[]
        if not current:current=[a]
        if current[-1]!=b:current.append(b)
    if len(current)>1:parts.append(current)
    return parts

def build(source_dir):
    collections={}
    for name in ['ne_10m_populated_places','ne_10m_roads']:
        path=source_dir/(name+'.geojson')
        if not path.exists():
            source_dir.mkdir(parents=True,exist_ok=True)
            with urllib.request.urlopen(f'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/{REVISION}/geojson/{name}.geojson',timeout=90) as response:
                path.write_bytes(response.read())
        collections[name]=json.loads(path.read_text())['features']
    places=[];roads=[]
    for feature in collections['ne_10m_populated_places']:
        x,y=feature['geometry']['coordinates'];p=feature['properties']
        if BOUNDS[0]<=x<=BOUNDS[2] and BOUNDS[1]<=y<=BOUNDS[3]:
            places.append({'type':'Feature','geometry':{'type':'Point','coordinates':[round(x,5),round(y,5)]},
                'properties':{'name':p['NAME'],'minZoom':p['MIN_ZOOM'],'population':p['POP_MAX'],'capital':bool(p['ADM0CAP'])}})
    for feature in collections['ne_10m_roads']:
        p=feature['properties'];g=feature['geometry']
        if p['type'] not in ['Major Highway','Secondary Highway']:continue
        lines=[g['coordinates']] if g['type']=='LineString' else g['coordinates']
        parts=[part for line in lines for part in clip_line(line)]
        if not parts:continue
        points=[point for part in parts for point in part]
        roads.append({'type':'Feature','geometry':{'type':'MultiLineString','coordinates':parts},
            'bbox':[min(p[0] for p in points),min(p[1] for p in points),max(p[0] for p in points),max(p[1] for p in points)],
            'properties':{'kind':p['type'],'minZoom':p['min_zoom'] or (4 if p['type']=='Major Highway' else 7)}})
    for name,features in [('cloud-lab-places',places),('cloud-lab-roads',roads)]:
        path=ROOT/'data'/(name+'.geojson')
        path.write_text(json.dumps({'type':'FeatureCollection','features':features},ensure_ascii=False,separators=(',',':'))+'\n')
        print(name,len(features),'features',path.stat().st_size,'bytes')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir',type=pathlib.Path,default=pathlib.Path(tempfile.gettempdir())/'skyflow-map-source')
    build(parser.parse_args().source_dir)
