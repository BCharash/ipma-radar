# Prepared GeoColour feed investigation

Checked 6 November 2026, approximately 17:00 UTC. These are point-in-time
observations, not provider latency or availability guarantees.

## Result

A prepared Meteosat-12 GeoColour feed **does exist** at CIRA SLIDER. Public,
timestamped PNG files downloaded without credentials. It is not yet a suitable
direct replacement for Atmora's EUMETView requests: observations were older,
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

## Follow-up: four, six and all nineteen requests

On 6 November 2026, an isolated Chrome session requested the same 19 Low
GeoColour frames (latest 16:50 UTC), fixed EPSG:3857 bounds and 136 × 256 output
dimensions. Browser fetch caching was disabled with `cache: no-store`.
The order was 4, 6, 19, 19, 6, 4 to expose warm-cache/order effects.

| Concurrent requests | First run elapsed | Second run elapsed | Successful PNGs |
| --- | --- | --- | --- |
| 4 | 6.34 seconds | 15.02 seconds | 19/19, 18/19 |
| 6 | 9.88 seconds | 15.83 seconds | 19/19, 19/19 |
| 19 (whole sequence) | 11.45 seconds | 12.84 seconds | 19/19, 18/19 |

The first two successful images arrived in 1.03–1.83 seconds with four workers,
1.17–1.67 seconds with six, and 1.06–1.37 seconds with nineteen. PNG decode/render
time was not included. The browser/provider still controls effective transport
parallelism; these are application worker counts.

The failed response in the later four- and nineteen-worker runs was HTTP 500
for the same observation. This does not establish concurrency as its cause.
Elapsed times include those failed responses, so an 18/19 run is not a fully
loaded sequence. Strong service variability limits conclusions from two trials
per setting. Neither six nor nineteen demonstrated a reliable overall advantage
over four; the production limit remains four. These are fixed-view Low results,
not measurements of High or physical iPhone performance.

## Follow-up: Low versus High request-to-ready time

Measured 6 November 2026 against the same 19 observations (latest 17:00 UTC),
same fixed bounds as the concurrency test, four workers, and browser fetch cache
disabled. Each image was fetched completely and decoded with `Image.decode()`.
Order: Low, phone High, desktop High, desktop High, phone High, Low. The labels
describe the app's requested sizes, not measurements on physical phones.

| Requested pixels | Median request-to-decoded image, each run | Batch elapsed, each run | Successful images |
| --- | --- | --- | --- |
| Low 136 × 256 | 1.52 / 1.51 seconds | 9.20 / 9.19 seconds | 19/19, 19/19 |
| Phone High 271 × 512 | 4.95 / 5.19 seconds | 26.89 / 27.40 seconds | 18/19, 19/19 |
| Desktop High 407 × 768 | 11.68 / 11.56 seconds | 59.10 / 62.96 seconds | 17/19, 16/19 |

Per-image medians include only successful images and start when a worker sends
the request, excluding time queued behind other images. Batch elapsed includes
queueing and failed requests. HTTP 500 responses and 20-second timeouts occurred;
an incomplete batch is not a successful High switch. These timing samples do not
guarantee the same performance for other areas, observations, connections or
provider load, and bypass app caches rather than the provider's internal caches.

Typical compressed sizes were about 74 KiB, 272 KiB and 570 KiB respectively.
Median decoding took only 3–4, 7 and 11 milliseconds. Response headers typically
arrived well before the complete body: median header times were 0.24–0.59 seconds
for Low, 0.51–0.68 for phone High, and 0.35–1.24 for desktop High. Most measured
request-to-ready time was spent awaiting the image body, not decoding it. This
does not distinguish network throughput from upstream image streaming or service
limits, and does not identify EUMETSAT's internal bottleneck.

Low can begin playback once two observations are ready (0.86–1.90 seconds in
these samples). High waits for the complete matching movie and, when playing,
the current pass boundary. The measurements above exclude that extra boundary
wait and the app's 400 ms High preparation debounce. A cached High movie avoids
these network transfers. Production settings were unchanged by this test.

## Decision

Prepared delivery remains promising, but a replacement must provide recent
observations, verified registration, browser-compatible access and suitable
distribution terms. The CIRA finding verifies that prepared GeoColour exists;
it does not yet verify an IPMA-like drop-in source for this app. A permitted
server-side pipeline could generate and cache Mercator tiles once per scan,
but that introduces hosting/processing work and has not been implemented.
