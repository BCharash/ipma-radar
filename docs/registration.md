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

The scene is padded around the viewport. Panning beyond it or changing zoom
reloads scene coverage. Existing image corners remain fixed to their geographic
coordinates while the map transforms them. Opacity changes affect alpha only.
Image resolution is capped at 1024 pixels on the longer side to limit decoded
history memory; this can limit detail at high zoom without changing registration.

## Time registration

Each satellite request includes an explicit observation timestamp from the
provider's published cadence. Combined playback chooses the most recent loaded
satellite observation at or before the selected radar timestamp. It never pairs
a future satellite image with an earlier radar frame. Long internal gaps are
shown as missing imagery. If radar extends beyond the newest available satellite
observation, that observation remains visible with its time and lag labelled.

Satellite-only playback uses native satellite observations. No interpolated
cloud movement or future prediction is implied.

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
