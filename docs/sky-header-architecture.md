# Sky Header Architecture & Implementation

Documentation of the dynamic atmospheric sky header for IPMA Radar, including astronomical calculations, live meteorological cloud synchronization, multi-tier altitude rendering, and future improvement roadmap.

---

## 1. Overview & Objective

The IPMA Radar header previously used a flat white `#ffffff` background with standard grey-bordered HTML controls. While functional, it lacked atmospheric connection to the weather being monitored on the radar and satellite map below.

The goal of this redesign was to transform the header into an **ambient, living atmospheric window** that:
1. Visually mirrors the actual sky outside in real time.
2. Represents distinct **altitude tiers of clouds** (High, Mid, Low) driven by live weather observations.
3. Automatically transitions across solar phases (Daylight, Golden Hour, Sunset, Twilight, Night).
4. Elevates control aesthetics with frosted glassmorphism while maintaining 100% WCAG contrast and usability.
5. Keeps motion tranquil, slow, and subtle to match ground-observed cloud movement.
6. Defaults to **Leiria, Portugal** (`39.7436° N, -8.8071° W`), while dynamically adapting to the user's GPS coordinates when requested.

---

## 2. Architecture & What Has Been Implemented

### A. Real-Time Solar Engine (`src/js/skyTheme.js`)
* **Astronomical Solar Elevation**: Implements standard solar position equations:
  $$\sin(\alpha) = \sin(\phi)\sin(\delta) + \cos(\phi)\cos(\delta)\cos(H)$$
  where $\phi$ is latitude, $\delta$ is solar declination (accounting for seasonal day-of-year tilt), and $H$ is the solar hour angle adjusted by the Equation of Time (EoT) and longitude.
* **Palette Transitions**:
  * **Daylight** ($\alpha > 12^\circ$): Azure-to-sky-blue gradient (`#1d6fe9` $\to$ `#4facfe` $\to$ `#8ec5fc`).
  * **Golden Hour** ($3^\circ \le \alpha \le 12^\circ$): Warm amber and soft apricot tones (`#25559c` $\to$ `#d97706` $\to$ `#fbbf24`).
  * **Civil Twilight / Sunset** ($-4^\circ \le \alpha < 3^\circ$): Fiery orange, rose, and dusky violet (`#1e293b` $\to$ `#9a3412` $\to$ `#ea580c` $\to$ `#f97316`).
  * **Dusk** ($-12^\circ \le \alpha < -4^\circ$): Deep nautical indigo and twilight purple (`#090d1a` $\to$ `#1e1b4b` $\to$ `#312e81`).
  * **Night** ($\alpha < -12^\circ$): Midnight navy and charcoal slate (`#030712` $\to$ `#0b1329` $\to$ `#111d3d`).
* **Update Cadence**: An ambient timer updates every 60 seconds to smoothly track the sun across the horizon.

---

### B. Live Meteorological Multi-Tier Cloud Sync & GPS-on-Startup
The application queries Open-Meteo's open meteorological feed for current observations:
```text
https://api.open-meteo.com/v1/forecast?latitude=39.7436&longitude=-8.8071&current=temperature_2m,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,weather_code,is_day
```
* **GPS Check on Startup**: When the app launches, `checkGpsOnStartup()` queries `navigator.geolocation` immediately to detect the user's physical position without requiring manual button clicks.
* **Instantaneous Zero-Latency Startup**: The detected GPS coordinates are saved in `localStorage` under `ipmaUserGpsCoords`. On subsequent app opens, the sky header renders using the user's real physical coordinates on frame 1 before asynchronous location queries even complete.
* **Location Fallback**: Defaults gracefully to Leiria (`39.7436, -8.8071`) if geolocation is not available or before first permission.
* **Live Temperature & Condition Badge (`#skyWeatherBadge`)**: An elegant frosted-glass badge beside the "IPMA" title displays the current temperature and weather condition (e.g., `21°C · Overcast`), dynamically updating as conditions change.
* **Caching & Performance**: Responses are cached in `localStorage` under `ipmaSkyLiveWeather` with a **15-minute Time-To-Live (TTL)**.
* **Non-Blocking Resiliency**: All network requests fail silently to the astronomical fallback if offline, ensuring the interface never stalls.
* **Dynamic Coordinate Binding**: When the user clicks the "Current location" button in the map, `setSkyLocation(lat, lon, true)` is called, updating the solar calculation and refreshing local weather observations immediately.

---

### C. Multi-Altitude Cloud Tier Rendering
Real cloud systems exist at different altitudes with distinct physical behaviors and visual characteristics. The header implements three dedicated procedural SVG layers:

| Layer | Meteorological Types | Altitude Range | Visual Appearance | Blur Filter | Animation Period |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **High Tier** (`.cloud-layer-high`) | *Cirrus, Cirrostratus* | 6,000 m – 12,000 m+ | Stretched, fibrous, semi-transparent horizontal wisps | `stdDeviation="16"` | 320 s (~5.3 min) |
| **Mid Tier** (`.cloud-layer-mid`) | *Altocumulus, Altostratus* | 2,000 m – 6,000 m | Broad, soft undulating cloud sheets that diffuse sunlight | `stdDeviation="12"` | 240 s (4.0 min) |
| **Low Tier** (`.cloud-layer-low`) | *Cumulus, Stratocumulus, Stratus* | Surface – 2,000 m | Dense, billowy puffs with defined tops and flat, shaded undersides | `stdDeviation="6"` | 160 s (~2.7 min) |

* **Individual Opacity Scaling**:
  * `--cloud-high-opacity` scales proportionally to `cloud_cover_high`.
  * `--cloud-mid-opacity` scales proportionally to `cloud_cover_mid`.
  * `--cloud-low-opacity` scales proportionally to `cloud_cover_low`.
