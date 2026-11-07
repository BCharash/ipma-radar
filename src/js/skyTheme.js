"use strict";

/*
 * skyTheme.js
 * Astronomical solar calculations and live meteorological cloud theming.
 * Adjusts header sky gradients, multi-altitude cloud layers (High, Mid, Low),
 * overcast desaturation, and control contrast based on real-time solar elevation
 * and live weather observations.
 */

const DEFAULT_SKY_COORDS = {
  lat: 39.7436, // Leiria, Portugal
  lon: -8.8071
};

const WEATHER_CACHE_KEY = "ipmaSkyLiveWeather";
const WEATHER_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

let currentSkyCoords = { ...DEFAULT_SKY_COORDS };
let skyMinuteTimer = null;
let skyWeatherTimer = null;

// Live meteorological cloud state
let liveWeatherData = null;

/**
 * Approximate the sun's elevation angle in degrees.
 * Uses standard solar astronomical formulas (declination, equation of time, hour angle).
 */
function getSolarElevation(date, lat, lon) {
  const year = date.getUTCFullYear();
  const startOfYear = new Date(Date.UTC(year, 0, 1));
  const dayOfYear = Math.floor((date - startOfYear) / (24 * 60 * 60 * 1000)) + 1;

  // Fractional year in radians
  const gamma = (2 * Math.PI / 365) * (dayOfYear - 1 + (date.getUTCHours() - 12) / 24);

  // Equation of time in minutes
  const eqtime = 229.18 * (
    0.000075 +
    0.001868 * Math.cos(gamma) -
    0.032077 * Math.sin(gamma) -
    0.014615 * Math.cos(2 * gamma) -
    0.040849 * Math.sin(2 * gamma)
  );

  // Solar declination in radians
  const decl = 0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.001480 * Math.sin(3 * gamma);

  // True solar time in minutes
  const timeOffset = eqtime + 4 * lon;
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  let trueSolarTime = (utcMinutes + timeOffset) % 1440;
  if (trueSolarTime < 0) trueSolarTime += 1440;

  // Solar hour angle in degrees (-180 to 180)
  let hourAngle = (trueSolarTime / 4) - 180;
  if (hourAngle < -180) hourAngle += 360;

  const latRad = lat * (Math.PI / 180);
  const hourAngleRad = hourAngle * (Math.PI / 180);

  // Solar zenith cosine
  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const sinDecl = Math.sin(decl);
  const cosDecl = Math.cos(decl);

  const cosZenith = (sinLat * sinDecl) + (cosLat * cosDecl * Math.cos(hourAngleRad));
  const zenith = Math.acos(Math.max(-1, Math.min(1, cosZenith)));
  const elevationDeg = 90 - (zenith * (180 / Math.PI));

  return elevationDeg;
}

/**
 * Fetch live cloud cover tiers from Open-Meteo.
 * Free, open, no API key, cached in localStorage for 15 minutes.
 */
