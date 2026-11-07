"use strict";

/*
 * skyTheme.js
 * Astronomical solar calculations and live meteorological cloud theming.
 * Checks GPS on startup to automatically fetch and render the user's local sky,
 * multi-altitude cloud layers (High, Mid, Low), overcast desaturation,
 * real-time temperature badge, rain/drizzle mist layer, and nighttime moon/stars.
 */

const DEFAULT_SKY_COORDS = {
  lat: 39.7436, // Leiria, Portugal
  lon: -8.8071
};

const GPS_CACHE_KEY = "ipmaUserGpsCoords";
const WEATHER_CACHE_KEY = "ipmaSkyLiveWeather";
const WEATHER_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const SYNODIC_MONTH_MS = 29.53058770576 * 24 * 60 * 60 * 1000;
const KNOWN_NEW_MOON_MS = Date.UTC(2024, 0, 11, 11, 57);

// Initialize coordinates from persistent GPS cache if previously detected
let currentSkyCoords = (function getInitialCoords() {
  try {
    const cached = localStorage.getItem(GPS_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed && typeof parsed.lat === "number" && typeof parsed.lon === "number") {
        return { lat: parsed.lat, lon: parsed.lon };
      }
    }
  } catch (_) {}
  return { ...DEFAULT_SKY_COORDS };
})();

let skyMinuteTimer = null;
let skyWeatherTimer = null;

// Live meteorological cloud & temperature state
let liveWeatherData = null;

/**
 * Return friendly condition label from WMO weather code.
 */
function getWeatherConditionName(code) {
  if (code === 0) return "Clear";
  if (code === 1) return "Mainly Clear";
  if (code === 2) return "Partly Cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 55) return "Drizzle";
  if (code >= 61 && code <= 65) return "Rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Showers";
  if (code >= 95) return "Thunderstorm";
  return "Cloudy";
}

/**
 * Return appropriate weather icon/symbol based on condition code and time of day.
 */
function getWeatherIcon(code, isDay) {
  if (code >= 95) return "⛈️";
  if (code >= 80 && code <= 82) return "🌧️";
  if (code >= 71 && code <= 77) return "🌨️";
  if (code >= 61 && code <= 65) return "🌧️";
  if (code >= 51 && code <= 55) return "🌦️";
  if (code === 45 || code === 48) return "🌫️";
  if (code === 3) return "☁️";
  if (code === 2) return isDay ? "⛅" : "☁️";
  if (code === 1) return isDay ? "🌤️" : "🌙";
  return isDay ? "☀️" : "🌙";
}

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
 * Calculate the astronomical moon phase and SVG shadow path for a given date.
 */
function getMoonPhase(date) {
  const elapsed = date.getTime() - KNOWN_NEW_MOON_MS;
  let phaseFraction = (elapsed % SYNODIC_MONTH_MS) / SYNODIC_MONTH_MS;
  if (phaseFraction < 0) phaseFraction += 1;

  let name = "New Moon";
  if (phaseFraction >= 0.03 && phaseFraction < 0.22) name = "Waxing Crescent";
  else if (phaseFraction >= 0.22 && phaseFraction < 0.28) name = "First Quarter";
  else if (phaseFraction >= 0.28 && phaseFraction < 0.47) name = "Waxing Gibbous";
  else if (phaseFraction >= 0.47 && phaseFraction < 0.53) name = "Full Moon";
  else if (phaseFraction >= 0.53 && phaseFraction < 0.72) name = "Waning Gibbous";
  else if (phaseFraction >= 0.72 && phaseFraction < 0.78) name = "Last Quarter";
  else if (phaseFraction >= 0.78 && phaseFraction < 0.97) name = "Waning Crescent";

  // Calculate SVG arc path for shadow covering the unilluminated portion
  let shadowD = "";
  if (phaseFraction <= 0.02 || phaseFraction >= 0.98) {
    // New moon: fully shadowed
    shadowD = "M 17 30 A 13 13 0 1 0 43 30 A 13 13 0 1 0 17 30 Z";
  } else if (phaseFraction >= 0.48 && phaseFraction <= 0.52) {
    // Full moon: no shadow
    shadowD = "";
  } else {
    const k = Math.cos(2 * Math.PI * phaseFraction);
    const rx = Math.max(0.1, Math.abs(k) * 13).toFixed(1);
    if (phaseFraction < 0.5) {
      // Waxing: dark side on left
      const sweep = k > 0 ? 0 : 1;
      shadowD = `M 30 17 A 13 13 0 0 0 30 43 A ${rx} 13 0 0 ${sweep} 30 17 Z`;
    } else {
      // Waning: dark side on right
      const sweep = k > 0 ? 0 : 1;
      shadowD = `M 30 17 A 13 13 0 0 1 30 43 A ${rx} 13 0 0 ${sweep} 30 17 Z`;
    }
  }

  return { fraction: phaseFraction, name, shadowD };
}

