# Map registration and verification

Radar and satellite imagery have independent registration contracts. Changing a
viewport or opacity must not change either contract.

## IPMA radar

The unchanged radar bounds are:

```javascript
[[34.011513, -12.454795], [43.792862, -4.345465]]
```

They are taken from IPMA's own
[mapbuilder-pt.js](https://www.ipma.pt/pt/otempo/obs.remote/mapbuilder-pt.js),
retrieved again on 6 November 2026. Radar PNGs continue to use Leaflet
ImageOverlay with those exact southwest/northeast coordinates. Satellite
registration does not replace or modify these bounds.

## Satellite observations

The satellite service renders a WMS image for a geographic scene around the
current viewport. `satelliteGeometry()` in `src/js/satellite.js`:

1. Obtains the scene's southwest and northeast latitude/longitude corners.
2. Projects both with `L.CRS.EPSG3857` (Web Mercator, matching the map).
3. Sends `SRS=EPSG:3857`, `BBOX=west,south,east,north`, and explicit image
   dimensions in a WMS 1.1.1 GetMap request.
4. Places the returned image in a Leaflet ImageOverlay using the original
   southwest/northeast geographic corners, in the satellite pane.

The server performs the satellite reprojection. The app does not stretch an
arbitrary geographic JPEG into a guessed Portugal rectangle. WMS 1.1.1 avoids
the latitude/longitude axis-order ambiguity of WMS 1.3.0 EPSG:4326 requests.

Scenes are padded and their projected corners snapped outward to a metre grid.
The snapped corners define both the requested WMS BBOX and the Leaflet overlay,
so snapping does not shift an image within a different rectangle. Scenes are
reused within their coverage and a one-level zoom difference. This keeps image
URLs stable for caching. All overview history uses a maximum image side of 256
pixels. Leaflet keeps those images registered during movement. Moving beyond a
reusable scene automatically requests expanded coverage newest to oldest;
existing observations retain their images until same-time replacements arrive.

High resolution uses the same timestamps and projected rectangle at 512 pixels
on small viewports or 768 otherwise. The entire High batch must be ready before
it replaces Low at a playback boundary (or while paused). No individual detailed
frames enter a Low movie. Both image sizes are cached independently by their
complete WMS request URL. A new coverage request uses Low while the matching High
batch is prepared. Geographic placement and requested observation time remain
explicit for every overlay, at either size.

Local Natural Earth coastlines and country borders are projected by Leaflet
in a separate pane at z-index 460, above radar and satellite. Their geometry and
opacity are independent of imagery sliders. See [map data](../data/README.md)
for coverage, generalization, and source information.

## Time registration

Each satellite request includes an explicit observation timestamp from the
provider's published cadence. A shared clock follows the sequence selected when
Play starts. Radar visibility changes do not change this clock or its cadence.
Each source selects its most recent loaded observation at or before the clock
time. The two actual observation times can differ; both are displayed. Missing
slots retain an earlier observation with its time labelled. If there is no
earlier observation for a source, that source is hidden. Radar can
advance every five minutes while 10-minute satellite imagery repeats for two
steps or 15-minute imagery repeats for three; no intermediate observations are
invented.

Satellite-only playback uses native satellite observations. No interpolated
cloud movement or future prediction is implied.

During progressive loading, a play-through snapshots the available observation
times and available satellite observations. New frames can be inserted into the
loaded collection without shifting the running clock or substituting a newer
satellite observation partway through a loop. The next loop adopts the
then-available sequence and observations.
During combined loading, the radar play-through
starts within the available satellite time range. Both original frame indices
and observation times are shown in separate bottom readouts. Playback uses
one resolution consistently within each pass. New history extends playback
at a boundary even with Loop off; it repeats while loading and then respects
the Loop setting. Switching the complete resolution batch retains the clock.

## Checks

Live Chrome checks on 6 November 2026 loaded visible, infrared, and hybrid
history, then compared the satellite image's browser rectangle against
`map.latLngToContainerPoint()` at its southwest/northeast corners and center.
The checks use the projected fractions within the actual requested WMS BBOX,
and repeat after pan and zoom. The measured maximum error was approximately
0.51 CSS pixels, within a 2-pixel tolerance for Leaflet rounding.

These are checks of the app's projection and placement, not an independent
calibration of the satellite instrument or IPMA radar product. In particular,
they do not establish that observed clouds/rain are at ground level.

For a visual check, set Radar to 0% and vary Satellite between 0% and 60%.
Compare visible land/coast features with the base map at several zooms. Restore
radar and confirm that its registered rectangle does not move when either
opacity slider changes. Cloud cover may obscure the coastline.

Real iPhone/Safari acceptance remains required after desktop/mobile-viewport
checks. See the design journal for provider selection and implementation history.
