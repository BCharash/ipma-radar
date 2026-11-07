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

### B. Live Meteorological Multi-Tier Cloud Sync
The application queries Open-Meteo's open meteorological feed for current observations:
```text
https://api.open-meteo.com/v1/forecast?latitude=39.7436&longitude=-8.8071&current=cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,weather_code,is_day
```
* **Location Default**: Initialized to Leiria (`39.7436, -8.8071`).
* **Caching & Performance**: Responses are cached in `localStorage` under `ipmaSkyLiveWeather` with a **15-minute Time-To-Live (TTL)**.
* **Non-Blocking Resiliency**: All network requests fail silently to the astronomical fallback if offline, ensuring the interface never stalls.
* **Dynamic Coordinate Binding**: When the user clicks the "Current location" button in the map, `setSkyLocation(lat, lon)` is called, updating the solar calculation and refreshing local weather observations if coordinates have changed significantly.

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

### E. Frosted Glassmorphism & Accessibility Guard (`src/css/radar.css`)
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

## 4. Recommended Future Improvements

### 1. Rain / Drizzle Sheen Effect
* **Concept**: When IPMA rain radar detects active precipitation ($\ge 0.5\text{ mm/h}$) at the user's location, apply a subtle CSS misting or falling rain sheen over the header.
* **Implementation**: A lightweight CSS canvas overlay that draws sparse, semi-transparent diagonal streaks during active rain frames.

### 2. Night Lunar Phases & Star Field
* **Concept**: On clear nights ($< 25\%$ cloud cover), calculate the current moon phase (New, Crescent, Quarter, Gibbous, Full) and display a soft lunar glow alongside faint twinkling star accents.
* **Implementation**: Standard synodic lunar cycle calculation (`(date - baseNewMoon) % 29.530588` days) adjusting an SVG moon crescent path.

### 3. Direct IPMA Surface Station Telemetry
* **Concept**: While Open-Meteo provides gridded model data, IPMA operates physical surface observation stations across Portugal (e.g., Leiria / Aeródromo, station ID `1210702`).
* **Implementation**: Optionally pull ground temperature and wind speed from IPMA's surface observation API (`https://api.ipma.pt/open-data/observation/meteorology/stations/obs-surface.geojson`) to display local temperature beside the IPMA title.

### 4. Interactive Location & Weather Lab Tool
* **Concept**: Add an option in `labs/` or a developer toggle to test different Portuguese regions (Azores, Madeira, Porto, Algarve) and simulate extreme weather conditions on demand.
