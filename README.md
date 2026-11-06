# ipma-radar

Standalone IPMA mainland Portugal precipitation radar, prepared for eventual
integration into PraiasPortugal.

Open `index.html` with Live Server to run the radar. `location-test.html` is a
separate geolocation diagnostic page; opening it runs only the location test.

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
| `src/js/app.js` | Shared timeline state, loading batches, refresh coordination, event binding, and startup |

These are ordinary scripts sharing the page's JavaScript scope, following the
current PraiasPortugal loading approach. Load Leaflet first, then the feature
scripts in the order shown in `index.html`, with `app.js` last. Only `app.js`
starts the application and binds the main page controls.

The split preserves existing function bodies and behavior. Cross-file state
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
