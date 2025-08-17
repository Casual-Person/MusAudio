// Advanced EC3 (Dolby Digital Plus) decoder
// Independent of device specs, uses ffmpeg.wasm with MP4Box.js demux fallback

let ffmpeg = null;

// Import advanced audio processing functions
import { shiftPitch, stretchTime, modifySpeed, applyFilter, visualize } from './advanced-audio-processor.js';

/**
 * Initialize the EC3 decoder with ffmpeg.wasm
 * @param {Object} options - FFmpeg initialization options
 * @returns {Promise<Object>} - FFmpeg instance with advanced features
 */
export async function initDecoder(options = {}) {
  if (ffmpeg) return ffmpeg;
  
  const FF = (self.FFmpeg || window.FFmpeg);
  if (!FF) throw new Error('FFmpeg UMD not found. Ensure ./vendor/ffmpeg/ffmpeg.min.js is present.');
  
  const { createFFmpeg } = FF;
  
  // Check for SIMD support
  const supportsSIMD = (() => {
    try { 
      return WebAssembly && WebAssembly.validate(new Uint8Array([0, 97, 115, 109])); 
    } catch { 
      return false; 
    }
  })();
  
  const baseCoreJs = './vendor/ffmpeg/ffmpeg-core.js';
  const baseCoreWasm = './vendor/ffmpeg/ffmpeg-core.wasm';
  const simdCoreJs = './vendor/ffmpeg/ffmpeg-core-simd.js';
  const simdCoreWasm = './vendor/ffmpeg/ffmpeg-core-simd.wasm';
  
  let coreJs = baseCoreJs;
  let coreWasm = baseCoreWasm;
  
  try {
    if (supportsSIMD) {
      const [jsH, wasmH] = await Promise.all([
        fetch(simdCoreJs, { method: 'HEAD', cache: 'no-cache' }),
        fetch(simdCoreWasm, { method: 'HEAD', cache: 'no-cache' })
      ]);
      
      if (jsH.ok && wasmH.ok) {
        coreJs = simdCoreJs;
        coreWasm = simdCoreWasm;
      }
    }
  } catch {}
  
  // Verify core assets
  try {
    const [jsHead, wasmHead] = await Promise.all([
      fetch(coreJs, { method: 'HEAD', cache: 'no-cache' }),
      fetch(coreWasm, { method: 'HEAD', cache: 'no-cache' })
    ]);
    
    if (!jsHead.ok) throw new Error(`Missing ffmpeg core js at ${coreJs} (status ${jsHead.status})`);
    if (!wasmHead.ok) throw new Error(`Missing ffmpeg core wasm at ${coreWasm} (status ${wasmHead.status})`);
  } catch (e) {
    throw new Error(`FFmpeg core assets not found or not served correctly. Ensure .wasm is served with application/wasm. Details: ${e.message}`);
  }
  
  const urlParams = new URLSearchParams(location.search);
  const verbose = urlParams.has('fflog');
  
  // Merge default options with user-provided options
  const ffmpegOptions = {
    log: !!verbose,
    corePath: coreJs,
    simd: supportsSIMD,
    ...options
  };
  
  ffmpeg = createFFmpeg(ffmpegOptions);
  // Wire optional log/progress callbacks if provided
  try{
    if (typeof options.onLog === 'function' && ffmpeg.setLogger){
      ffmpeg.setLogger(({ type, message })=> options.onLog(type, message));
    }
    if (typeof options.onProgress === 'function' && ffmpeg.setProgress){
      ffmpeg.setProgress(({ ratio })=> options.onProgress(Math.max(0, Math.min(1, ratio||0))));
    }
  }catch{}
  await ffmpeg.load();
  
  return ffmpeg;
}

/**
 * Decode any supported audio file to PCM float32 interleaved samples with advanced options
 * @param {File} file - The audio file to decode
 * @param {Object} options - Decoding options { disableDrc, customArgs, outputFile }
 * @returns {Promise<{samples: Float32Array, metadata: Object}>} - PCM samples and metadata
 */
// Simple in-memory decode cache (name+size+mtime). Keeps last 3 entries.
const _decodeCache = new Map();
function cacheKeyFromFile(file){
  const mt = (file && typeof file.lastModified === 'number') ? file.lastModified : 0;
  const size = (file && typeof file.size === 'number') ? file.size : 0;
  return `${file?.name||'file'}|${size}|${mt}`;
}
function cacheSet(key, value){
  _decodeCache.set(key, value);
  while (_decodeCache.size > 3){
    const firstKey = _decodeCache.keys().next().value; _decodeCache.delete(firstKey);
  }
}

