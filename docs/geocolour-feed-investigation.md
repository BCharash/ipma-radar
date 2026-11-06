# Prepared GeoColour feed investigation

Checked 6 November 2026, approximately 17:00 UTC. These are point-in-time
observations, not provider latency or availability guarantees.

## Result

A prepared Meteosat-12 GeoColour feed **does exist** at CIRA SLIDER. Public,
timestamped PNG files downloaded without credentials. It is not yet a suitable
direct replacement for SkyFlow's EUMETView requests: observations were older,
the tiles need geographic reprojection, and direct browser fetches were blocked
by cross-origin restrictions. Public access does not by itself establish
permission to run a public redistribution service.

The production app therefore keeps EUMETView and now allows four simultaneous
satellite requests for both Low history/coverage and High preparation.

## Verified CIRA feed

Primary sources:

- [SLIDER viewer](https://slider.cira.colostate.edu/)
- [Product definitions](https://slider.cira.colostate.edu/js/define-products---rammb-slider.js)
- [Viewer implementation](https://slider.cira.colostate.edu/js/rammb-slider.js)
- [Meteosat-12 GeoColour latest observations](https://slider.cira.colostate.edu/data/json/meteosat-12/full_disk/geocolor/latest_times.json)
- [Available dates](https://slider.cira.colostate.edu/data/json/meteosat-12/full_disk/geocolor/available_dates.json)

The product definitions identify `meteosat-12 / full_disk / geocolor`, nominal
1 km product resolution and a nominal 10-minute interval. The actual catalogue
had gaps; a continuous 10-minute history must not be assumed.

| Check | Observed result |
| --- | --- |
| Catalogue | HTTP 200, no key, about 0.69 seconds |
| Latest listed scan | 15:00 UTC, about two hours before the check |
| Current EUMETView GeoColour catalogue | Latest scan 16:40 UTC at the same check |
| Prepared full-disk overview tile | HTTP 200, 696 × 696 pixels, 787,034 bytes, 1.49 seconds |
| Next-level tile, row/column 0/0 | HTTP 200, 696 × 696 pixels, 750,780 bytes, 1.64 seconds |
| Image cache headers | `Cache-Control: max-age=604800`, ETag and Last-Modified |
| Direct browser `fetch` from localhost | Catalogue and PNG both failed across origins |

Example verified overview file:

```text
https://slider.cira.colostate.edu/data/imagery/2026/11/06/meteosat-12---full_disk/geocolor/20261106150000/00/000_000.png
```

The file path comes from the viewer's URL builder. These are already-generated
images, rather than arbitrary bounding-box render requests. An older date can
eventually expire from the live service.

### Registration

The viewer uses satellite scan-angle navigation, not ordinary Web Mercator XYZ
tiles. Its Meteosat-12 navigation includes satellite altitude, longitude and disk
scan-angle limits, and implements latitude/longitude-to-scan-angle conversion.
Only a full-disk sector was defined for Meteosat-12 in the checked configuration.

Stretching one of these PNGs into a Leaflet geographic rectangle would give
incorrect alignment. An adapter would need to reproject the appropriate native
tiles onto EPSG:3857, and independently validate coastlines/control points at
multiple zooms before it could replace the existing registered overlay. Native
product resolution, tile dimensions and ground resolution over Portugal are
different quantities.

### Browser access and usage

HTTP requests carrying a localhost Origin header received no
`Access-Control-Allow-Origin` header. An isolated Chrome check confirmed that
both catalogue and image `fetch` failed from the local application origin.
Ordinary cross-origin image display can work without CORS, but does not grant
pixel access for canvas reprojection or the current fetch-based persistent cache.
A permitted same-origin service or provider-enabled CORS would be needed for
that implementation.

SLIDER marks its imagery experimental. The
[CIRA Satellite Library information page](https://satlib.cira.colostate.edu/info/)
asks for CSU/CIRA and EUMETSAT credit for Meteosat imagery. That page does not
establish a supported tile API, hotlinking entitlement, bulk redistribution
permission or service guarantee. Those aspects remain unverified. No contact
has been made and no credentials have been requested.

## Other sources checked

| Source | Finding |
| --- | --- |
| [NASA GIBS Web Mercator catalogue](https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml) | GeoColor entries found for GOES East/West, not a Meteosat GeoColour replacement for Portugal. |
| [RealEarth product API](https://realearth.ssec.wisc.edu/doc/api.php) | Searches found Meteosat-11 bands and GOES GeoColor products; no current Meteosat-12 GeoColour feed established. This is not proof that none exists. |
| [EUMETSAT Earth View](https://www.eumetsat.int/real-time-imagery/earth-view) | True-colour daytime/IR nighttime presentation with lightning, delivered through embedded video streams; no map-ready image catalogue established. |
| [IPMA satellite page](https://www.ipma.pt/pt/otempo/obs.satelite/) | Prepared JPEGs are provided, including hourly regional IR imagery in the checked page. No equivalent MTG GeoColour feed with sufficient registration metadata established. |

## Performance change and validation

Earlier controlled browser measurements used eight identical fixed-view
GeoColour requests with browser caching disabled. Two-worker runs took 6.46 and
6.28 seconds; four-worker runs took 4.49 and 4.32 seconds (about 31% less elapsed
time). The order was 2, 4, 4, 2. Upstream caching and service variability still
apply; these measurements do not promise a 31% gain on every device or load.

The CIRA tile timings above are **not** an equivalent-resolution/area comparison
against WMS and do not prove that switching providers would be faster.

After sharing a four-worker limit between Low and High, the quick Chrome
acceptance suite passed: progressive newest-first loading, cached reuse,
Low/High batch switching, expanded-viewport staging and failure retention,
uninterrupted playback when toggling radar, registration, map restoration and
WebGL fallback. No JavaScript errors were reported. Physical Safari/iPhone
performance remains unmeasured.

## Decision

Prepared delivery remains promising, but a replacement must provide recent
observations, verified registration, browser-compatible access and suitable
distribution terms. The CIRA finding verifies that prepared GeoColour exists;
it does not yet verify an IPMA-like drop-in source for this app. A permitted
server-side pipeline could generate and cache Mercator tiles once per scan,
but that introduces hosting/processing work and has not been implemented.
