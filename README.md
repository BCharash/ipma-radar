# ipma-radar

Standalone IPMA mainland Portugal precipitation radar, prepared for eventual
integration into PraiasPortugal.

Open `index.html` with Live Server to run the radar. `location-test.html` is a
separate geolocation diagnostic page; opening it runs only the location test.

## Satellite and radar

Choose **Map**, **Visible (daylight)**, **Infrared satellite**, or **Hybrid
satellite** in the View selector. Toggle **Rain radar** independently. Map with
radar remains the default. Separate **Satellite** and **Radar** opacity sliders
let the street map show through; satellite starts at 60% opacity.

Satellite imagery comes from EUMETSAT's public EUMETView WMS and requires no API
key, account, or proxy. Visible uses MTG VIS0.6, infrared uses MSG IR10.8, and
hybrid uses MTG Geo Colour. Visible imagery needs daylight; hybrid is a provider
composite. IPMA's own satellite routes were investigated; the provider decision
and request results are recorded in the design journal.

**Play/Pause**, **Previous**, **Next**, and **Loop** work for satellite-only and
combined views. Low-resolution satellite observations load progressively at their
native 10/15-minute cadence. Playback is available once two observations are
loaded; a running animation keeps its time sequence while more frames arrive.
The next pass includes newly available frames. While history loads, playback
repeats even with Loop off; after loading, it plays the expanded history once
and then follows the Loop setting. The interval selector controls radar only. History
selection applies to both. Failed satellite images are skipped. When radar is
visible at Play, its sequence starts the clock; otherwise satellite does.
That clock keeps running when radar is checked or unchecked. Each source shows
its most recent observation at or before the clock time, holding earlier imagery
across missing slots with actual timestamps shown. If no earlier observation
exists, that source is hidden rather than showing a future image. Observations are not
invented between frames. These animations show observed history, not a forecast.

Both radar toggle directions change visibility without stopping or restarting
playback. Radar and satellite frame numbers and Lisbon-local times appear side
by side at the bottom of the map. **Low res / High res** compares the same
observations at different image sizes. Low is the default (256-pixel maximum
side). High prepares the entire matching movie (512 pixels on a small viewport,
768 otherwise), showing progress while Low continues. It switches all frames
together at the next playback boundary, or immediately while paused. An
incomplete High batch leaves Low in use. Switching back to Low is immediate;
both resolutions are cached. Pausing retains the current map view and clock.

**Refresh** updates both sources. Zoom/pan reprojects the existing imagery
immediately. If the prepared scene no longer fits the viewport/zoom, the app
automatically fetches coverage newest to oldest. Each observation retains its
old registered image until its same-time replacement arrives. Small movements
within a reusable padded scene require no new coverage. Selecting High prepares
a complete matching High batch for the new scene after Low history loads.
Successful images are reused from a bounded memory cache and browser Cache
Storage (when available), including across page reloads. Known failed requests
are briefly deferred. The first uncached visit still depends on the provider.

Cold loads request only the relevant satellite-family catalogue, then two small
registered images at a time, newest to oldest. Failed observations are skipped.
History preparation stops after 60 seconds with partial results retained and an
incomplete-history message; Refresh retries missing data. This is not a
preprocessed satellite tile service and cannot guarantee instant loading.

Local coastline and country-border outlines remain above both satellite and
radar, including at 100% imagery opacity. They cover Portugal and the nearby
Atlantic/western Europe region; see [map data](data/README.md).

Satellite registration uses an explicit EPSG:3857 WMS bounding box and the exact
same geographic corners for Leaflet rendering. Radar retains IPMA's original
bounds. See [registration and verification](docs/registration.md).

The existing 0.1/0.5 mm/h display filter is unchanged. There is no rain-gauge
integration or future prediction animation in this version.

See the [satellite service comparison](docs/satellite-services.md) for the
Meteoblue comparison, observed versus animated time steps, and no-key rapid-scan
and cloud-mask candidates. Transparent cloud-only imagery is not implemented.

## Project structure

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
| `src/js/satelliteDetail.js` | Complete High-resolution batch staging and atomic sequence switching |
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
newest-first loading, full High batch switching, automatic coverage, cache reuse, registration after pan/zoom, and failure recovery. It requires network access
and can take several minutes. It saves a mobile screenshot in the system
temporary directory. Real iPhone/Safari testing remains separate.


## SkyFlow cloud lab

Open [`labs/clouds/index.html`](labs/clouds/index.html) with Live Server to compare
GeoColour with regional map features against the identical imagery with a live,
detailed OpenFreeMap vector street map. The previous photographic-mask comparison
has been removed. A third panel has a working local Meteomatics connector awaiting
satellite account access. Linked maps, UTC selection, opacity, Low/High requests,
optional IPMA radar and downloadable comparison records remain available.

See [lab instructions, provider setup and validation](docs/cloud-lab.md). The
production app's name, sources and cache are unchanged by this lab.
