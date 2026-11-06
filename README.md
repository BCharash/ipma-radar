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
The next loop (or a new Play) includes newly available frames. The interval selector controls radar only. History
selection applies to both. Failed satellite images are skipped. When radar is
visible at Play, its sequence starts the clock; otherwise satellite does.
That clock keeps running when radar is checked or unchecked. Each source shows
its most recent observation at or before the clock time, holding earlier imagery
across missing slots with actual timestamps shown. If no earlier observation
exists, that source is hidden rather than showing a future image. Observations are not
invented between frames. These animations show observed history, not a forecast.

Both radar toggle directions change visibility without stopping or restarting
playback. Radar and satellite frame numbers and Lisbon-local times appear side
by side at the bottom of the map. Animation consistently uses overview imagery,
even when a paused frame has a cached detailed version. Pausing and finishing
playback retain the current map view; detail inspection keeps the same requested
observation time. A complete higher-detail animation is not prepared in this version.

**Refresh** updates both sources. Zoom reprojects the loaded history without
reloading it. While paused, the selected observation can receive a higher-detail
viewport image; other history frames are retained. A new detailed frame does not
change its observation time. Pan outside the prepared history and use Refresh
to prepare history for the new area. Failed updates retain previous imagery. Successful images are reused from
a bounded memory cache and browser Cache Storage (when available), including
across page reloads. Known failed requests are briefly deferred before retrying.
The first uncached visit to a product/region still depends on the provider.

For a cold load, the app requests only the relevant satellite-family catalogue,
then queues small registered observations for the selected radar time and an
earlier slot so a slow newest image cannot block a usable earlier image.
The whole history loads at low resolution first. Paused-frame detail uses its
own explicit registered bounds, retaining the overview as a fallback on zoom.
History preparation stops after 60 seconds with partial
results retained and an incomplete-history message; Refresh retries missing data.

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
| `src/js/satelliteDetail.js` | Paused-frame detail loading without rebuilding history on zoom |
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
first-image priority, cache reuse, registration after pan/zoom, and failure recovery. It requires network access
and can take several minutes. It saves a mobile screenshot in the system
temporary directory. Real iPhone/Safari testing remains separate.