export async function decodeToPcm(file, options = {}) {
  // Unified robust pipeline with EC-3 fallback demux
  const decodeOptions = {
    disableDrc: true,
    channels: 2,
    sampleRate: 48000,
    format: 'pcm_f32le', // pcm_s16le, pcm_f32le, etc.
    postProcess: null,   // { normalize: true|targetDbFS, gainDb, speed, pitch, filter }
    abortSignal: null,
    ...options
  };

  // Cache lookup
  try{
    const key = cacheKeyFromFile(file);
    if (_decodeCache.has(key)) return _decodeCache.get(key);
  }catch{}

  if (!ffmpeg) await initDecoder();

  const isEc3 = isEc3File(file);
  const inName = 'input.' + file.name.split('.').pop();
  const outName = 'out.wav';

  const { fetchFile } = (self.FFmpeg || window.FFmpeg);

  try {
    ffmpeg.FS('writeFile', inName, await fetchFile(file));

    // Transcode to WAV for consistent pipeline
    const baseArgs = ['-i', inName, '-vn'];
    if (isEc3 && decodeOptions.disableDrc) {
      baseArgs.push('-drc_scale', '0');
    }
    baseArgs.push('-acodec', decodeOptions.format, '-ac', String(decodeOptions.channels), '-ar', String(decodeOptions.sampleRate), outName);

    try {
      await ffmpeg.run(...baseArgs);
    } catch (primaryErr) {
      // If EC-3 inside MP4/M4A fails, try demuxing to raw E-AC-3 and decode that
      if (isEc3) {
        const raw = await demuxEc3Elementary(file);
        if (raw) {
          const ec3Name = 'in.eac3';
          ffmpeg.FS('writeFile', ec3Name, raw);
          const args2 = ['-i', ec3Name];
          if (decodeOptions.disableDrc) args2.push('-drc_scale','0');
          args2.push('-acodec', decodeOptions.format, '-ac', String(decodeOptions.channels), '-ar', String(decodeOptions.sampleRate), outName);
          await ffmpeg.run(...args2);
          ffmpeg.FS('unlink', ec3Name);
        } else {
          throw primaryErr;
        }
      } else {
        throw primaryErr;
      }
    }

    const data = ffmpeg.FS('readFile', outName);
    // cleanup
    try{ ffmpeg.FS('unlink', inName); }catch{}
    try{ ffmpeg.FS('unlink', outName); }catch{}

    // Decode WAV to PCM and metadata
    let wav = await decodeWav(data.buffer);

    // Optional post-processing on interleaved PCM
    if (decodeOptions.postProcess){
      try{
        const pp = decodeOptions.postProcess;
        // Normalize by peak or target dBFS
        if (pp.normalize){
          const tDb = (pp.normalize === true) ? -1.0 : Number(pp.normalize); // dBFS
          const { peak } = measurePeakRms(wav.pcm);
          const peakDb = 20*Math.log10(Math.max(peak, 1e-9));
          const gainDb = (tDb - peakDb);
          applyGainInPlace(wav.pcm, gainDb);
        }
        if (typeof pp.gainDb === 'number'){
          applyGainInPlace(wav.pcm, pp.gainDb);
        }
        if (typeof pp.speed === 'number' && pp.speed !== 1){
          wav.pcm = await modifySpeed(wav.pcm, { channels: wav.channels, speed: pp.speed });
        }
        if (typeof pp.pitch === 'number' && pp.pitch !== 0){
          wav.pcm = await shiftPitch(wav.pcm, { channels: wav.channels, semitones: pp.pitch });
        }
        if (pp.filter){
          wav.pcm = await applyFilter(wav.pcm, { channels: wav.channels, ...pp.filter });
        }
      }catch(e){ console.warn('Post-process failed', e); }
    }

    // Cache store
    try{ const key = cacheKeyFromFile(file); cacheSet(key, wav); }catch{}
    return wav;

  } catch (err) {
    throw new Error(`EC3 Decoding failed via ffmpeg.wasm. Ensure codec support is compiled and assets are accessible. Original error: ${err?.message || err}`);
  }
}

