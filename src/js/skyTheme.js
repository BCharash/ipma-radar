"use strict";

/*
 * skyTheme.js
 * Astronomical solar calculations and live meteorological cloud theming.
 * Shares the map startup location to render the user's local sky,
 * multi-altitude cloud layers (High, Mid, Low), overcast desaturation,
 * model-based temperature badge, rain/snow layers, and illustrative moon/stars.
 */

// Share the map fallback until its single startup geolocation request resolves.
let currentSkyCoords = {lat: DEFAULT_LOCATION.lat, lon: DEFAULT_LOCATION.lon};
const WEATHER_CACHE_KEY = "ipmaSkyLiveWeather";
const WEATHER_CACHE_TTL_MS = 15 * 60 * 1000;
const WEATHER_MAX_AGE_MS = 60 * 60 * 1000;
const SYNODIC_MONTH_MS = 29.53058770576 * 24 * 60 * 60 * 1000;
const KNOWN_NEW_MOON_MS = Date.UTC(2024, 0, 11, 11, 57);
let skyMinuteTimer = null;
let skyWeatherTimer = null;
let skyWeatherRequest = null;
let skyWeatherGeneration = 0;
let skyStartupLocationResolved = false;
let skyLocationLabel = "Default map location";
let liveWeatherData = null;

function validSkyCoords(lat, lon){
  return Number.isFinite(lat) && Math.abs(lat)<=90 && Number.isFinite(lon) && Math.abs(lon)<=180;
}

// One mapping drives text, icons and precipitation effects. Unknown is neutral.
function getSkyCondition(code){
  const definitions = [
    [[0], "Clear", "clear", null], [[1], "Mainly Clear", "mainly-clear", null],
    [[2], "Partly Cloudy", "partly-cloudy", null], [[3], "Overcast", "cloud", null],
    [[45,48], "Fog", "fog", null], [[51,53,55], "Drizzle", "rain", "rain"],
    [[56,57], "Freezing Drizzle", "rain", "rain"], [[61,63,65], "Rain", "rain", "rain"],
    [[66,67], "Freezing Rain", "rain", "rain"], [[71,73,75], "Snow", "snow", "snow"],
    [[77], "Snow Grains", "snow", "snow"], [[80,81,82], "Rain Showers", "rain", "rain"],
    [[85,86], "Snow Showers", "snow", "snow"], [[95,97], "Thunderstorm", "storm", "rain"],
    [[96,99], "Thunderstorm with Hail", "storm", "rain"]
  ];
  const entry=definitions.find(([codes])=>codes.includes(code));
  return entry ? {label:entry[1],icon:entry[2],precipitation:entry[3]} :
    {label:"Conditions unavailable",icon:"unknown",precipitation:null};
}

function getWeatherConditionName(code){ return getSkyCondition(code).label; }

function getWeatherIcon(code,isDay){
  const icon=getSkyCondition(code).icon;
  if(icon==="clear") return isDay ? "☀️" : "🌙";
  if(icon==="mainly-clear") return isDay ? "🌤️" : "🌙";
  if(icon==="partly-cloudy") return isDay ? "⛅" : "☁️";
  return {cloud:"☁️",fog:"🌫️",rain:"🌧️",snow:"🌨️",storm:"⛈️",unknown:""}[icon];
}

function skyWeatherAge(weather,now=Date.now()){
  return weather ? Math.max(now-weather.timestamp,now-weather.conditionTime) : Infinity;
}

