/**
 * Comfortable environmental sound, played from local CC0 recordings in media/.
 * HTMLAudioElement keeps direct file:// playback working without fetch/CORS.
 * Track files have pre-crossfaded loop seams; scene changes fade their volumes.
 */
(function (root) {
  'use strict';

  const TRACKS = [
    'rain',
    'daylight',
    'night',
    'winter-daylight',
    'winter-snow',
    'coast',
    'brook',
    'hearth',
    'wind',
  ];
  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

  function smoothstep(start, end, value) {
    const amount = clamp((value - start) / (end - start), 0, 1);
    return amount * amount * (3 - 2 * amount);
  }

  // Pure mix selection is separate from playback so seasonal and weather rules
  // can be checked without a browser or sound device. Values are track gains.
  function selectAmbience(environment) {
    const {
      hour,
      daylightHours,
      season,
      rain,
      snow,
      gale,
      wind,
      shoreDistance,
      freshwaterDistance,
      distanceFromHall,
      hallActive,
      screen,
    } = environment;
    const sunrise = environment.sunriseHour ?? 12 - daylightHours / 2;
    const sunset = environment.sunsetHour ?? 12 + daylightHours / 2;
    const daylight =
      smoothstep(sunrise - 0.5, sunrise + 0.5, hour) *
      (1 - smoothstep(sunset - 0.5, sunset + 0.5, hour));
    const winter = season === 'winter' || snow;
    const liquidRain = rain && !snow;
    const quietBirds = liquidRain || gale ? 0.15 : 1;
    const mix = {
      rain: liquidRain ? (gale ? 0.7 : 0.58) : 0,
      daylight: winter ? 0 : daylight * 0.55 * quietBirds,
      night: (1 - daylight) * (winter ? 0.2 : 0.45),
      'winter-daylight': winter ? (0.22 + daylight * 0.3) * (snow ? 0.3 : 1) : 0,
      'winter-snow': snow ? 0.6 : 0,
      coast: Math.exp(-Math.abs(shoreDistance) / 100) * 0.42,
      brook: Math.exp(-Math.max(0, freshwaterDistance) / 16) * (winter ? 0.05 : 0.25),
      hearth: hallActive ? Math.exp(-distanceFromHall / 22) * 0.32 : 0,
      wind: clamp((wind - 18) / 38, 0, 1) * (gale ? 0.32 : 0.15),
    };
    if (screen === 'atlantic') {
      for (const key of TRACKS) {
        mix[key] = 0;
      }
      mix.coast = 0.5;
      mix.wind = 0.12;
    }
    return mix;
  }

  function describeEnvironment(simulation, world, screen) {
    const config = simulation.state.config;
    const point = world.view === 'walk' ? simulation.state.leader : world.target;
    const measured = config.site === 'meadows';
    const shoreDistance = measured
      ? root.VinlandMeadows.shoreDistance(point.x, point.z)
      : point.x - root.VinlandModel.coast(point.z, config);
    const freshwaterDistance = measured
      ? root.VinlandMeadows.freshwaterDistance(point.x, point.z)
      : Math.hypot(point.x - 46, point.z - 28);
    const activeHearths = root.VinlandHearths.definitions(simulation.state).filter(
      (hearth) => root.VinlandHearths.view(simulation, hearth.id).powerKW > 0.1,
    );
    return {
      ...simulation.weather,
      hour: simulation.hour,
      daylightHours: simulation.weather.daylight,
      season: simulation.season,
      shoreDistance,
      freshwaterDistance,
      // Keep the mix input name compatible; its distance now follows the
      // nearest actual fire, including hearths in newly built houses.
      distanceFromHall: activeHearths.reduce(
        (distance, hearth) =>
          Math.min(distance, Math.hypot(point.x - hearth.x, point.z - hearth.z)),
        Infinity,
      ),
      hallActive: activeHearths.length > 0,
      screen,
    };
  }

  class AmbiencePlayer {
    constructor(volume = 0.6) {
      this.enabled = false;
      this.volume = clamp(volume, 0, 1);
      this.tracks = new Map();
      this.lastMix = {};
      this.onVisibility = () => {
        if (document.hidden) {
          this.pauseAll();
        }
      };
      this.onPageHide = () => this.pauseAll();
      document.addEventListener('visibilitychange', this.onVisibility);
      window.addEventListener('pagehide', this.onPageHide);
    }

    createTracks() {
      for (const key of TRACKS) {
        const element = new Audio(`media/${key}.mp3`);
        element.preload = 'auto';
        element.loop = true;
        element.volume = 0;
        this.tracks.set(key, { element, failed: false, starting: false });
      }
    }

    async setEnabled(enabled) {
      this.enabled = enabled;
      if (!enabled) {
        return;
      }
      if (!this.tracks.size) {
        this.createTracks();
      }
      // Prime all recordings during the explicit user gesture. Subsequent
      // weather changes can then resume previously played tracks smoothly.
      try {
        await Promise.all(
          [...this.tracks.values()].map(async (track) => {
            track.failed = false;
            track.starting = true;
            try {
              await track.element.play();
            } finally {
              track.starting = false;
            }
          }),
        );
      } catch (error) {
        this.enabled = false;
        this.pauseAll();
        throw error;
      }
    }

    setVolume(volume) {
      this.volume = clamp(volume, 0, 1);
    }

    update(deltaSeconds, context) {
      if (!this.tracks.size) {
        return;
      }
      const mix = selectAmbience(
        describeEnvironment(context.simulation, context.world, context.screen),
      );
      this.lastMix = mix;
      const audible = this.enabled && !document.hidden && !context.atTitleScreen;
      const master = audible ? this.volume * (context.menuOpen ? 0.6 : 1) : 0;
      const blend = 1 - Math.exp(-deltaSeconds * (audible ? 1.1 : 8));
      for (const [key, track] of this.tracks) {
        const element = track.element;
        const target = mix[key] * master;
        element.volume = clamp(element.volume + (target - element.volume) * blend, 0, 1);
        if (target > 0.002 && element.paused && !track.starting && !track.failed) {
          track.starting = true;
          element
            .play()
            .catch(() => {
              track.failed = true;
            })
            .finally(() => {
              track.starting = false;
            });
        }
        if (target === 0 && element.volume < 0.001 && !track.starting) {
          element.volume = 0;
          element.pause();
        }
      }
    }

    pauseAll() {
      for (const { element } of this.tracks.values()) {
        element.volume = 0;
        element.pause();
      }
    }

    dispose() {
      this.pauseAll();
      for (const { element } of this.tracks.values()) {
        element.removeAttribute('src');
        element.load();
      }
      this.tracks.clear();
      document.removeEventListener('visibilitychange', this.onVisibility);
      window.removeEventListener('pagehide', this.onPageHide);
    }
  }

  const audio = { TRACKS, selectAmbience, AmbiencePlayer };
  if (typeof module !== 'undefined') {
    module.exports = audio;
  } else {
    root.VinlandAudio = audio;
  }
})(typeof window === 'undefined' ? globalThis : window);