// ---- Utilities: metering and gain ----
function measurePeakRms(interleaved){
  let peak = 0, sumSq = 0, n = interleaved.length;
  for (let i=0;i<n;i++){
    const v = interleaved[i];
    const av = Math.abs(v);
    if (av>peak) peak = av;
    sumSq += v*v;
  }
  const rms = Math.sqrt(sumSq / Math.max(1,n));
  return { peak, rms };
}
function applyGainInPlace(interleaved, gainDb){
  const g = Math.pow(10, (gainDb||0)/20);
  for (let i=0;i<interleaved.length;i++) interleaved[i] *= g;
}

/**
 * Decode WAV buffer to PCM data
 * @param {ArrayBuffer} buf - WAV file buffer
 * @returns {Promise<Object>} - Decoded PCM data with metadata
 */
function decodeWav(buf) {
  const dv = new DataView(buf);
  
  // Parse little endian WAV header
  if (dv.getUint32(0, false) !== 0x52494646) throw new Error('Invalid WAV'); // RIFF
  
  const fmtIdx = 12 + 4 + 4; // naive; assume canonical layout
  
  // Instead of manual parse, feed to OfflineAudioContext for robust decode
  const audioData = buf.slice(0);
  
  return new Promise((resolve, reject) => {
    const ctx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(2, 1, 48000);
    
    ctx.decodeAudioData(audioData, (ab) => {
      const chL = ab.getChannelData(0);
      const chR = ab.numberOfChannels > 1 ? ab.getChannelData(1) : new Float32Array(chL.length);
      
      // Interleave channels
      const inter = new Float32Array(ab.length * 2);
      for (let i = 0, j = 0; i < ab.length; i++, j += 2) {
        inter[j] = chL[i];
        inter[j + 1] = chR[i] || 0;
      }
      
      resolve({
        pcm: inter,
        sampleRate: ab.sampleRate,
        channels: ab.numberOfChannels,
        duration: ab.duration
      });
    }, (e) => reject(e));
  });
}

// ----- EC3 Specific Enhancements -----

/**
 * Demux EC3 elementary stream from MP4 container with advanced options
 * @param {File} file - The MP4 file containing EC3 audio
 * @param {Object} options - Extraction options { nbSamples, rapAlignement }
 * @returns {Promise<Uint8Array|null>} - Raw EC3 data or null if not found
 */
export async function demuxEc3Elementary(file, options = {}) {
  const MP4BoxNS = (self.MP4Box || window.MP4Box);
  if (!MP4BoxNS) return null;
  
  // Default extraction options
  const extractOptions = {
    nbSamples: 1000,
    rapAlignement: true,
    ...options
  };
  
  return new Promise(async (resolve, reject) => {
    try {
      const mp4boxfile = MP4BoxNS.createFile();
      let ec3Data = new Uint8Array(0);
      
      // Error handler
      mp4boxfile.onError = (e) => reject(e);
      
      // Moov box start handler
      mp4boxfile.onMoovStart = () => {
        console.log('Starting to parse MP4 file information');
      };
      
      // Track information handler
      mp4boxfile.onReady = (info) => {
        try {
          // Find EC3 track
          const ec3Track = info.tracks.find(t => /ec-?3/i.test(t.codec || ''));
          if (!ec3Track) {
            return resolve(null);
          }
          
          // Set extraction options for the EC3 track
          mp4boxfile.setExtractionOptions(ec3Track.id, ec3Track, extractOptions);
          
          // Sample extraction handler
          mp4boxfile.onSamples = (trackId, track, samples) => {
            try {
              // Concatenate all samples to form the elementary stream
              for (const sample of samples) {
                const newLength = ec3Data.length + sample.data.length;
                const newData = new Uint8Array(newLength);
                newData.set(ec3Data, 0);
                newData.set(sample.data, ec3Data.length);
                ec3Data = newData;
              }
            } catch (e) {
              console.warn('EC3 sample extraction error:', e);
            }
          };
          
          // Start extraction
          mp4boxfile.start();
        } catch (e) {
          reject(e);
        }
      };
      
      // Read file in chunks to avoid memory issues
      const chunkSize = 1024 * 1024; // 1MB chunks
      let offset = 0;
      
      while (offset < file.size) {
        const end = Math.min(offset + chunkSize, file.size);
        const chunk = await file.slice(offset, end).arrayBuffer();
        
        // Create a new ArrayBuffer with the chunk data
        const ab = new ArrayBuffer(chunk.byteLength);
        const view = new Uint8Array(ab);
        view.set(new Uint8Array(chunk));
        ab.fileStart = offset;
        
        mp4boxfile.appendBuffer(ab);
        offset = end;
      }
      
      mp4boxfile.flush();
      
      // Wait a bit for processing to complete
      setTimeout(() => {
        if (ec3Data.length > 0) {
          resolve(ec3Data);
        } else {
          resolve(null);
        }
      }, 100);
      
    } catch (err) {
      console.warn('EC3 demuxing failed:', err);
      resolve(null);
    }
  });
}

