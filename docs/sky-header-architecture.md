# Sky header architecture and behavior

The header is an illustrative sky driven by solar elevation and Open-Meteo
model-based current conditions. It is not a photograph, a direct station
observation, or a reconstruction of the sky overhead. Radar and satellite
playback keep their own observation times; the header always represents current
conditions at the startup location.

## Startup location and lifecycle

`initSkyTheme()` renders sun-based colours immediately. The existing map
geolocation request resolves the header location once through
`resolveSkyStartupLocation()`. The sky does not make a second GPS request.

- GPS success: use the coordinates obtained at startup.
- GPS denied, unavailable or timed out: use `DEFAULT_LOCATION` from
  `radarMap.js`, matching the map fallback. The badge tooltip identifies this as
  the default map location.
- Panning, zooming and later presses of Current location do not move the banner
  location. Reload the app to choose a new startup location.
- Historical GPS coordinates are not reused as the current physical location.
- Solar colours update each minute; weather refreshes every 15 minutes for the
  fixed startup coordinates.

## Weather service and freshness

`fetchLiveWeather()` requests temperature, total cloud cover, low/mid/high cloud
cover, and WMO weather code from the Open-Meteo Forecast API. `timeformat=unixtime`
provides an unambiguous condition timestamp. Display times use Europe/Lisbon.
The Open-Meteo and CC BY 4.0 links in the map's bottom attribution area credit
the weather provider alongside Leaflet and the map sources. This credit persists
when switching between the standard and GeoColour maps.

Responses store the requested coordinates, condition time and fetch time.
The localStorage cache (`ipmaSkyLiveWeather`) is accepted only for matching
coordinates and valid timestamps. Cache entries from the earlier implementation,
which lack condition time, are ignored.

- Under 15 minutes old: reuse cached conditions.
- 15–60 minutes old: show the last conditions with a **stale** label while
  attempting a refresh.
- 60 minutes old or older: show **Weather unavailable**, hide weather-driven
  clouds and precipitation, and retain the solar colour palette.
- Age is the older of fetch age and condition age; fetching an old model time
  does not make that condition fresh.
- Missing temperature does not prevent valid cloud and condition rendering.
  Missing cloud values do not invent clouds; unknown codes do not imply sunshine.
- Requests time out after 10 seconds. Starting another request aborts the previous
  one; generation and coordinate checks also reject late responses even if the
  transport ignores cancellation.

Open-Meteo describes current conditions as weather-model data, not direct local
observations. See [API documentation](https://open-meteo.com/en/docs).

## How the cloud tiers work

Three SVG drawings in `index.html` are layered behind the controls. The shapes
are fixed artwork. They do not identify actual cloud species or positions from
the API. Separate model percentages control how strongly each drawing appears.
The model altitude bands below follow Open-Meteo's variable definitions.

| Tier | Model band | Artwork | SVG blur | Maximum opacity | Drift cycle |
| --- | --- | --- | --- | --- | --- |
| High | 8 km and above | Long curved strokes, suggesting wisps | 16 | 0.75 | 320 seconds |
| Mid | 3–8 km | Overlapping wide ellipses, suggesting sheets | 12 | 0.85 | 240 seconds |
| Low | Up to 3 km, including fog | Circles and ellipses, suggesting rounded puffs | 6 | 0.95 | 160 seconds |

For each tier:

```text
opacity = clamp(model cloud cover, 0, 100) / 100 × maximum opacity
```

For example, 80% high cover and 0% low/mid cover gives high opacity 0.60 and
zero opacity for the other drawings. No low cloud is added just because total
cloud cover is high. At 0% cover, that tier disappears completely.

Opacity is a visual proxy for amount: 80% cloud cover does not mean exactly 80%
of the header's pixels are covered. The drawings keep the same footprint.
Likewise, the three percentages must not be added together: cloud layers may
overlap vertically. Total cover is a separate input used for sky palette and
star visibility, not to manufacture missing altitude layers.

High clouds use the softest blur and slowest drift. Low clouds have more defined
edges and faster drift. The speed and direction are decorative CSS choices,
not measured wind at those heights. Colours change with the solar palette;
cloud shape and species do not change in response to weather codes. Fog uses
its condition label and available low-cloud cover; there is no separate fog
simulation.

## Rain, snow and other conditions

One explicit WMO mapping supplies the text, icon and precipitation effect:

| Codes | Condition | Effect |
| --- | --- | --- |
| 0, 1, 2, 3 | Clear to overcast | No precipitation |
| 45, 48 | Fog | No precipitation |
| 51, 53, 55 | Drizzle | Diagonal rain streaks |
| 56, 57 | Freezing drizzle | Rain streaks; freezing label |
| 61, 63, 65 | Rain | Rain streaks |
| 66, 67 | Freezing rain | Rain streaks; freezing label |
| 71, 73, 75, 77 | Snow / snow grains | Slower falling dots |
| 80, 81, 82 | Rain showers | Rain streaks |
| 85, 86 | Snow showers | Falling dots |
| 95, 97 | Thunderstorm | Rain streaks and storm icon |
| 96, 99 | Thunderstorm with hail | Rain streaks and explicit hail label |
| Unknown / missing | Conditions unavailable | No precipitation |

Rain and snow are mutually exclusive decorative layers. Both are CSS patterns;
no particle engine is involved. Snow is slower and round rather than diagonal.
Intensity, accumulation, individual hailstones and lightning are not simulated.
Radar echoes do not control these effects. Precipitation also selects a subdued
palette during broad daylight; other solar phases keep their own palettes.

## Solar colours, moon and stars

`getSolarElevation()` uses approximate declination and equation-of-time formulas.
The palette selects fixed daylight, golden-hour, sunrise/sunset, twilight and
night gradients. Cloud cover can select an overcast variant. These are threshold
changes, not continuous colour interpolation or a physically accurate sky model.

The moon is decorative. Its phase is estimated from a fixed mean lunar cycle;
its fixed header position does not represent local altitude, direction, rise or
set. Its tooltip identifies that limitation. Stars are decorative, with no actual
constellation positioning. They appear only at night with known total cloud
cover below 85%; the illustrative moon is hidden at 92% cover or more. Unknown
weather hides both rather than assuming clear skies.

## Rendering, accessibility and verification

`skyTheme.js` owns weather state, solar calculations and DOM updates. SVG and
CSS in `index.html` and `radar.css` own the drawings and animation. Backgrounds
are decorative and cannot intercept pointer events.

An explicit header `[hidden]` rule handles SVG visibility and overrides badge
layout styles. The View, opacity and status rows remain transparent over the sky;
label colours and text shadows adapt to the light/dark palette. Reduced-motion preferences stop
cloud, rain, snow and star animations. These measures are not a certification of
all WCAG requirements. Filters, gradients and animations have rendering costs;
physical iPhone/Safari performance remains a separate acceptance check.

Run `python3 tests/sky-header-check.py` for deterministic Chrome checks of startup
GPS/fallback, independent cloud tiers, precipitation, visibility, stale/expired
data, request races, cache reuse, reduced motion and mobile layout. Run
`python3 tests/browser-check.py --quick` for the existing radar/GeoColour regression
suite. Both use isolated Chrome profiles and require access to browser assets.
