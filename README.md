# Atmora

Standalone satellite imagery and IPMA mainland Portugal precipitation radar,
prepared for eventual integration into PraiasPortugal.

The application is named **Atmora**. Its repository and local folder still use
`ipma-radar`; the repository, hosting address and folder migration have not been
completed. See the [Atmora rename status](docs/atmora-rename-status.md) for the
completed work and remaining migration steps. The earlier
[SkyFlow rename proposal](docs/skyflow-rename-plan.md) is historical and uses the
superseded name.

Open `index.html` with Live Server to run the radar. `location-test.html` is a
separate geolocation diagnostic page; opening it runs only the location test.

The sky banner uses model-based weather for the startup GPS location, or the map's
default location if GPS is unavailable. It keeps that location during map navigation
and refreshes weather every 15 minutes. The badge shows condition time and flags
stale data. High, mid and low cloud drawings follow their own cloud-cover values;
rain and snow use separate effects. See the [sky header architecture](docs/sky-header-architecture.md)
for the cloud-layer explanation and weather fallback behavior.
The softer cloud appearance is accepted as an interim baseline; visual realism
remains open. The architecture document records the checkpoint and next steps.

## Satellite and radar

Choose **Map**, **GeoColour satellite**, **Visible (daylight)**, or **Infrared
satellite** in the View selector. Toggle **Rain radar** independently. Map
with radar enabled is the default. Separate **Satellite** and **Radar** opacity sliders
let the street map show through; satellite starts at 60% opacity.

While Map is selected, GeoColour history preloads into the image cache in the
background: Low first, then High. The map and radar remain visible. Selecting a
satellite view stops background preloading and uses cached images where available.
Moving the map or changing history prepares the corresponding GeoColour scene;
new observations or uncached areas can still need loading when selected.

Satellite imagery comes from EUMETSAT's public EUMETView WMS and requires no API
key, account, or proxy. Visible uses MTG VIS0.6, infrared uses MSG IR10.8, and
GeoColour uses MTG Geo Colour. Visible imagery needs daylight; GeoColour is a provider
composite. IPMA's own satellite routes were investigated; the provider decision
and request results are recorded in the design journal.

**Play/Pause**, **Previous**, **Next**, and **Loop** work for satellite-only and
combined views. Low-resolution satellite observations load progressively at their
native 10/15-minute cadence. Playback is available once two distinct observation
times are loaded across the enabled layers; a running animation keeps its time
sequence while more frames arrive.
The next pass includes newly available frames. While history loads, playback
repeats even with Loop off; after loading, it plays the expanded history once
and then follows the Loop setting. The interval selector controls radar only. History
selection applies to both. Failed satellite images are skipped. The playback
clock combines every loaded radar and satellite timestamp from the enabled layers, sorted with duplicates
removed. Previous and Next use that same combined timeline. Radar toggles leave
the current pass running; the next pass rebuilds the timeline for the enabled
layers. Satellite arrivals join at that boundary too. Each source shows
its most recent observation at or before the clock time, holding earlier imagery
across missing slots with actual timestamps shown. If no earlier observation
exists, that source is hidden rather than showing a future image. Observations are not
invented between frames. These animations show observed history, not a forecast.

Both radar toggle directions change visibility without stopping or restarting
playback. Radar and satellite frame numbers and Lisbon-local times appear side
by side at the bottom of the map. Every satellite view automatically loads Low
previews first (256-pixel maximum side),
then prepares High for the same observations (512 pixels on a small viewport,
768 otherwise). There is no Low/High selector. Processed and ready counts remain
visible in the status area above the opacity sliders while the current movie continues.
After every request succeeds, fails or times out, it switches the prepared sequence
at the next playback boundary, or immediately while paused. Unavailable High
images use their matching Low frames. That status area reports, for example,
**High ready 16/19 · 3 Low fallbacks**. **Retry High** retries the missing images,
reusing successful ones and applying recovered images at the next boundary.
It also bypasses the temporary failed-request deferral for those images.
Both resolutions are cached. Beside the satellite frame count, the readout shows
the displayed **Low/High** image and its actual decoded pixel dimensions, such as
**Low 154×256 px**. It reports what is on screen while the automatic High
replacement sequence is still loading. Pixel dimensions are not native
ground resolution. Pausing retains the current map view and clock.