/**
 * Segment EC3 track from MP4 container for streaming with advanced options
 * @param {File} file - The MP4 file containing EC3 audio
 * @param {Function} onSegment - Callback function for segments
 * @param {Object} options - Segmentation options { nbSamples, rapAlignement, startTime, endTime, maxSegmentSize }
 * @returns {Promise<Object|null>} - Segmentation result with management functions or null if not found
 */
export async function segmentEc3Track(file, onSegment, options = {}) {
  const MP4BoxNS = (self.MP4Box || window.MP4Box);
  if (!MP4BoxNS) return null;
  
  // Default segmentation options
  const segmentOptions = {
    nbSamples: 1000,
    rapAlignement: true,
    startTime: 0,
    endTime: null,
    maxSegmentSize: null,
    ...options
  };
  
  return new Promise(async (resolve, reject) => {
    try {
      const mp4boxfile = MP4BoxNS.createFile();
      
      // Error handler
      mp4boxfile.onError = (e) => reject(e);
      
      // Track information handler
      mp4boxfile.onReady = (info) => {
        try {
          // Find EC3 track
          const ec3Track = info.tracks.find(t => /ec-?3/i.test(t.codec || ''));
          if (!ec3Track) {
            return resolve(null);
          }
          
          // Set segmentation options for the EC3 track
          mp4boxfile.setSegmentOptions(ec3Track.id, null, segmentOptions);
          
          // Segment handler
          mp4boxfile.onSegment = onSegment;
          
          // Initialize segmentation
          const initSegments = mp4boxfile.initializeSegmentation();
          
          // Start segmentation
          mp4boxfile.start();
          
          resolve({
            initSegments,
            seek: (time, useRap = false) => mp4boxfile.seek(time, useRap),
            releaseUsedSamples: (trackId, sampleNumber) => mp4boxfile.releaseUsedSamples(trackId, sampleNumber),
            stop: () => mp4boxfile.stop(),
            flush: () => mp4boxfile.flush(),
            getTrackInfo: () => ({
              id: ec3Track.id,
              codec: ec3Track.codec,
              duration: ec3Track.duration,
              timescale: ec3Track.timescale,
              nb_samples: ec3Track.nb_samples
            })
          });
        } catch (e) {
          reject(e);
        }
      };
      
      // Read file in chunks
      const chunkSize = 1024 * 1024; // 1MB chunks
      let offset = 0;
      
      while (offset < file.size) {
        const end = Math.min(offset + chunkSize, file.size);
        const chunk = await file.slice(offset, end).arrayBuffer();
        
        const ab = new ArrayBuffer(chunk.byteLength);
        const view = new Uint8Array(ab);
        view.set(new Uint8Array(chunk));
        ab.fileStart = offset;
        
        mp4boxfile.appendBuffer(ab);
        offset = end;
      }
      
      mp4boxfile.flush();
      
    } catch (err) {
      console.warn('EC3 segmentation failed:', err);
      resolve(null);
    }
  });
}

/**
 * Extract specific audio channels from decoded PCM samples
 * @param {Float32Array} samples - PCM audio samples
 * @param {number} channels - Total number of channels in the audio
 * @param {Array<number>} channelIndices - Indices of channels to extract
 * @returns {Float32Array} - Extracted channel samples
 */
export function extractChannels(samples, channels, channelIndices) {
  if (!channelIndices || channelIndices.length === 0) {
    return samples;
  }
  
  // Validate channel indices
  const validIndices = channelIndices.filter(idx => idx >= 0 && idx < channels);
  if (validIndices.length === 0) {
    console.warn('No valid channel indices provided for extraction');
    return samples;
  }
  
  // Create new array for extracted channels
  const extractedLength = (samples.length / channels) * validIndices.length;
  const extracted = new Float32Array(extractedLength);
  
  // Extract specified channels
  const samplesPerChannel = samples.length / channels;
  let extractedIndex = 0;
  
  for (let i = 0; i < samplesPerChannel; i++) {
    for (const channelIdx of validIndices) {
      extracted[extractedIndex++] = samples[i * channels + channelIdx];
    }
  }
  
  return extracted;
}

