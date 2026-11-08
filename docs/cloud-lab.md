# Atmora cloud comparison lab

Open [labs/clouds/index.html](../labs/clouds/index.html) with Live Server, or visit
`/labs/clouds/` on its running origin. This is an isolated still-image lab; the
production application and its sources are unchanged.

## Current comparisons

1. **GeoColour + regional features:** existing MTG GeoColour with local Natural
   Earth place names, major roads and outlines above it. This is the reference.
2. **GeoColour + detailed vector map:** exactly the same decoded GeoColour pixels
   and requested UTC slot as panel 1, with live OpenFreeMap/OpenStreetMap vector
   tiles. Streets, paths, names and other map detail change as you zoom. The
   earlier MSG photographic-image-plus-mask experiment has been removed.
3. **Meteomatics photographic overlay:** `sat_cloud_layer:idx` above the same vector
   map as panel 2. Its connector is implemented, but real imagery requires an
   account with satellite access. The user currently has no account access, so
   this panel starts with a real basemap and an explicit awaiting-access label.
   Simulated provider responses are used only in automated tests, never as a
   substitute for provider imagery in the lab.

Panel 2 has a complete vector basemap below GeoColour and detailed line/symbol
layers above it. GeoColour retains its land/ocean image at full opacity. Reduce
**Image opacity** to reveal the underlying street-map surface. This changes the
whole GeoColour image's opacity, including clouds. Panel 3, when connected, is
the comparison intended to keep map surfaces visible in cloud-free areas.

The map features switches apply to both approaches: **Place names**, **Major
roads**, **Coastlines & borders**, and **Strength**. In vector panels, names include
street/POI labels, roads include paths and related transport features, and the
outline switch controls other line context such as boundaries and waterways.
Natural Earth context in panel 1 remains regional and generalized. Feature
controls do not change or reload satellite pixels. Local outlines no longer
cover the vector panels; their map detail comes from vector tiles.

## Compare the maps

- Start with **100% image opacity** and **85% feature strength**. Pan/zoom any map;
  the others follow. Panel 2 should add genuine street-level context as you zoom.
- Fade imagery to compare the underlying detailed map. Switch roads/names off and
  on independently and inspect bright-cloud and dark-ocean readability.
- **Latest GeoColour time** uses MTG availability only. The lab no longer waits
  for MSG imagery/masks or their slower cadence. A custom UTC selection uses the
  available GeoColour slot at or before it. Both GeoColour panels always match.
- **Low / High** requests a maximum image side of 256 / 768 pixels. These are
  output image sizes, not a change to satellite sensor resolution. One decoded
  public image supplies both panels, avoiding duplicate WMS requests.
- **GeoColour cache** controls the isolated public-image cache. Bypass skips
  lab-cache reads and uses fetch `no-store`, then stores the successful response
  for subsequent reuse. It cannot flush upstream caches or vector-map tiles.
- Optional **IPMA radar** requests a five-minute image at or before selection,
  searching up to 30 minutes back. Panel 1 uses the original Leaflet image bounds;
  vector panels place the same radar image below their road/name layers.
- Add notes and **Download comparison record**. It contains imagery source/time,
  geometry, feature settings, timing and placement checks. It never contains
  provider credentials. Screenshots can be taken with the browser.

Imagery coverage is still limited to the lab's regional MSG/MTG footprint check.
Worldwide vector tiles do not imply worldwide GeoColour or IPMA coverage.
Animation and worldwide weather-provider routing remain separate work.

## Connecting Meteomatics later

No account, licence or free satellite tier has been assumed or created. Ask the
provider for access that explicitly includes `sat_cloud_layer:idx`, its historical
WMS images, and your intended limited noncommercial display/caching rights.
This daylight visible product becomes dark without sunlight, according to the
provider. Real appearance, thin clouds, edge quality, cadence and account terms
remain to be evaluated with actual access.

For ordinary vector comparisons, Live Server is sufficient. For the optional
provider connection, run from the repository root:

```sh
python3 scripts/serve-cloud-lab.py --prompt
```

Enter your provider username and password in that terminal; the password input
is hidden. Nothing is written to a credentials file or browser storage. Visit:

```text
http://127.0.0.1:8766/labs/clouds/
```

Then click **Check connection** and **Include Meteomatics**. Configured credentials
are not proof of satellite entitlement; the first actual request may report an
account/access error. Without credentials, use `python3 scripts/serve-cloud-lab.py`
to run the vector comparisons with the provider panel inactive.

