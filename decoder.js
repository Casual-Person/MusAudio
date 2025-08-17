// Modular decoder router to PCM Float32 frames
// Native: WebAudio for MP3, AAC/M4A, WAV, AIFF, OGG (Vorbis/Opus where supported)
// EC-3 (E-AC-3):
//   - Safari: route to native HTMLMediaElement (we do NOT decode to PCM)
//   - Other browsers: ffmpeg.wasm fallback to decode EC-3/AC-3 -> 48k stereo Float32 PCM

import { parseEc3Info } from './ec3-parser.js';

let router = null;
let ffmpegInst = null; // singleton ffmpeg.wasm instance
let ffmpegLoading = null; // in-flight loader promise

export async function initDecoder(){
  if (router) return;
  router = createRouter([
    NativeAudioAdapter(),
    FfmpegEc3Adapter(), // enable EC-3/AC-3 decoding via WASM on non-Safari
    FfmpegMp4Adapter()  // fallback for M4A/AAC (e.g., ALAC in MP4) when WebAudio fails
  ]);
}
// end initDecoder

// Small helpers
const isSafari = ()=>{
  try{
    const ua = navigator.userAgent || '';
    return /Safari\//.test(ua) && !/Chrome\//.test(ua) && !/Chromium\//.test(ua);
  }catch{ return false; }
};

function extOf(name){
  const n = (name||'').toLowerCase();
  const i = n.lastIndexOf('.');
  return i>=0? n.slice(i+1): '';
}

function guessMime(file){
  if (file && file.type) return file.type;
  const ext = extOf(file?.name||'');
  switch(ext){
    case 'mp3': return 'audio/mpeg';
    case 'm4a': return 'audio/mp4';
    case 'aac': return 'audio/aac';
    case 'wav': return 'audio/wav';
    case 'aif':
    case 'aiff': return 'audio/aiff';
    case 'ogg': return 'audio/ogg';
    case 'opus': return 'audio/ogg; codecs="opus"';
    case 'oga': return 'audio/ogg; codecs="vorbis"';
    case 'flac': return 'audio/flac';
    case 'ec3':
    case 'ac3': return 'audio/ec-3';
    default: return 'application/octet-stream';
  }
}

function canPlayByMediaElement(mime){
  try{
    const a = document.createElement('audio');
    return !!a.canPlayType && a.canPlayType(mime) !== '';
  }catch{ return false; }
}

function createRouter(adapters){
  return {
    adapters,
    async decode(file, opts={}){
      const extHint = (opts.extHint||'').toLowerCase();
      let ext = extHint || extOf(file?.name||'');
      let mime = guessMime(file);
      if ((!mime || mime==='application/octet-stream') && ext){
        mime = guessMime({ name: 'f.'+ext, type:'' });
      }
      const baseCtx = { file, mime, ext };
      for (const ad of adapters){
        try{
          if (await ad.canDecode(baseCtx)){
            return await ad.decode(baseCtx);
          }
        }catch(e){ console.warn('[decoder]', ad.name||'adapter', e); }
      }
      throw new Error('Unsupported codec or container.');
    }
  };
}

function NativeAudioAdapter(){
  return {
    name: 'native-webaudio',
    async canDecode({ mime, ext }){
      // EC-3: we do not decode to PCM. Safari supports native playback only.
      if (ext==='ec3' || ext==='ac3') return false;
      // Optimistic: let decodeAudioData try; it often supports more than canPlayType reports.
      return true;
    },
    async decode({ file }){
      const arrayBuffer = await file.arrayBuffer();
      // Decode via OfflineAudioContext for broader availability without user gesture
      const tmp = new (window.OfflineAudioContext||window.webkitOfflineAudioContext)(1, 1, 48000);
      const audioBuffer = await new Promise((resolve, reject)=>{
        try{
          tmp.decodeAudioData(arrayBuffer.slice(0), resolve, reject);
        }catch(e){ reject(e); }
      });
      // Resample/mixdown to 48k stereo
      const targetRate = 48000; const targetCh = 2;
      if (audioBuffer.sampleRate !== targetRate || audioBuffer.numberOfChannels !== targetCh){
        const length = Math.ceil(audioBuffer.duration * targetRate);
        const ctx = new (window.OfflineAudioContext||window.webkitOfflineAudioContext)(targetCh, length, targetRate);
        const src = ctx.createBufferSource(); src.buffer = audioBuffer; src.connect(ctx.destination); src.start(0);
        const rendered = await ctx.startRendering();
        const inter = interleave(rendered);
        return { pcm: inter, sampleRate: targetRate, channels: targetCh, duration: rendered.duration };
      }else{
        const inter = interleave(audioBuffer);
        return { pcm: inter, sampleRate: audioBuffer.sampleRate, channels: audioBuffer.numberOfChannels, duration: audioBuffer.duration };
      }
    }
  };
}

function interleave(ab){
  const chs = Math.max(1, ab.numberOfChannels);
  const L = ab.getChannelData(0);
  const R = chs>1? ab.getChannelData(1): new Float32Array(L.length);
  const out = new Float32Array(ab.length*2);
  for (let i=0,j=0;i<ab.length;i++,j+=2){ out[j]=L[i]; out[j+1]=R[i]||0; }
  return out;
}