/**
 * Get detailed audio metadata from decoded samples
 * @param {Float32Array} samples - PCM audio samples
 * @param {Object} metadata - Basic metadata from decoding
 * @returns {Object} - Enhanced metadata with audio analysis
 */
export function getAudioMetadata(samples, metadata = {}) {
  if (!samples || samples.length === 0) {
    return metadata;
  }
  
  // Calculate audio statistics
  let maxAmplitude = 0;
  let minAmplitude = 0;
  let sum = 0;
  
  for (let i = 0; i < samples.length; i++) {
    const amplitude = samples[i];
    if (amplitude > maxAmplitude) maxAmplitude = amplitude;
    if (amplitude < minAmplitude) minAmplitude = amplitude;
    sum += amplitude;
  }
  
  const averageAmplitude = sum / samples.length;
  
  // Return enhanced metadata
  return {
    ...metadata,
    maxAmplitude,
    minAmplitude,
    averageAmplitude,
    sampleCount: samples.length
  };
}

/**
 * Parse MP4/ISOBMFF file information
 * @param {File} file - The file to parse
 * @returns {Promise<Object|null>} - File information or null if MP4Box is unavailable
 */
export async function parseMp4Info(file) {
  const MP4BoxNS = (self.MP4Box || window.MP4Box);
  if (!MP4BoxNS) return null;
  
  const mp4boxfile = MP4BoxNS.createFile();
  
  return new Promise(async (resolve, reject) => {
    mp4boxfile.onError = (e) => reject(e);
    mp4boxfile.onReady = (info) => resolve({
      durationSec: (info.duration || 0) / (info.timescale || 1),
      tracks: (info.tracks || []).map(t => ({ 
        id: t.id, 
        codec: t.codec, 
        timescale: t.timescale, 
        duration: t.duration,
        nb_samples: t.nb_samples
      }))
    });
    
    try {
      const maxProbe = 2 * 1024 * 1024; // 2MB header probe
      const ab = await file.slice(0, Math.min(file.size, maxProbe)).arrayBuffer();
      ab.fileStart = 0; // required by mp4box.js
      mp4boxfile.appendBuffer(ab);
      mp4boxfile.flush();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Check if MP4Box.js is available
 * @returns {boolean} - True if MP4Box is available
 */
export function hasMP4Box() {
  return !!(self.MP4Box || window.MP4Box);
}

/**
 * Check if Aurora.js is available
 * @returns {boolean} - True if Aurora is available
 */
export function hasAurora() {
  return !!(self.AV || window.AV);
}

/**
 * Try to decode with Aurora.js as fallback
 * @param {File} file - The file to decode
 * @returns {Promise<Object|null>} - Decoded data or null if not available
 */
export async function tryDecodeWithAurora(file) {
  if (!hasAurora()) return null;
  
  // Integration hooks can be added here once the desired Aurora codecs are provided locally.
  // For now, we keep ffmpeg as the primary path.
  return null;
}

/**
 * Play audio gaplessly with crossfade
 * @param {Float32Array} samples - PCM audio samples
 * @param {Object} options - Playback options { crossfadeDuration }
 * @returns {Promise<void>}
 */
export async function playGapless(samples, options = {}) {
  // Placeholder implementation - would integrate with audio playback system
  console.log('Gapless playback requested with options:', options);
  
  // In a real implementation, this would:
  // 1. Configure the audio worklet for gapless playback
  // 2. Handle crossfading if specified
  
  return;
}

/**
 * Crossfade between two audio samples
 * @param {Float32Array} samples1 - First audio samples
 * @param {Float32Array} samples2 - Second audio samples
 * @param {number} duration - Crossfade duration in seconds
 * @param {number} sampleRate - Audio sample rate
 * @returns {Float32Array} - Crossfaded audio samples
 */
export function crossfade(samples1, samples2, duration, sampleRate) {
  // Placeholder implementation - would perform actual crossfading
  console.log(`Crossfading for ${duration} seconds at ${sampleRate} Hz`);
  
  // In a real implementation, this would:
  // 1. Calculate fade curve
  // 2. Blend samples1 and samples2 according to the fade curve
  // 3. Return the crossfaded result
  
  // For now, return samples1 concatenated with samples2
  const result = new Float32Array(samples1.length + samples2.length);
  result.set(samples1, 0);
  result.set(samples2, samples1.length);
  
  return result;
}