* **Ground-Observed Ambient Motion**: Animation keyframe translations are capped at $\pm 4\%$ to $7\%$ over several minutes (~0.3 px/sec), creating a peaceful, stately drift that matches looking out of a window.

---

### D. Overcast & Weather Gloom Desaturation
When total cloud cover exceeds 65–70% (such as when Leiria is overcast at 98%):
* The vibrant azure blue is dynamically interpolated into an authentic **overcast silver-grey / slate-blue** (`#5c6b7a` $\to$ `#8292a1` $\to$ `#a4b3c2`).
* When active precipitation occurs (WMO `weather_code` $\ge 51$), the sky dims into a darker, moody graphite storm gradient (`#374151` $\to$ `#4b5563` $\to$ `#6b7280`).
* Low clouds gain density to form a continuous overcast ceiling.

---

---

### E. Atmospheric Rain Sheen Layer
* **Precipitation Detection**: When live weather observations indicate drizzle, rain, showers, or storms (WMO codes $\ge 51$), or when local radar echo is active, the `#skyRainLayer` is automatically unhidden.
* **Visual Rendering**: Pure CSS dual repeating linear gradients at $108^\circ$ diagonal tilt with an ultra-lightweight GPU translation animation (`@keyframes rainFall`), creating an authentic falling rain mist without performance overhead.

---

### F. Nighttime Astronomical Moon Phases & Starfield
* **Synodic Lunar Calculation**: Calculates the exact lunar phase fraction ($0.0 \to 1.0$) from the known astronomical epoch:
  $$D = \text{elapsed time since known new moon}; \quad \text{phase} = (D \pmod{29.530588\text{ days}}) / 29.530588$$
* **Procedural SVG Lunar Shadow**:
  * Adjusts an SVG terminator arc dynamically based on phase angle $\cos(2\pi \cdot \text{phase})$, accurately rendering New Moon, Waxing Crescent, First Quarter, Waxing Gibbous, Full Moon, Waning Gibbous, Last Quarter, and Waning Crescent.
  * Emits a delicate pearlescent radial glow halo (`#moonGlowGrad`).
* **Twinkling Starfield (`#skyStarsLayer`)**:
  * Features multi-offset star clusters with ambient asynchronous pulsing keyframes (`starPulse`).
  * Visible on clear and partly cloudy nights (hidden when cloud cover exceeds 85% to preserve physical realism).

---

### G. Frosted Glassmorphism & Accessibility Guard (`src/css/radar.css`)
* **Daylight Controls**: `background: rgba(255, 255, 255, 0.65)`, `backdrop-filter: blur(8px)`, delicate border `rgba(255, 255, 255, 0.65)`, soft shadows, and dark slate text `#1e293b`.
* **Automatic Dark-Mode Contrast (`.sky-dark`)**:
  * Automatically engaged at twilight, night, or during severe rain gloom.
  * Inverts buttons and dropdowns to dark frosted glass (`rgba(15, 23, 42, 0.60)`).
  * Inverts text and SVG strokes to crisp off-white (`#f1f5f9`), meeting WCAG 2.1 AA contrast standards.
* **Accessibility**: Includes `@media (prefers-reduced-motion: reduce)` support to freeze cloud animations for users who prefer static interfaces.

---

## 3. Code Modifications Breakdown

1. **`index.html`**:
   * Inserted `#skyBackground` container inside `#header` before `#controls`.
   * Added the 3 SVG cloud tier layers (`#skyHighClouds`, `#skyMidClouds`, `#skyLowClouds`) and Gaussian blur definitions.
   * Included `<script src="src/js/skyTheme.js"></script>` before `src/js/app.js`.

2. **`src/js/skyTheme.js`**:
   * Created new module containing solar equations, Open-Meteo live weather client, local storage caching, Leiria defaults, and DOM custom property bindings.

3. **`src/css/radar.css`**:
   * Added `#skyBackground`, `.cloud-layer-high`, `.cloud-layer-mid`, `.cloud-layer-low`.
   * Added ground-observed keyframe animations (`cloudDriftHigh`, `cloudDriftMid`, `cloudDriftLow`).
   * Updated `select`, `.control-button`, `#layerControls`, and `#opacityControls` to frosted glass.
   * Added `.sky-dark` rules for automated night and storm contrast.

4. **`src/js/app.js`**:
   * Wired `initSkyTheme()` into `initialize()` startup sequence.

5. **`src/js/radarLocation.js`**:
   * Connected `setSkyLocation(lat, lon)` to geolocation callback so sky lighting tracks user movement.

---

## 4. Completed Enhancements & Future Roadmap

### Completed in this Milestone:
1. **Option A — Live Weather & Temperature Badge**: Real-time ambient temperature and weather symbol (e.g. `☁️ 21°C · Overcast`) beside IPMA logo.
2. **Option B — Rain & Drizzle Sheen Layer**: Dynamic diagonal falling rain mist activated during active precipitation.
3. **Option C — Nighttime Moon Phases & Starfield**: Exact astronomical synodic moon phase rendering with halo and twinkling starfield for clear/partly cloudy nights.

### Future Improvement Roadmap:
1. **Direct IPMA Surface Station Telemetry**: Pull exact ground wind speed, humidity, and barometric pressure from IPMA's surface observation API (`https://api.ipma.pt/open-data/observation/meteorology/stations/obs-surface.geojson`) for station 1210702 (Leiria/Aeródromo).
2. **Interactive Location & Weather Lab Tool**: Provide an interactive control in `labs/` to test simulated conditions across Madeira, Azores, Porto, and Algarve.