function skyWeatherMatches(weather,lat,lon){
  return weather && validSkyCoords(weather.lat,weather.lon) &&
    Math.abs(weather.lat-lat)<0.005 && Math.abs(weather.lon-lon)<0.005 &&
    Number.isFinite(weather.timestamp) && Number.isFinite(weather.conditionTime) &&
    weather.timestamp<=Date.now()+60000 && weather.conditionTime<=Date.now()+60000;
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

/** Fetch model-based current conditions; reject superseded requests. */
async function fetchLiveWeather(lat,lon){
  if(!validSkyCoords(lat,lon)) return;
  const generation=++skyWeatherGeneration;
  skyWeatherRequest?.abort();
  const request=new AbortController();
  skyWeatherRequest=request;
  updateSkyTheme();
  const timeout=setTimeout(()=>request.abort(),10000);
  try{
    try{
      const cached=JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY));
      if(skyWeatherMatches(cached,lat,lon) && skyWeatherAge(cached)<WEATHER_MAX_AGE_MS){
        liveWeatherData=cached;
        updateSkyTheme();
        if(skyWeatherAge(cached)<WEATHER_CACHE_TTL_MS) return;
      }
    }catch(_){}
    const query=new URLSearchParams({latitude:lat.toFixed(4),longitude:lon.toFixed(4),
      current:"temperature_2m,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,weather_code",
      timeformat:"unixtime",timezone:"GMT"});
    const response=await fetch("https://api.open-meteo.com/v1/forecast?"+query,{signal:request.signal});
    if(!response.ok) throw new Error("Weather unavailable");
    const data=await response.json();
    if(request.signal.aborted || generation!==skyWeatherGeneration ||
      Math.abs(currentSkyCoords.lat-lat)>=0.005 || Math.abs(currentSkyCoords.lon-lon)>=0.005) return;
    const current=data.current;
    const conditionTime=current?.time*1000;
    if(!current || !Number.isFinite(current.time) || !Number.isFinite(conditionTime) ||
      conditionTime>Date.now()+60000 || Date.now()-conditionTime>=WEATHER_MAX_AGE_MS)
      throw new Error("Invalid weather time");
    const cover=value=>Number.isFinite(value) ? Math.max(0,Math.min(100,value)) : null;
    liveWeatherData={
      temperature:Number.isFinite(current.temperature_2m) ? Math.round(current.temperature_2m) : null,
      total:cover(current.cloud_cover),low:cover(current.cloud_cover_low),
      mid:cover(current.cloud_cover_mid),high:cover(current.cloud_cover_high),
      weatherCode:Number.isInteger(current.weather_code) ? current.weather_code : null,
      lat,lon,timestamp:Date.now(),conditionTime
    };
    try{localStorage.setItem(WEATHER_CACHE_KEY,JSON.stringify(liveWeatherData));}catch(_){}
  }catch(_){
    // Keep recent data with a stale label; expired data uses the solar-only fallback.
  }finally{
    clearTimeout(timeout);
    if(generation===skyWeatherGeneration){
      skyWeatherRequest=null;
      updateSkyTheme();
    }
  }
}

/**
 * Select a sky palette based on solar angle and model cloud cover.
 */