For an existing local credential setup, `METEOMATICS_USERNAME` and
`METEOMATICS_PASSWORD` environment variables are also supported. Do not add
credentials to source files, query strings or comparison notes/downloads.

The server binds to `127.0.0.1` and forwards only the fixed Meteomatics WMS product,
with validated UTC time, EPSG:3857 BBOX and bounded image dimensions. Provider
credentials go only in the upstream HTTPS Authorization header. It rejects
cross-site provider calls and redirects and caps concurrent requests. Successful
provider PNGs are held only in a bounded local-server memory cache (16 entries,
32 MiB); the browser receives `no-store`. The GeoColour cache control does not
bypass this separate provider-memory cache. Restarting the local server clears
it. No Meteomatics images are written to the public-image Cache Storage.

The connector is a local research tool, not a production hosting backend. A
static published lab can run panels 1 and 2 but needs a separately implemented
server-side deployment for authenticated provider requests.

## Registration and timing

Public GeoColour requests use WMS 1.1.1 `SRS=EPSG:3857`; provider requests use
Meteomatics WMS 1.3.0 `CRS=EPSG:3857`. Both receive the same projected BBOX and
image grid. Leaflet corners and MapLibre image-source coordinates come from
unprojecting those exact projected corners. The GL Leaflet bridge preserves the
shared pan/zoom; vector features render in the same map coordinate system.

Both GeoColour panels share the same canvas and UTC slot. The optional provider
is requested at that slot too, but it may use its own nearest source observation.
No independently verified provider acquisition time or native cadence is claimed.
A requested timestamp is not evidence of exact cross-satellite temporal matching.

Old imagery remains labelled during replacement requests. Superseded requests
cannot commit stale images. Feature visibility changes are independent of the
weather layers; weather opacity does not fade vector context. Placement checks
compare projected points with Leaflet/MapLibre screen positions. These validate
application placement, not instrument geolocation, cloud parallax or ground rain.

## Sources and dependencies

- [OpenFreeMap](https://openfreemap.org/), with its documented
  [Leaflet integration](https://openfreemap.org/quick_start/); no API key required.
- OpenFreeMap Liberty style and its OpenStreetMap/OpenMapTiles attribution,
  displayed on the map. Its live vector tile/font/sprite services require network.
- MapLibre GL JS 5.6.2 and MapLibre GL Leaflet bridge 0.1.4, pinned browser builds.
  These add WebGL requirements to the two vector panels; failure is reported
  separately from the regional reference map.
- [EUMETView](https://view.eumetsat.int/), public MTG GeoColour WMS, no key.
- [Meteomatics photographic product](https://www.meteomatics.com/en/api/available-parameters/satellite/)
  and [WMS geometry/time contract](https://www.meteomatics.com/en/api/wms/getmap-request/).
- [Natural Earth local data provenance](../data/README.md), panel 1 only.

## Validation

```sh
python3 tests/cloud-lab-server-check.py
python3 tests/cloud-lab-check.py
```

The first suite uses no network or real credentials: fixed product/projection,
input limits, absent-account behavior, cross-site rejection, upstream-only dummy
Authorization headers and memory caching. The second uses live EUMETSAT imagery
and OpenFreeMap tiles in isolated Chrome plus simulated provider PNGs. It checks
identical GeoColour pixels/time, real rendered vector roads/text, weather/context
ordering, feature visibility/strength, imagery opacity, projection placement,
provider requests without credentials in URLs, linked coverage and cancellation.
It also checks mobile horizontal overflow. The desktop screenshot is saved at
`/private/tmp/skyflow-cloud-lab-desktop.png`.

A live 6 November 2026 sample showed matching requested 12:00 UTC GeoColour in
both panels, with final measured placement errors of about 0.23 CSS pixels
for Leaflet and 0.44 for the vector renderer. At Leaflet zoom 17 over Lisbon,
actual street names rendered and the measured image-corner error was about
0.86 CSS pixels (visible-viewport error about 0.42). The check excludes container
CSS borders from the coordinate origin and stays within a two-pixel tolerance. Source fetch timing varied between roughly 1.3 and 5.1
seconds in observed runs; these are not latency guarantees. Real Meteomatics
imagery/entitlement and physical iPhone/Safari WebGL behavior are still unverified.
The previous binary-mask experiment and its historical results remain recorded
in the design journal, rather than presented as current lab options.
