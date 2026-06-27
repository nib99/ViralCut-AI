/**
 * PexelsService — ViralCut AI
 * Fetches free HD stock videos from Pexels API.
 * Falls back to solid color backgrounds if no key or API fails.
 */

window.PexelsService = (function () {
  'use strict';

  const BASE_URL      = 'https://api.pexels.com/videos/search';
  const FALLBACK_SIZE = { width: 1080, height: 1920 };
  const CACHE         = new Map(); // simple in-memory cache per session

  /* ----------------------------------------
     COLOR FALLBACKS (beautiful dark gradients)
  ---------------------------------------- */
  const FALLBACK_GRADIENTS = [
    ['#080c14', '#0e1f3d'],
    ['#0f0a1e', '#2d1b69'],
    ['#0a1a0f', '#0d3320'],
    ['#1a0a0a', '#3d1515'],
    ['#0a1520', '#1a3a5c'],
    ['#150a20', '#3d2060'],
  ];

  /* ----------------------------------------
     SEARCH PEXELS
  ---------------------------------------- */

  /**
   * Search for a video clip matching the keyword.
   * Returns a URL string or null.
   *
   * @param {string} keyword
   * @param {string} apiKey   — Pexels API key
   * @returns {Promise<string|null>}
   */
  async function searchVideo(keyword, apiKey) {
    if (!apiKey) return null;

    // Return cached result if available
    const cacheKey = keyword.toLowerCase().trim();
    if (CACHE.has(cacheKey)) {
      Logger.info(`Pexels: cache hit for "${keyword}"`);
      return CACHE.get(cacheKey);
    }

    const params = new URLSearchParams({
      query:       keyword,
      per_page:    5,
      size:        'medium',
      orientation: 'portrait', // 9:16 for vertical video
    });

    const url = `${BASE_URL}?${params}`;
    Logger.info(`Pexels: searching for "${keyword}"`);

    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(url, {
        headers: { Authorization: apiKey },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        Logger.warn(`Pexels API returned ${response.status} for "${keyword}"`);
        return null;
      }

      const data = await response.json();
      const videos = data.videos || [];

      if (!videos.length) {
        Logger.warn(`Pexels: no results for "${keyword}"`);
        return null;
      }

      // Pick best quality video file ≤1080p
      const videoUrl = _selectBestFile(videos[0].video_files);
      if (videoUrl) {
        CACHE.set(cacheKey, videoUrl);
        Logger.ok(`Pexels: found video for "${keyword}"`);
      }
      return videoUrl;

    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        Logger.warn(`Pexels: request timed out for "${keyword}"`);
      } else {
        Logger.warn(`Pexels: fetch failed — ${err.message}`);
      }
      return null;
    }
  }

  function _selectBestFile(files) {
    if (!files?.length) return null;

    // Prefer portrait HD
    const sorted = files
      .filter(f => f.file_type === 'video/mp4' && f.height >= 720)
      .sort((a, b) => {
        // Prefer files closest to 1080p height
        const aDiff = Math.abs(a.height - 1080);
        const bDiff = Math.abs(b.height - 1080);
        return aDiff - bDiff;
      });

    return sorted[0]?.link || files[0]?.link || null;
  }

  /* ----------------------------------------
     FETCH FOOTAGE FOR ALL SCENES
  ---------------------------------------- */

  /**
   * Fetch video URLs for an array of scenes.
   * Returns an array of { type, url, isVideo } objects.
   *
   * @param {Array}  scenes   — script.scenes
   * @param {string} apiKey
   * @returns {Promise<Array>}
   */
  async function fetchSceneFootage(scenes, apiKey) {
    Logger.group('PexelsService.fetchSceneFootage');
    Logger.info(`Fetching footage for ${scenes.length} scenes`);

    const results = await Promise.allSettled(
      scenes.map(async (scene, i) => {
        const keyword = scene.keyword || scene.type;
        const url = await searchVideo(keyword, apiKey);
        return {
          sceneIndex: i,
          type:       url ? 'video' : 'gradient',
          url:        url || null,
          gradient:   FALLBACK_GRADIENTS[i % FALLBACK_GRADIENTS.length],
          color:      scene.color,
        };
      })
    );

    const footage = results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      Logger.warn(`Scene ${i + 1} footage failed, using fallback`);
      return {
        sceneIndex: i,
        type: 'gradient',
        url:  null,
        gradient: FALLBACK_GRADIENTS[i % FALLBACK_GRADIENTS.length],
        color: scenes[i]?.color,
      };
    });

    const videoCount = footage.filter(f => f.type === 'video').length;
    Logger.ok(`Footage ready: ${videoCount}/${scenes.length} videos, ${scenes.length - videoCount} gradients`);
    Logger.groupEnd();

    return footage;
  }

  /**
   * Get a fallback gradient for a scene index
   */
  function getFallbackGradient(index) {
    return FALLBACK_GRADIENTS[index % FALLBACK_GRADIENTS.length];
  }

  return { searchVideo, fetchSceneFootage, getFallbackGradient };
}());