/**
 * Fetch live weather observations from Open-Meteo.
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
        Math.abs(parsed.lat - lat) < 0.05 &&
        Math.abs(parsed.lon - lon) < 0.05
      ) {
        liveWeatherData = parsed;
        updateSkyTheme();
        return;
      }
    }
  } catch (_) {}

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=temperature_2m,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,weather_code,is_day`;

  try {
    const response = await fetch(url);
    if (!response.ok) return;

    const data = await response.json();
    if (data && data.current) {
      liveWeatherData = {
        temperature: typeof data.current.temperature_2m === "number" ? Math.round(data.current.temperature_2m) : null,
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
 * Apply the current sky theme, multi-tier clouds, moon, stars, rain, and badge to the DOM.
 */
function updateSkyTheme() {
  const header = document.getElementById("header");
  if (!header) return;

  const now = new Date();
  const elevation = getSolarElevation(now, currentSkyCoords.lat, currentSkyCoords.lon);
  const palette = getSkyPalette(elevation, liveWeatherData);
  const isNight = palette.isDark && elevation < -4;
  const totalClouds = liveWeatherData ? liveWeatherData.total : 50;

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

  // Option B: Rain & Drizzle Sheen Layer
  const rainLayer = document.getElementById("skyRainLayer");
  if (rainLayer) {
    const isRaining = liveWeatherData && liveWeatherData.weatherCode >= 51;
    rainLayer.hidden = !isRaining;
  }

  // Option C: Nighttime Moon Phase & Starfield
  const moonContainer = document.getElementById("skyMoonContainer");
  const moonShadow = document.getElementById("skyMoonShadow");
  const starsLayer = document.getElementById("skyStarsLayer");

  if (isNight && totalClouds < 92) {
    const moon = getMoonPhase(now);
    if (moonContainer) {
      moonContainer.hidden = false;
      moonContainer.title = `${moon.name} (${Math.round(moon.fraction * 100)}% cycle)`;
    }
    if (moonShadow) {
      moonShadow.setAttribute("d", moon.shadowD);
    }
    if (starsLayer) {
      // Stars twinkle through breaks when cloud cover is not solid overcast
      starsLayer.hidden = totalClouds >= 85;
    }
  } else {
    if (moonContainer) moonContainer.hidden = true;
    if (starsLayer) starsLayer.hidden = true;
  }

  // Option A: Live Weather Badge (Icon + Temperature + Condition)
  const badge = document.getElementById("skyWeatherBadge");
  if (badge && liveWeatherData && liveWeatherData.temperature !== null) {
    const condition = getWeatherConditionName(liveWeatherData.weatherCode);
    const icon = getWeatherIcon(liveWeatherData.weatherCode, elevation > 0);
    badge.textContent = `${icon} ${liveWeatherData.temperature}°C · ${condition}`;
    badge.title = `Current observation for ${currentSkyCoords.lat.toFixed(2)}°N, ${Math.abs(currentSkyCoords.lon).toFixed(2)}°W`;
    badge.hidden = false;
  }

  if (palette.isDark) {
    header.classList.add("sky-dark");
  } else {
    header.classList.remove("sky-dark");
  }
}

/**
 * Allow location updates (e.g. from GPS or map navigation).
 */
function setSkyLocation(lat, lon, force = false) {
  if (typeof lat === "number" && typeof lon === "number") {
    const moved =
      Math.abs(currentSkyCoords.lat - lat) > 0.03 ||
      Math.abs(currentSkyCoords.lon - lon) > 0.03;

    currentSkyCoords = { lat, lon };

    try {
      localStorage.setItem(GPS_CACHE_KEY, JSON.stringify({ lat, lon }));
    } catch (_) {}

    updateSkyTheme();

    if (moved || force || !liveWeatherData) {
      fetchLiveWeather(lat, lon);
    }
  }
}

/**
 * Check device GPS on startup to ensure the sky reflects the user's exact physical location.
 */
function checkGpsOnStartup() {
  if (!navigator.geolocation) return;

  navigator.geolocation.getCurrentPosition(
    position => {
      const { latitude: lat, longitude: lon } = position.coords;
      setSkyLocation(lat, lon, true);
    },
    () => {
      // Silent on permission denial or timeout: fallback to cached GPS or Leiria defaults
    },
    {
      enableHighAccuracy: true,
      timeout: 9000,
      maximumAge: 120000
    }
  );
}

/**
 * Initialize the sky theme engine on app startup.
 */
function initSkyTheme() {
  updateSkyTheme();
  fetchLiveWeather(currentSkyCoords.lat, currentSkyCoords.lon);
  checkGpsOnStartup();

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