function getSkyPalette(elevation, weather) {
  const totalClouds = weather?.total ?? 0;
  const overcastFactor = Math.max(0, Math.min(1, (totalClouds - 50) / 45)); // 0 (clear) to 1 (full overcast)
  const isRaining = !!getSkyCondition(weather?.weatherCode).precipitation;

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

  // Independent model tiers: zero or missing cover produces no invented cloud.
  const opacity=(cover,maximum)=>Number.isFinite(cover) ? Math.max(0,Math.min(100,cover))/100*maximum : 0;
  const highOpacity=opacity(weather?.high,0.75);
  const midOpacity=opacity(weather?.mid,0.85);
  const lowOpacity=opacity(weather?.low,0.95);

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
  const weather=skyWeatherMatches(liveWeatherData,currentSkyCoords.lat,currentSkyCoords.lon) &&
    skyWeatherAge(liveWeatherData)<WEATHER_MAX_AGE_MS ? liveWeatherData : null;
  const palette = getSkyPalette(elevation, weather);
  const isNight = palette.isDark && elevation < -4;
  const totalClouds = weather?.total ?? 100;

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

  const precipitation=getSkyCondition(weather?.weatherCode).precipitation;
  const rainLayer=document.getElementById("skyRainLayer");
  const snowLayer=document.getElementById("skySnowLayer");
  if(rainLayer) rainLayer.hidden=precipitation!=="rain";
  if(snowLayer) snowLayer.hidden=precipitation!=="snow";

  // Option C: Nighttime Moon Phase & Starfield
  const moonContainer = document.getElementById("skyMoonContainer");
  const moonShadow = document.getElementById("skyMoonShadow");
  const starsLayer = document.getElementById("skyStarsLayer");

  if (isNight && totalClouds < 92) {
    const moon = getMoonPhase(now);
    if (moonContainer) {
      moonContainer.hidden = false;
      moonContainer.title = `Illustrative ${moon.name}; approximate phase, not local moon visibility`;
    }
    if (moonShadow) {
      moonShadow.setAttribute("d", moon.shadowD);
    }
    if (starsLayer) {
      // Stars twinkle through breaks when cloud cover is not solid overcast
      starsLayer.toggleAttribute("hidden",totalClouds >= 85);
    }
  } else {
    if (moonContainer) moonContainer.hidden = true;
    if (starsLayer) starsLayer.setAttribute("hidden", "");
  }

  const badge=document.getElementById("skyWeatherBadge");
  if(badge){
    const coords=`${Math.abs(currentSkyCoords.lat).toFixed(2)}°${currentSkyCoords.lat<0 ? "S" : "N"}, ${Math.abs(currentSkyCoords.lon).toFixed(2)}°${currentSkyCoords.lon<0 ? "W" : "E"}`;
    badge.hidden=false;
    if(weather){
      const time=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Lisbon",hour:"2-digit",minute:"2-digit"}).format(weather.conditionTime);
      const stale=skyWeatherAge(weather)>=WEATHER_CACHE_TTL_MS;
      const temperature=weather.temperature===null ? "" : `${weather.temperature}°C · `;
      badge.textContent=`${getWeatherIcon(weather.weatherCode,elevation>0)} ${temperature}${getWeatherConditionName(weather.weatherCode)} · ${time}${stale ? " · stale" : ""}`.trim();
      badge.title=`Open-Meteo model-based conditions · ${skyLocationLabel} (${coords}) · ${new Date(weather.conditionTime).toISOString()}${stale ? " · refresh pending or unavailable" : ""}`;
    }else{
      badge.textContent=!skyStartupLocationResolved ? "Finding startup location…" :
        skyWeatherRequest ? "Loading weather…" : "Weather unavailable";
      badge.title=`${skyLocationLabel} (${coords}) · sky colours follow the sun; weather effects unavailable`;
    }
  }

  if (palette.isDark) {
    header.classList.add("sky-dark");
  } else {
    header.classList.remove("sky-dark");
  }
}

/** Resolve the banner location once, from the map's startup location request. */
function resolveSkyStartupLocation(lat=DEFAULT_LOCATION.lat,lon=DEFAULT_LOCATION.lon,fromGps=false){
  if(skyStartupLocationResolved || !validSkyCoords(lat,lon)) return;
  skyStartupLocationResolved=true;
  skyLocationLabel=fromGps ? "Startup location" : "Default map location";
  currentSkyCoords={lat,lon};
  liveWeatherData=null;
  updateSkyTheme();
  fetchLiveWeather(lat,lon);
}

function initSkyTheme(){
  updateSkyTheme();
  clearInterval(skyMinuteTimer);
  skyMinuteTimer=setInterval(updateSkyTheme,60000);
  clearInterval(skyWeatherTimer);
  skyWeatherTimer=setInterval(()=>{
    if(skyStartupLocationResolved) fetchLiveWeather(currentSkyCoords.lat,currentSkyCoords.lon);
  },WEATHER_CACHE_TTL_MS);
}