// --- ffmpeg.wasm loader and EC-3 adapter ---
async function ensureFfmpeg(){
  if (ffmpegInst) return ffmpegInst;
  if (ffmpegLoading) return ffmpegLoading;
  ffmpegLoading = (async()=>{
    await loadFfmpegScript();
    const FFmpegCtor = (window.FFmpegWASM && window.FFmpegWASM.FFmpeg)
      || (window.FFmpeg && window.FFmpeg.FFmpeg)
      || null;
    if (!FFmpegCtor) throw new Error('FFmpeg library not found (ffmpeg.min.js)');
    const ff = new FFmpegCtor();
    const coreURL = new URL('./vendor/ffmpeg/ffmpeg-core.js', import.meta.url).href;
    const wasmURL = new URL('./vendor/ffmpeg/ffmpeg-core.wasm', import.meta.url).href;
    const workerURL = new URL('./vendor/ffmpeg/814.ffmpeg.js', import.meta.url).href;
    await ff.load({ coreURL, wasmURL, workerURL });
    ffmpegInst = ff; return ff;
  })();
  return ffmpegLoading;
}

function loadFfmpegScript(){
  return new Promise((resolve, reject)=>{
    try{
      if (window.FFmpegWASM || (window.FFmpeg && window.FFmpeg.FFmpeg)) { resolve(); return; }
      const s = document.createElement('script');
      s.src = new URL('./vendor/ffmpeg/ffmpeg.min.js', import.meta.url).href;
      s.async = true;
      s.onload = ()=> resolve();
      s.onerror = ()=> reject(new Error('Failed to load ffmpeg.min.js'));
      document.head.appendChild(s);
    }catch(e){ reject(e); }
  });
}

function FfmpegEc3Adapter(){
  return {
    name: 'ffmpeg-ec3',
    async canDecode({ ext }){
      if (ext==='ec3' || ext==='ac3') return !isSafari();
      return false;
    },
    async decode({ file, ext }){
      const ff = await ensureFfmpeg();
      const inName = 'in.' + (ext||'ec3');
      const outName = 'out.f32';
      const buf = new Uint8Array(await file.arrayBuffer());
      // Parse EC-3 header for metadata (channels, samplerate, etc.)
      let ec3Info = null; let sourceChannels = 2;
      try{
        const info = parseEc3Info(buf);
        if (info && info.ok){ ec3Info = info; sourceChannels = info.channels||2; }
      }catch{}
      await ff.writeFile(inName, buf);
      try{
        // Preserve original channel count; standardize to 48kHz float32 interleaved
        await ff.exec(['-hide_banner','-loglevel','error','-i', inName, '-ar','48000','-f','f32le', outName]);
        const out = await ff.readFile(outName); // Uint8Array
        const pcm = new Float32Array(out.buffer, out.byteOffset, Math.floor(out.byteLength/4));
        const sampleRate = 48000; const channels = Math.max(1, sourceChannels||2);
        const duration = pcm.length / (sampleRate * channels);
        return { pcm, sampleRate, channels, duration, sourceChannels: channels, ec3Info };
      } finally {
        try{ await ff.deleteFile(inName); }catch{}
        try{ await ff.deleteFile(outName); }catch{}
      }
    }
  };
}

function FfmpegMp4Adapter(){
  return {
    name: 'ffmpeg-mp4',
    async canDecode({ ext }){
      // Allow fallback for common MP4/AAC extensions if native decode fails
      return ext==='m4a' || ext==='aac' || ext==='m4b' || ext==='mp4';
    },
    async decode({ file, ext }){
      const ff = await ensureFfmpeg();
      const inName = 'in.' + (ext||'m4a');
      const outName = 'out.f32';
      const buf = new Uint8Array(await file.arrayBuffer());
      await ff.writeFile(inName, buf);
      try{
        await ff.exec(['-hide_banner','-loglevel','error','-i', inName, '-ac','2','-ar','48000','-f','f32le', outName]);
        const out = await ff.readFile(outName);
        const pcm = new Float32Array(out.buffer, out.byteOffset, Math.floor(out.byteLength/4));
        const sampleRate = 48000; const channels = 2;
        const duration = pcm.length / (sampleRate * channels);
        return { pcm, sampleRate, channels, duration };
      } finally {
        try{ await ff.deleteFile(inName); }catch{}
        try{ await ff.deleteFile(outName); }catch{}
      }
    }
  };
}

export async function decodeToPcm(file, extHint){
  if (!router) await initDecoder();
  const n = (file?.name||'').toLowerCase();
  const ext = (extHint||extOf(n));
  if ((ext==='ec3' || ext==='ac3') && isSafari()){
    // Safari should use native playback for EC-3/AC-3
    throw new Error('EC-3 detected. On Safari, use native playback (HTMLMediaElement). PCM decoding in-browser is not provided.');
  }
  return router.decode(file, { extHint: ext });
}

// WAV-specific path removed; decoding is handled via WebAudio decodeAudioData above
function decodeWav(){ throw new Error('decodeWav is deprecated'); }

// (Removed) FFmpeg/MP4Box/Aurora paths to simplify dependencies

// --- Diagnostics helpers ---
export async function ffmpegVersion(){ return ''; }

export async function listFfmpegDecoders(){ return ''; }

export async function hasEac3Decoder(){ return isSafari(); }
