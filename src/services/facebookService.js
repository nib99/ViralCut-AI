/**
 * FacebookService — ViralCut AI
 * Handles video upload to a single Facebook Page using the Graph API.
 *
 * Flow:
 *  1. Validate token with /me endpoint
 *  2. Initiate resumable video upload (chunked for large files)
 *  3. Transfer chunks
 *  4. Finish upload with title, description, and publish settings
 *
 * References:
 *  https://developers.facebook.com/docs/video-api/guides/reels-publishing
 *  https://developers.facebook.com/docs/graph-api/video-uploads
 */

window.FacebookService = (function () {
  'use strict';

  const GRAPH_API = 'https://graph.facebook.com/v19.0';
  const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB per chunk

  /* ----------------------------------------
     TOKEN VALIDATION
  ---------------------------------------- */

  /**
   * Validate a Page Access Token and get page info.
   * @param {string} token  — Page access token
   * @param {string} pageId — Facebook Page ID
   * @returns {Promise<{name: string, id: string}>}
   */
  async function validateToken(token, pageId) {
    if (!token || !pageId) throw new Error('Page ID and access token are required');

    Logger.info('Facebook: validating token…');

    const url = `${GRAPH_API}/${pageId}?fields=name,id&access_token=${token}`;
    const response = await fetch(url);
    const data     = await response.json();

    if (data.error) {
      throw new Error(`Facebook token error: ${data.error.message}`);
    }

    Logger.ok(`Facebook: authenticated as page "${data.name}" (${data.id})`);
    return data;
  }

  /* ----------------------------------------
     UPLOAD VIDEO (resumable/chunked)
  ---------------------------------------- */

  /**
   * Upload a video Blob to the Facebook Page.
   *
   * @param {Blob}     videoBlob  — The recorded video
   * @param {string}   pageId     — Facebook Page ID
   * @param {string}   token      — Page access token
   * @param {Object}   meta       — { title, description }
   * @param {Function} onProgress — (0-1) progress callback
   * @returns {Promise<{videoId: string, shareUrl: string}>}
   */
  async function uploadVideo(videoBlob, pageId, token, meta = {}, onProgress) {
    Logger.group('FacebookService.uploadVideo');
    Logger.info(`Starting upload. Size: ${(videoBlob.size / 1024 / 1024).toFixed(1)}MB`);

    // For blobs > 4MB, use resumable upload (phase-based)
    if (videoBlob.size > CHUNK_SIZE) {
      return await _resumableUpload(videoBlob, pageId, token, meta, onProgress);
    } else {
      return await _simpleUpload(videoBlob, pageId, token, meta, onProgress);
    }
  }

  /* ----------------------------------------
     SIMPLE UPLOAD (small files < 4MB)
  ---------------------------------------- */

  async function _simpleUpload(blob, pageId, token, meta, onProgress) {
    Logger.info('Using simple upload (file < 4MB)');
    onProgress?.(0.1);

    const formData = new FormData();
    formData.append('source',      blob, 'video.webm');
    formData.append('title',       meta.title       || 'ViralCut AI Video');
    formData.append('description', meta.description || '');
    formData.append('published',   'true');
    formData.append('access_token', token);

    const response = await fetch(`${GRAPH_API}/${pageId}/videos`, {
      method: 'POST',
      body:   formData,
    });

    onProgress?.(0.9);
    const data = await response.json();

    if (data.error) throw new Error(`Upload failed: ${data.error.message}`);

    Logger.ok(`Simple upload complete. Video ID: ${data.id}`);
    onProgress?.(1);
    Logger.groupEnd();

    return {
      videoId:  data.id,
      shareUrl: `https://www.facebook.com/video/${data.id}`,
    };
  }

  /* ----------------------------------------
     RESUMABLE UPLOAD (files > 4MB, 3 phases)
  ---------------------------------------- */

  async function _resumableUpload(blob, pageId, token, meta, onProgress) {
    Logger.info('Using resumable chunked upload');

    // Phase 1: Start
    Logger.info('Phase 1: Initializing upload session…');
    const startForm = new FormData();
    startForm.append('upload_phase', 'start');
    startForm.append('file_size',    blob.size);
    startForm.append('access_token', token);

    const startResp = await fetch(`${GRAPH_API}/${pageId}/videos`, {
      method: 'POST',
      body:   startForm,
    });
    const startData = await startResp.json();

    if (startData.error) throw new Error(`Upload start failed: ${startData.error.message}`);

    const { upload_session_id, video_id, start_offset, end_offset } = startData;
    Logger.ok(`Session ID: ${upload_session_id}, Video ID: ${video_id}`);
    onProgress?.(0.05);

    // Phase 2: Transfer chunks
    let chunkStart = parseInt(start_offset, 10);
    let chunkEnd   = parseInt(end_offset,   10);
    let chunkNum   = 0;
    const totalSize = blob.size;

    while (chunkStart < totalSize) {
      const chunk = blob.slice(chunkStart, chunkEnd);
      Logger.info(`Uploading chunk ${++chunkNum}: bytes ${chunkStart}–${chunkEnd}`);

      const chunkForm = new FormData();
      chunkForm.append('upload_phase',      'transfer');
      chunkForm.append('upload_session_id', upload_session_id);
      chunkForm.append('start_offset',      chunkStart);
      chunkForm.append('video_file_chunk',  chunk, 'chunk.webm');
      chunkForm.append('access_token',      token);

      const chunkResp = await fetch(`${GRAPH_API}/${pageId}/videos`, {
        method: 'POST',
        body:   chunkForm,
      });
      const chunkData = await chunkResp.json();

      if (chunkData.error) throw new Error(`Chunk ${chunkNum} failed: ${chunkData.error.message}`);

      chunkStart = parseInt(chunkData.start_offset, 10);
      chunkEnd   = parseInt(chunkData.end_offset,   10);
      onProgress?.((chunkStart / totalSize) * 0.85 + 0.05);
    }

    Logger.ok(`All chunks uploaded`);

    // Phase 3: Finish
    Logger.info('Phase 3: Finalizing upload…');
    const endForm = new FormData();
    endForm.append('upload_phase',      'finish');
    endForm.append('upload_session_id', upload_session_id);
    endForm.append('title',             meta.title       || 'ViralCut AI Video');
    endForm.append('description',       meta.description || '');
    endForm.append('published',         'true');
    endForm.append('access_token',      token);

    const endResp = await fetch(`${GRAPH_API}/${pageId}/videos`, {
      method: 'POST',
      body:   endForm,
    });
    const endData = await endResp.json();

    if (endData.error) throw new Error(`Upload finish failed: ${endData.error.message}`);

    onProgress?.(1);
    Logger.ok(`Upload complete! Video ID: ${video_id}`);
    Logger.groupEnd();

    return {
      videoId:  video_id,
      shareUrl: `https://www.facebook.com/video/${video_id}`,
    };
  }

  /* ----------------------------------------
     PREPARE (validate + show UI, no upload yet)
  ---------------------------------------- */

  /**
   * Validate connection without uploading.
   * Used by "Prepare for Facebook" button.
   */
  async function prepare(token, pageId) {
    if (!token || !pageId) {
      throw new Error('Enter your Page ID and Access Token first');
    }

    // Simple client-side token format check
    if (token.length < 50) {
      throw new Error('Access token appears invalid. Page tokens are typically 100+ characters.');
    }

    try {
      const page = await validateToken(token, pageId);
      return page;
    } catch (err) {
      // Re-throw with user-friendly message
      if (err.message.includes('Invalid OAuth')) {
        throw new Error('Access token is expired or invalid. Generate a new Page Access Token in Meta Business Suite.');
      }
      throw err;
    }
  }

  /**
   * Get the recommended video specs for Facebook
   */
  function getVideoSpecs() {
    return {
      format:      'MP4 or WebM (H.264 + AAC preferred)',
      aspectRatio: '9:16 recommended for Reels',
      resolution:  '1080 × 1920 (1080p portrait)',
      maxFileSize: '4GB',
      maxDuration: '90 minutes',
      minDuration: '1 second',
      frameRate:   '30fps',
    };
  }

  return {
    validateToken,
    uploadVideo,
    prepare,
    getVideoSpecs,
  };
}());