**Refresh** updates both sources. Zoom/pan reprojects the existing imagery
immediately. If the prepared scene no longer fits the viewport/zoom, the app
automatically fetches coverage newest to oldest. When the prepared region changes,
the entire current movie stays intact while a complete replacement set loads.
The replacement switches together at a playback boundary, or immediately while
paused, preserving the UTC clock. It does not mix narrow old rectangles with
expanded frames within a pass. A narrower rectangle can remain visible temporarily
while loading; if any replacement is missing, previous coverage stays in use and
Refresh retries. Initial history still loads progressively. Small movements
within a reusable padded scene require no new coverage. High preparation starts
automatically for the new scene after its Low movie commits. Switching to Map
cancels satellite preparation.
Successful images are reused from a bounded memory cache and browser Cache
Storage (when available), including across page reloads. Known failed requests
are briefly deferred. The first uncached visit still depends on the provider.

Caching is bounded: satellite PNGs for both resolutions and geographic scenes
use up to 16 MiB of memory and 48 MiB / 96 images in browser Cache Storage when
available. Old entries can be evicted; storage restrictions fall back to memory.
Radar images have a session-memory cache. Map tiles, fonts and vector styles use
normal browser/provider caching; this is not a complete offline cache. A wider
uncached region needs new images because its geographic bounds differ.

While Map is selected, GeoColour preparation begins after a 400 ms debounce.
The catalogue response provides the expected count and time span before image
downloads finish; it does not guarantee every image will be available. Timeline
construction uses successful downloads and does not wait for the full history.
Catalogue response time depends on the provider; a fresh cached catalogue is
reused for up to 60 seconds.

Cold loads request only the relevant satellite-family catalogue, then four small
registered images at a time, newest to oldest. High-resolution preparation also
uses four workers. Failed observations are skipped.
History preparation stops after 60 seconds with partial results retained and an
incomplete-history message; Refresh retries missing data. This is not a
preprocessed satellite tile service and cannot guarantee instant loading.

Expanded coverage and High resolution replace the movie after its current pass.
With Loop enabled, playback continues into the replacement sequence; with Loop
off, it stays at the final observation until Play is pressed. An unfinished
coverage request does not force another pass, and late replacements leave paused
playback paused.

See the [prepared GeoColour feed investigation](docs/geocolour-feed-investigation.md)
for measured delivery results and the remaining obstacles to replacing WMS.

**GeoColour satellite** uses the lab-tested OpenFreeMap vector map: detailed
roads, place/street names and boundaries remain above satellite and radar even
at 100% image opacity. MapLibre loads only when this view is selected. The original
OpenStreetMap raster map remains available as **Map** view, and is also used with
Visible/Infrared. Switching back restores that same map at the current location
and zoom, releasing the vector renderers. If detailed-map loading or WebGL fails,
GeoColour and radar remain available over the standard map with a status message.
No key or account is required.

GeoColour includes land/ocean imagery as well as clouds; lowering satellite
opacity reveals the vector basemap beneath it. Weather frames keep their
existing Leaflet placement, cache and animation path. Two vector canvas panes
render base surfaces below imagery and context above it. Cartographic detail
grows with zoom; this does not change satellite resolution or radar coverage.

Outside GeoColour mode, local coastline/country-border outlines remain above
imagery, covering Portugal and nearby Atlantic/western Europe. See
[map data](data/README.md).

Satellite registration uses an explicit EPSG:3857 WMS bounding box and the exact
same geographic corners for Leaflet rendering. Radar retains IPMA's original
bounds. See [registration and verification](docs/registration.md).

The existing 0.1/0.5 mm/h display filter is unchanged. There is no rain-gauge
integration or future prediction animation in this version.

See the [satellite service comparison](docs/satellite-services.md) for the
Meteoblue comparison, observed versus animated time steps, and no-key rapid-scan
and cloud-mask candidates. Transparent cloud-only imagery is not implemented.

## Project structure

The map attribution area displays the application build.
Update its single identifier in `src/js/build-info.js` for each changed release;
see [build numbering](docs/build-versioning.md).

```text
ipma-radar/
├── index.html
├── location-test.html
├── manifest.json
├── README.md
├── assets/images/       App icons and favicon
│   └── source/         Original artwork and alternate icon
├── data/               Local coastline and country outlines
├── docs/
│   ├── design-journal.md
│   └── archive/        Earlier integration handoffs
└── src/
    ├── css/
    └── js/
```