async function fetchLiveWeather(lat, lon) {
  // Check local cache first
  try {
    const cached = localStorage.getItem(WEATHER_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (
        parsed &&
        Date.now() - parsed.timestamp < WEATHER_CACHE_TTL_MS &&
        Math.abs(parsed.lat - lat) < 0.2 &&
        Math.abs(parsed.lon - lon) < 0.2
      ) {
        liveWeatherData = parsed;
        updateSkyTheme();
        return;
      }
    }
  } catch (_) {}

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,weather_code,is_day`;

  try {
    const response = await fetch(url);
    if (!response.ok) return;

    const data = await response.json();
    if (data && data.current) {
      liveWeatherData = {
        total: typeof data.current.cloud_cover === "number" ? data.current.cloud_cover : 50,
        low: typeof data.current.cloud_cover_low === "number" ? data.current.cloud_cover_low : 30,
        mid: typeof data.current.cloud_cover_mid === "number" ? data.current.cloud_cover_mid : 30,
        high: typeof data.current.cloud_cover_high === "number" ? data.current.cloud_cover_high : 30,
        weatherCode: typeof data.current.weather_code === "number" ? data.current.weather_code : 0,
        lat,
        lon,
        timestamp: Date.now()
      };

      try {
        localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(liveWeatherData));
      } catch (_) {}

      updateSkyTheme();
    }
  } catch (err) {
    // Non-blocking: continue with astronomical fallback
  }
}

/**
 * Interpolate the sky palette based on solar angle AND live cloud cover.
 */
function getSkyPalette(elevation, weather) {
  const totalClouds = weather ? weather.total : 45;
  const isOvercast = totalClouds >= 65;
  const overcastFactor = Math.max(0, Math.min(1, (totalClouds - 50) / 45)); // 0 (clear) to 1 (full overcast)
  const isRaining = weather && weather.weatherCode >= 51; // WMO codes >= 51 are rain, drizzle, or showers

  let gradient = "";
  let cloudHighFill = "#ffffff";
  let cloudMidFill = "#ffffff";
  let cloudLowFill = "#ffffff";
  let isDark = false;

  if (elevation > 12) {
    // Broad Daylight
    if (isRaining) {
      gradient = "linear-gradient(180deg, #374151 0%, #4b5563 50%, #6b7280 100%)";
      cloudHighFill = "#cbd5e1";
      cloudMidFill = "#94a3b8";
      cloudLowFill = "#64748b";
      isDark = true;
    } else if (overcastFactor > 0.4) {
      // Overcast silver/slate sky
      gradient = "linear-gradient(180deg, #5c6b7a 0%, #8292a1 50%, #a4b3c2 100%)";
      cloudHighFill = "#e2e8f0";
      cloudMidFill = "#cbd5e1";
      cloudLowFill = "#94a3b8";
      isDark = false;
    } else {
      // Clear azure / sky blue
      gradient = "linear-gradient(180deg, #1d6fe9 0%, #4facfe 50%, #8ec5fc 100%)";
      cloudHighFill = "#ffffff";
      cloudMidFill = "#ffffff";
      cloudLowFill = "#ffffff";
      isDark = false;
    }
  } else if (elevation > 3) {
    // Golden Hour
    if (overcastFactor > 0.5) {
      gradient = "linear-gradient(180deg, #334155 0%, #64748b 50%, #94a3b8 100%)";
      cloudHighFill = "#cbd5e1";
      cloudMidFill = "#94a3b8";
      cloudLowFill = "#64748b";
      isDark = false;
    } else {
      gradient = "linear-gradient(180deg, #25559c 0%, #d97706 65%, #fbbf24 100%)";
      cloudHighFill = "#fed7aa";
      cloudMidFill = "#fde68a";
      cloudLowFill = "#fef3c7";
      isDark = false;
    }
  } else if (elevation > -4) {
    // Sunset / Sunrise / Civil Twilight
    if (overcastFactor > 0.6) {
      gradient = "linear-gradient(180deg, #1e293b 0%, #475569 50%, #64748b 100%)";
      cloudHighFill = "#94a3b8";
      cloudMidFill = "#64748b";
      cloudLowFill = "#475569";
      isDark = true;
    } else {
      gradient = "linear-gradient(180deg, #1e293b 0%, #9a3412 40%, #ea580c 70%, #f97316 100%)";
      cloudHighFill = "#fed7aa";
      cloudMidFill = "#fdba74";
      cloudLowFill = "#fed7aa";
      isDark = true;
    }
  } else if (elevation > -12) {
    // Nautical Twilight / Dusk
    gradient = "linear-gradient(180deg, #090d1a 0%, #1e1b4b 50%, #312e81 100%)";
    cloudHighFill = "#4338ca";
    cloudMidFill = "#475569";
    cloudLowFill = "#334155";
    isDark = true;
  } else {
    // Full Night
    if (overcastFactor > 0.6) {
      gradient = "linear-gradient(180deg, #020617 0%, #0b1120 55%, #151f38 100%)";
    } else {
      gradient = "linear-gradient(180deg, #030712 0%, #0b1329 55%, #111d3d 100%)";
    }
    cloudHighFill = "#1e293b";
    cloudMidFill = "#1e293b";
    cloudLowFill = "#334155";
    isDark = true;
  }

  // Calculate separate opacities for the 3 altitude tiers
  let highOpacity = 0.35;
  let midOpacity = 0.45;
  let lowOpacity = 0.60;

  if (weather) {
    // High clouds (Cirrus wisps): delicate, wide spread
    highOpacity = Math.max(0.06, (weather.high / 100) * 0.75);
    // Mid clouds (Altocumulus sheets): moderate density
    midOpacity = Math.max(0.08, (weather.mid / 100) * 0.85);
    // Low clouds (Cumulus/Stratus puffs): heavy, dominant
    lowOpacity = Math.max(0.12, (weather.low / 100) * 0.95);

    // If total cloud cover is very high, boost low clouds to form a continuous ceiling
    if (weather.total > 75) {
      lowOpacity = Math.max(lowOpacity, 0.78);
      midOpacity = Math.max(midOpacity, 0.65);
    }
  }

  return {
    gradient,
    cloudHighFill,
    cloudMidFill,
    cloudLowFill,
    highOpacity,
    midOpacity,
    lowOpacity,
    isDark
  };
}

/**
 * Apply the current sky theme and multi-tier cloud properties to the header DOM.
 */
function updateSkyTheme() {
  const header = document.getElementById("header");
  if (!header) return;

  const now = new Date();
  const elevation = getSolarElevation(now, currentSkyCoords.lat, currentSkyCoords.lon);
  const palette = getSkyPalette(elevation, liveWeatherData);

  header.style.setProperty("--sky-gradient", palette.gradient);
  header.style.setProperty("--cloud-high-fill", palette.cloudHighFill);
  header.style.setProperty("--cloud-mid-fill", palette.cloudMidFill);
  header.style.setProperty("--cloud-low-fill", palette.cloudLowFill);

  const highGroup = document.getElementById("skyHighClouds");
  const midGroup = document.getElementById("skyMidClouds");
  const lowGroup = document.getElementById("skyLowClouds");

  if (highGroup) {
    highGroup.setAttribute("opacity", palette.highOpacity.toFixed(2));
  }
  if (midGroup) {
    midGroup.setAttribute("opacity", palette.midOpacity.toFixed(2));
  }
  if (lowGroup) {
    lowGroup.setAttribute("opacity", palette.lowOpacity.toFixed(2));
  }

  if (palette.isDark) {
    header.classList.add("sky-dark");
  } else {
    header.classList.remove("sky-dark");
  }
}

/**
 * Allow location updates (e.g., when the user pans or uses geolocation).
 */
function setSkyLocation(lat, lon) {
  if (typeof lat === "number" && typeof lon === "number") {
    const movedSignificantly =
      Math.abs(currentSkyCoords.lat - lat) > 0.2 ||
      Math.abs(currentSkyCoords.lon - lon) > 0.2;

    currentSkyCoords = { lat, lon };
    updateSkyTheme();

    if (movedSignificantly) {
      fetchLiveWeather(lat, lon);
    }
  }
}

/**
 * Initialize the sky theme engine.
 */
function initSkyTheme() {
  updateSkyTheme();
  fetchLiveWeather(currentSkyCoords.lat, currentSkyCoords.lon);

  // Update solar angle every minute
  if (skyMinuteTimer) {
    clearInterval(skyMinuteTimer);
  }
  skyMinuteTimer = setInterval(updateSkyTheme, 60000);

  // Refresh live weather conditions every 15 minutes
  if (skyWeatherTimer) {
    clearInterval(skyWeatherTimer);
  }
  skyWeatherTimer = setInterval(() => {
    fetchLiveWeather(currentSkyCoords.lat, currentSkyCoords.lon);
  }, WEATHER_CACHE_TTL_MS);
}
