"use strict";

/*
 * skyTheme.js
 * Astronomical solar calculations and dynamic atmospheric sky + cloud theming.
 * Adjusts the header background gradient, cloud lighting, and control contrast
 * to match the sun's elevation angle for the current time and location.
 */

const DEFAULT_SKY_COORDS = {
  lat: 38.7223, // Lisbon, Portugal
  lon: -9.1393
};

let currentSkyCoords = { ...DEFAULT_SKY_COORDS };
let skyUpdateTimer = null;

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
 * Determine the sky appearance palette for a given solar elevation.
 */
function getSkyPalette(elevation) {
  if (elevation > 12) {
    // Broad Daylight
    return {
      gradient: "linear-gradient(180deg, #1d6fe9 0%, #4facfe 50%, #8ec5fc 100%)",
      cloudBackFill: "#ffffff",
      cloudFrontFill: "#ffffff",
      cloudBackOpacity: 0.35,
      cloudFrontOpacity: 0.65,
      isDark: false
    };
  } else if (elevation > 3) {
    // Golden Hour
    return {
      gradient: "linear-gradient(180deg, #25559c 0%, #d97706 65%, #fbbf24 100%)",
      cloudBackFill: "#fde68a",
      cloudFrontFill: "#fef3c7",
      cloudBackOpacity: 0.45,
      cloudFrontOpacity: 0.70,
      isDark: false
    };
  } else if (elevation > -4) {
    // Sunset / Sunrise / Civil Twilight
    return {
      gradient: "linear-gradient(180deg, #1e293b 0%, #9a3412 40%, #ea580c 70%, #f97316 100%)",
      cloudBackFill: "#fdba74",
      cloudFrontFill: "#fed7aa",
      cloudBackOpacity: 0.50,
      cloudFrontOpacity: 0.70,
      isDark: true
    };
  } else if (elevation > -12) {
    // Nautical Twilight / Dusk
    return {
      gradient: "linear-gradient(180deg, #090d1a 0%, #1e1b4b 50%, #312e81 100%)",
      cloudBackFill: "#4338ca",
      cloudFrontFill: "#6366f1",
      cloudBackOpacity: 0.35,
      cloudFrontOpacity: 0.55,
      isDark: true
    };
  } else {
    // Full Night
    return {
      gradient: "linear-gradient(180deg, #030712 0%, #0b1329 55%, #111d3d 100%)",
      cloudBackFill: "#1e293b",
      cloudFrontFill: "#334155",
      cloudBackOpacity: 0.30,
      cloudFrontOpacity: 0.50,
      isDark: true
    };
  }
}

/**
 * Apply the current sky theme to the header DOM.
 */
function updateSkyTheme() {
  const header = document.getElementById("header");
  if (!header) return;

  const now = new Date();
  const elevation = getSolarElevation(now, currentSkyCoords.lat, currentSkyCoords.lon);
  const palette = getSkyPalette(elevation);

  header.style.setProperty("--sky-gradient", palette.gradient);
  header.style.setProperty("--cloud-back-fill", palette.cloudBackFill);
  header.style.setProperty("--cloud-front-fill", palette.cloudFrontFill);

  const backGroup = document.getElementById("skyBackClouds");
  const frontGroup = document.getElementById("skyFrontClouds");

  if (backGroup) {
    backGroup.setAttribute("opacity", String(palette.cloudBackOpacity));
  }
  if (frontGroup) {
    frontGroup.setAttribute("opacity", String(palette.cloudFrontOpacity));
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
    currentSkyCoords = { lat, lon };
    updateSkyTheme();
  }
}

/**
 * Initialize the sky theme engine.
 */
function initSkyTheme() {
  updateSkyTheme();

  // Update every minute to track the sun smoothly
  if (skyUpdateTimer) {
    clearInterval(skyUpdateTimer);
  }
  skyUpdateTimer = setInterval(updateSkyTheme, 60000);
}