The [design journal](docs/design-journal.md) carries forward the existing v3
integration handoff's technical decisions, investigation history, and integration
requirements, followed by dated changes and validation checkpoints.
Earlier integration handoffs are preserved as historical
references: [v3](docs/archive/IPMA_Radar_Integration_Summary_v3.md) and
[v2](docs/archive/IPMA_Radar_Integration_Summary_v2.md). Use this README for the
current file layout.

## File guide

| File | Responsibility |
| --- | --- |
| `index.html` | Page markup, controls, legend, SVG filter, and asset loading |
| `src/css/radar.css` | Radar page styles |
| `src/js/radarService.js` | IPMA timestamps and URLs, latest-frame discovery, frame lists, image loading and cache |
| `src/js/radarMap.js` | Leaflet map, radar overlays, rain-intensity filtering, and range controls |
| `src/js/radarLocation.js` | Current-location control, geolocation, and accuracy markers |
| `src/js/radarPlayback.js` | Animation, looping, frame stepping, and map-view restoration |
| `src/js/radarControls.js` | Control elements, status messages, frame times, and control presentation |
| `src/js/satellite.js` | Public satellite catalogue, registered history images, timestamps, opacity, and radar toggle |
| `src/js/satelliteCache.js` | Bounded memory/persistent satellite image caches and image loading |
| `src/js/satelliteCoverage.js` | Complete viewport-replacement staging, boundary switching and preservation of observation times |
| `src/js/satelliteDetail.js` | Complete High-resolution batch staging and atomic sequence switching |
| `src/js/geoColourMap.js` | GeoColour-only vector cartography, lazy dependency loading, fallback and original-map restoration |
| `src/js/mapFeatures.js` | Coastline and country-border outlines above the imagery |
| `src/js/app.js` | Shared timeline state, loading batches, refresh coordination, event binding, and startup |

These are ordinary scripts sharing the page's JavaScript scope, following the
current PraiasPortugal loading approach. Load Leaflet first, then the feature
scripts in the order shown in `index.html`, with `app.js` last. Only `app.js`
starts the application and binds the main page controls.

The initial file split preserved existing function bodies and behavior. Later
satellite/playback changes are recorded in the design journal. Cross-file state
remains explicit in the top-level declarations: the controller owns
`radarFrames`, `currentFrameIndex`, and `loadGeneration`; map, location, and
playback files own their respective state. The frame-list service reads
`loadGeneration` to discard superseded loads. Feature files call shared display
helpers as needed.

Before integration, scope the page styles to the radar container, encapsulate
shared state, and add lifecycle methods for navigation and cleanup. The current
file split does not yet make the radar an independently mountable component.

## Refactor validation

Stage two preserved all 31 original function bodies and executable source lines.
Both the original script and the split scripts passed the same JavaScriptCore
checks with simulated DOM, Leaflet, image, timer, storage, and geolocation APIs:
startup, image caching, frame selection, animation and looping, refresh,
history/interval changes, rain thresholds, radar range, superseded loads, and
location/radar failures.

Those checks do not validate browser rendering or real IPMA network access.
After the split, verify the radar in a browser and on iPhone: initial display,
location, history/interval selectors, refresh, previous/next, play/pause, looping,
rain threshold, and radar range.

The satellite revision also has a repeatable live Chrome check on macOS:

```sh
python3 tests/browser-check.py
```

It uses an isolated browser profile and public imagery, checking opacity,
satellite-only/combined animation, timestamp ordering and lag labels,
newest-first loading, automatic Low-to-High preparation, High fallback batches, automatic coverage, cache reuse, registration after pan/zoom, and failure recovery. It requires network access
and can take several minutes. It saves a mobile screenshot in the system
temporary directory. Real iPhone/Safari testing remains separate.

Run `python3 tests/sky-header-check.py` for deterministic sky-header checks with
mocked weather and startup GPS, including cloud tiers, rain/snow, visibility,
freshness, request cancellation and reduced motion.


## Atmora cloud lab

Open [`labs/clouds/index.html`](labs/clouds/index.html) with Live Server to compare
GeoColour with regional map features against the identical imagery with a live,
detailed OpenFreeMap vector street map. The previous photographic-mask comparison
has been removed. A third panel has a working local Meteomatics connector awaiting
satellite account access. Linked maps, UTC selection, opacity, Low/High requests,
optional IPMA radar and downloadable comparison records remain available.

See [lab instructions, provider setup and validation](docs/cloud-lab.md). The
production app's name, sources and cache are unchanged by this lab.
