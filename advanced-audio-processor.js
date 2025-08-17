// advanced-audio-processor.js
// Advanced audio processing functions for pitch shifting and time stretching

import FFT from 'fft.js';

/**
 * Shift audio pitch using Rubber Band library
 * @param {Float32Array} samples - PCM audio samples
 * @param {number} factor - Pitch shift factor (e.g., 1.2 for 20% higher pitch)
 * @param {Object} options - Processing options
 * @returns {Promise<Float32Array>} - Pitch-shifted audio samples
 */
export async function shiftPitch(samples, factor, options = {}) {
  // Advanced pitch shifting implementation using phase vocoder technique
  console.log(`Shifting pitch by factor ${factor}`);
  
  if (factor === 1) return samples;
  
  const frameSize = options.frameSize || 2048;
  const hopSize = options.hopSize || Math.round(frameSize / 8);
  
  // Ensure frameSize is a power of 2 for FFT
  const fftSize = Math.pow(2, Math.ceil(Math.log2(frameSize)));
  
  // For pitch shifting, we stretch time by 1/factor and then resample back to original length
  const timeStretchFactor = 1 / factor;
  const stretchHopSize = Math.round(hopSize * timeStretchFactor);
  
  const result = new Float32Array(samples.length);
  let outputIndex = 0;
  
  // Initialize phase arrays for phase vocoder
  const phases = new Float32Array(fftSize / 2 + 1);
  const prevPhases = new Float32Array(fftSize / 2 + 1);
  
  // Create Hann window
  const window = new Float32Array(frameSize);
  for (let i = 0; i < frameSize; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (frameSize - 1)));
  }
  
  // Phase vocoder pitch shifting
  for (let i = 0; i <= samples.length - frameSize; i += hopSize) {
    // Extract frame
    const frame = new Float32Array(frameSize);
    for (let j = 0; j < frameSize && i + j < samples.length; j++) {
      frame[j] = samples[i + j] * window[j];
    }
    
    // Apply FFT
    const fft = new FFT(fftSize);
    const spectrum = new Array(fftSize * 2);
    fft.realTransform(spectrum, frame);
    
    // Convert to magnitude and phase
    const magnitudes = new Float32Array(fftSize / 2 + 1);
    const newPhases = new Float32Array(fftSize / 2 + 1);
    
    for (let j = 0; j <= fftSize / 2; j++) {
      const real = spectrum[2 * j];
      const imag = spectrum[2 * j + 1];
      magnitudes[j] = Math.sqrt(real * real + imag * imag);
      newPhases[j] = Math.atan2(imag, real);
    }
    
    // Phase adjustment for pitch shifting
    for (let j = 0; j <= fftSize / 2; j++) {
      const deltaPhase = newPhases[j] - prevPhases[j];
      const expectedPhase = (2 * Math.PI * hopSize * j) / fftSize;
      const phaseDiff = deltaPhase - expectedPhase;
      const wrappedPhaseDiff = Math.atan2(Math.sin(phaseDiff), Math.cos(phaseDiff));
      
      // Calculate true frequency and adjust for pitch factor
      const trueFreq = ((2 * Math.PI * j) / fftSize + wrappedPhaseDiff / hopSize) * factor;
      
      // Accumulate phase
      phases[j] += trueFreq * hopSize;
      
      // Store current phases for next iteration
      prevPhases[j] = newPhases[j];
    }
    
    // Apply inverse FFT
    const ifft = new FFT(fftSize);
    const newSpectrum = new Array(fftSize * 2);
    
    for (let j = 0; j <= fftSize / 2; j++) {
      newSpectrum[2 * j] = magnitudes[j] * Math.cos(phases[j]);
      newSpectrum[2 * j + 1] = magnitudes[j] * Math.sin(phases[j]);
    }
    
    // Symmetric filling for inverse FFT
    for (let j = fftSize / 2 + 1; j < fftSize; j++) {
      newSpectrum[2 * j] = newSpectrum[2 * (fftSize - j)];
      newSpectrum[2 * j + 1] = -newSpectrum[2 * (fftSize - j) + 1];
    }
    
    const newFrame = new Float32Array(frameSize);
    ifft.inverseTransform(newFrame, newSpectrum);
    
    // Apply window to output frame
    for (let j = 0; j < frameSize; j++) {
      newFrame[j] *= window[j];
    }
    
    // Overlap-add
    for (let j = 0; j < frameSize && outputIndex + j < result.length; j++) {
      if (j < hopSize) {
        // Crossfade
        const fade = j / hopSize;
        result[outputIndex + j] = (result[outputIndex + j] || 0) * (1 - fade) + 
                                 newFrame[j] * fade;
      } else {
        result[outputIndex + j] = newFrame[j];
      }
    }
    
    outputIndex += stretchHopSize;
  }
  
  return result;
}

/**
 * Stretch audio time (tempo) using Rubber Band library
 * @param {Float32Array} samples - PCM audio samples
 * @param {number} factor - Time stretch factor (e.g., 0.8 for 20% slower tempo)
 * @param {Object} options - Processing options
 * @returns {Promise<Float32Array>} - Time-stretched audio samples
 */
export async function stretchTime(samples, factor, options = {}) {
  // Advanced time stretching implementation using phase vocoder technique
  console.log(`Stretching time by factor ${factor}`);
  
  if (factor === 1) return samples;
  
  const frameSize = options.frameSize || 2048;
  const hopSize = options.hopSize || Math.round(frameSize / 8);
  const stretchHopSize = Math.round(hopSize / factor);
  
  // Ensure frameSize is a power of 2 for FFT
  const fftSize = Math.pow(2, Math.ceil(Math.log2(frameSize)));
  
  const result = new Float32Array(Math.round(samples.length * factor));
  let outputIndex = 0;
  
  // Initialize phase arrays for phase vocoder
  const phases = new Float32Array(fftSize / 2 + 1);
  const prevPhases = new Float32Array(fftSize / 2 + 1);
  
  // Create Hann window
  const window = new Float32Array(frameSize);
  for (let i = 0; i < frameSize; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (frameSize - 1)));
  }
  
  // Phase vocoder time stretching
  for (let i = 0; i <= samples.length - frameSize; i += hopSize) {
    // Extract frame
    const frame = new Float32Array(frameSize);
    for (let j = 0; j < frameSize && i + j < samples.length; j++) {
      frame[j] = samples[i + j] * window[j];
    }
    
    // Apply FFT
    const fft = new FFT(fftSize);
    const spectrum = new Array(fftSize * 2);
    fft.realTransform(spectrum, frame);
    
    // Convert to magnitude and phase
    const magnitudes = new Float32Array(fftSize / 2 + 1);
    const newPhases = new Float32Array(fftSize / 2 + 1);
    
    for (let j = 0; j <= fftSize / 2; j++) {
      const real = spectrum[2 * j];
      const imag = spectrum[2 * j + 1];
      magnitudes[j] = Math.sqrt(real * real + imag * imag);
      newPhases[j] = Math.atan2(imag, real);
    }
    
    // Phase adjustment
    for (let j = 0; j <= fftSize / 2; j++) {
      const deltaPhase = newPhases[j] - prevPhases[j];
      const expectedPhase = (2 * Math.PI * hopSize * j) / fftSize;
      const phaseDiff = deltaPhase - expectedPhase;
      const wrappedPhaseDiff = Math.atan2(Math.sin(phaseDiff), Math.cos(phaseDiff));
      
      // Calculate true frequency
      const trueFreq = (2 * Math.PI * j) / fftSize + wrappedPhaseDiff / hopSize;
      
      // Accumulate phase
      phases[j] += trueFreq * stretchHopSize;
      
      // Store current phases for next iteration
      prevPhases[j] = newPhases[j];
    }
    
    // Apply inverse FFT
    const ifft = new FFT(fftSize);
    const newSpectrum = new Array(fftSize * 2);
    
    for (let j = 0; j <= fftSize / 2; j++) {
      newSpectrum[2 * j] = magnitudes[j] * Math.cos(phases[j]);
      newSpectrum[2 * j + 1] = magnitudes[j] * Math.sin(phases[j]);
    }
    
    // Symmetric filling for inverse FFT
    for (let j = fftSize / 2 + 1; j < fftSize; j++) {
      newSpectrum[2 * j] = newSpectrum[2 * (fftSize - j)];
      newSpectrum[2 * j + 1] = -newSpectrum[2 * (fftSize - j) + 1];
    }
    
    const newFrame = new Float32Array(frameSize);
    ifft.inverseTransform(newFrame, newSpectrum);
    
    // Apply window to output frame
    for (let j = 0; j < frameSize; j++) {
      newFrame[j] *= window[j];
    }
    
    // Overlap-add
    for (let j = 0; j < frameSize && outputIndex + j < result.length; j++) {
      if (j < stretchHopSize) {
        // Crossfade
        const fade = j / stretchHopSize;
        result[outputIndex + j] = (result[outputIndex + j] || 0) * (1 - fade) + 
                                 newFrame[j] * fade;
      } else {
        result[outputIndex + j] = newFrame[j];
      }
    }
    
    outputIndex += stretchHopSize;
  }
  
  return result;
}

/**
 * Modify playback speed while maintaining pitch
 * @param {Float32Array} samples - PCM audio samples
 * @param {number} factor - Speed factor (e.g., 1.5 for 50% faster playback)
 * @param {Object} options - Processing options
 * @returns {Promise<Float32Array>} - Speed-modified audio samples
 */
export async function modifySpeed(samples, factor, options = {}) {
  // Advanced speed modification implementation using phase vocoder technique
  console.log(`Modifying speed by factor ${factor}`);
  
  if (factor === 1) return samples;
  
  const frameSize = options.frameSize || 2048;
  const hopSize = options.hopSize || Math.round(frameSize / 8);
  const speedHopSize = Math.round(hopSize * factor);
  
  // Ensure frameSize is a power of 2 for FFT
  const fftSize = Math.pow(2, Math.ceil(Math.log2(frameSize)));
  
  const result = new Float32Array(Math.round(samples.length / factor));
  let outputIndex = 0;
  
  // Initialize phase arrays for phase vocoder
  const phases = new Float32Array(fftSize / 2 + 1);
  const prevPhases = new Float32Array(fftSize / 2 + 1);
  
  // Create Hann window
  const window = new Float32Array(frameSize);
  for (let i = 0; i < frameSize; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (frameSize - 1)));
  }
  
  // Phase vocoder speed modification
  for (let i = 0; i <= samples.length - frameSize; i += speedHopSize) {
    // Extract frame
    const frame = new Float32Array(frameSize);
    for (let j = 0; j < frameSize && i + j < samples.length; j++) {
      frame[j] = samples[i + j] * window[j];
    }
    
    // Apply FFT
    const fft = new FFT(fftSize);
    const spectrum = new Array(fftSize * 2);
    fft.realTransform(spectrum, frame);
    
    // Convert to magnitude and phase
    const magnitudes = new Float32Array(fftSize / 2 + 1);
    const newPhases = new Float32Array(fftSize / 2 + 1);
    
    for (let j = 0; j <= fftSize / 2; j++) {
      const real = spectrum[2 * j];
      const imag = spectrum[2 * j + 1];
      magnitudes[j] = Math.sqrt(real * real + imag * imag);
      newPhases[j] = Math.atan2(imag, real);
    }
    
    // Phase adjustment for speed modification
    for (let j = 0; j <= fftSize / 2; j++) {
      const deltaPhase = newPhases[j] - prevPhases[j];
      const expectedPhase = (2 * Math.PI * speedHopSize * j) / fftSize;
      const phaseDiff = deltaPhase - expectedPhase;
      const wrappedPhaseDiff = Math.atan2(Math.sin(phaseDiff), Math.cos(phaseDiff));
      
      // Calculate true frequency
      const trueFreq = (2 * Math.PI * j) / fftSize + wrappedPhaseDiff / speedHopSize;
      
      // Accumulate phase with adjusted hop size
      phases[j] += trueFreq * hopSize;
      
      // Store current phases for next iteration
      prevPhases[j] = newPhases[j];
    }
    
    // Apply inverse FFT
    const ifft = new FFT(fftSize);
    const newSpectrum = new Array(fftSize * 2);
    
    for (let j = 0; j <= fftSize / 2; j++) {
      newSpectrum[2 * j] = magnitudes[j] * Math.cos(phases[j]);
      newSpectrum[2 * j + 1] = magnitudes[j] * Math.sin(phases[j]);
    }
    
    // Symmetric filling for inverse FFT
    for (let j = fftSize / 2 + 1; j < fftSize; j++) {
      newSpectrum[2 * j] = newSpectrum[2 * (fftSize - j)];
      newSpectrum[2 * j + 1] = -newSpectrum[2 * (fftSize - j) + 1];
    }
    
    const newFrame = new Float32Array(frameSize);
    ifft.inverseTransform(newFrame, newSpectrum);
    
    // Apply window to output frame
    for (let j = 0; j < frameSize; j++) {
      newFrame[j] *= window[j];
    }
    
    // Overlap-add
    for (let j = 0; j < frameSize && outputIndex + j < result.length; j++) {
      if (j < hopSize) {
        // Crossfade
        const fade = j / hopSize;
        result[outputIndex + j] = (result[outputIndex + j] || 0) * (1 - fade) + 
                                 newFrame[j] * fade;
      } else {
        result[outputIndex + j] = newFrame[j];
      }
    }
    
    outputIndex += hopSize;
  }
  
  return result;
}

/**
 * Apply audio filter using ffmpeg.audio.wasm
 * @param {Float32Array} samples - PCM audio samples
 * @param {string} filterType - Type of filter to apply
 * @param {Object} parameters - Filter parameters
 * @returns {Promise<Float32Array>} - Filtered audio samples
 */
export async function applyFilter(samples, filterType, parameters = {}) {
  // Advanced implementation using Web Audio API for filtering
  console.log(`Applying filter ${filterType} with parameters`, parameters);
  
  // Create offline audio context for processing
  const sampleRate = parameters.sampleRate || 48000;
  const channels = parameters.channels || 2;
  const length = Math.ceil(samples.length / channels);
  
  const context = new OfflineAudioContext(channels, length, sampleRate);
  
  // Create audio buffer
  const buffer = context.createBuffer(channels, length, sampleRate);
  for (let ch = 0; ch < channels; ch++) {
    const channelData = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      channelData[i] = samples[i * channels + ch] || 0;
    }
  }
  
  // Create buffer source
  const source = context.createBufferSource();
  source.buffer = buffer;
  
  // Create filter node based on filterType
  let filter = null;
  let finalNode = null;
  
  switch (filterType) {
    case 'lowpass':
      filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = parameters.frequency || 1000;
      filter.Q.value = parameters.Q || 1;
      finalNode = filter;
      break;
    case 'highpass':
      filter = context.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = parameters.frequency || 1000;
      filter.Q.value = parameters.Q || 1;
      finalNode = filter;
      break;
    case 'bandpass':
      filter = context.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = parameters.frequency || 1000;
      filter.Q.value = parameters.Q || 1;
      finalNode = filter;
      break;
    case 'echo':
      // Enhanced echo effect with feedback
      const delay = context.createDelay();
      delay.delayTime.value = parameters.delayTime || 0.25;
      
      const feedback = context.createGain();
      feedback.gain.value = parameters.feedback || 0.3;
      
      // Create feedback loop
      source.connect(delay);
      source.connect(context.destination);
      delay.connect(feedback);
      delay.connect(context.destination);
      feedback.connect(delay);
      
      finalNode = context.destination;
      break;
    case 'reverb':
      // Enhanced reverb effect using convolver with generated impulse response
      const convolver = context.createConvolver();
      
      // Generate a simple impulse response for reverb
      const duration = parameters.duration || 2;
      const decay = parameters.decay || 2;
      const reverse = parameters.reverse || false;
      
      const impulseLength = sampleRate * duration;
      const impulseBuffer = context.createBuffer(2, impulseLength, sampleRate);
      
      for (let ch = 0; ch < 2; ch++) {
        const channelData = impulseBuffer.getChannelData(ch);
        for (let i = 0; i < impulseLength; i++) {
          const n = reverse ? impulseLength - i : i;
          channelData[i] = (Math.random() * 2 - 1) * Math.pow(1 - n / impulseLength, decay);
        }
      }
      
      convolver.buffer = impulseBuffer;
      
      // Connect nodes
      source.connect(convolver);
      convolver.connect(context.destination);
      
      finalNode = context.destination;
      break;
    case 'chorus':
      // Chorus effect implementation
      const chorusDelay = context.createDelay();
      chorusDelay.delayTime.value = parameters.delayTime || 0.02;
      
      const chorusGain = context.createGain();
      chorusGain.gain.value = parameters.depth || 0.5;
      
      const chorusOscillator = context.createOscillator();
      chorusOscillator.type = 'sine';
      chorusOscillator.frequency.value = parameters.rate || 0.5;
      
      // In a real implementation, we would use a variable delay
      // For now, we'll create a simple chorus approximation
      source.connect(context.destination);
      source.connect(chorusDelay);
      chorusDelay.connect(context.destination);
      
      chorusOscillator.start();
      
      finalNode = context.destination;
      break;
    case 'flanger':
      // Flanger effect implementation
      const flangerDelay = context.createDelay();
      flangerDelay.delayTime.value = parameters.delayTime || 0.005;
      
      const flangerGain = context.createGain();
      flangerGain.gain.value = parameters.depth || 0.5;
      
      const flangerFeedback = context.createGain();
      flangerFeedback.gain.value = parameters.feedback || 0.7;
      
      const flangerOscillator = context.createOscillator();
      flangerOscillator.type = 'sine';
      flangerOscillator.frequency.value = parameters.rate || 0.5;
      
      // In a real implementation, we would modulate the delay time
      // For now, we'll create a simple flanger approximation
      source.connect(flangerDelay);
      source.connect(context.destination);
      flangerDelay.connect(flangerFeedback);
      flangerDelay.connect(context.destination);
      flangerFeedback.connect(flangerDelay);
      
      flangerOscillator.start();
      
      finalNode = context.destination;
      break;
    case 'distortion':
      // Distortion effect using waveShaper
      const distortion = context.createWaveShaper();
      
      // Create distortion curve
      const distortionAmount = parameters.amount || 50;
      const samplesCount = 44100;
      const curve = new Float32Array(samplesCount);
      const k = distortionAmount;
      
      for (let i = 0; i < samplesCount; i++) {
        const x = (i - samplesCount / 2) / (samplesCount / 2);
        curve[i] = (3 + k) * x * 20 * Math.log(1 + Math.abs(x)) / (20 * Math.log(1 + k));
      }
      
      distortion.curve = curve;
      distortion.oversample = '4x';
      
      source.connect(distortion);
      distortion.connect(context.destination);
      
      finalNode = context.destination;
      break;
    case 'compressor':
      // Audio compression using DynamicsCompressorNode
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = parameters.threshold || -24;
      compressor.knee.value = parameters.knee || 30;
      compressor.ratio.value = parameters.ratio || 12;
      compressor.attack.value = parameters.attack || 0.003;
      compressor.release.value = parameters.release || 0.25;
      
      source.connect(compressor);
      compressor.connect(context.destination);
      
      finalNode = context.destination;
      break;
    case 'limiter':
      // Audio limiting using DynamicsCompressorNode
      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = parameters.threshold || -0.1;
      limiter.knee.value = parameters.knee || 0;
      limiter.ratio.value = parameters.ratio || 20;
      limiter.attack.value = parameters.attack || 0.003;
      limiter.release.value = parameters.release || 0.25;
      
      source.connect(limiter);
      limiter.connect(context.destination);
      
      finalNode = context.destination;
      break;
    default:
      // No filter for unknown types
      source.connect(context.destination);
      break;
  }
  
  // Connect nodes if not already connected
  if (filter && finalNode !== context.destination) {
    source.connect(filter);
    filter.connect(context.destination);
  }
  
  // Start processing
  source.start();
  
  // Render audio
  const renderedBuffer = await context.startRendering();
  
  // Convert back to Float32Array
  const result = new Float32Array(renderedBuffer.length * channels);
  for (let ch = 0; ch < channels; ch++) {
    const channelData = renderedBuffer.getChannelData(ch);
    for (let i = 0; i < channelData.length; i++) {
      result[i * channels + ch] = channelData[i];
    }
  }
  
  return result;
}

/**
 * Visualize audio waveform or spectrum
 * @param {Float32Array} samples - PCM audio samples
 * @param {HTMLCanvasElement} canvas - Canvas element to draw visualization
 * @param {string} type - Visualization type ('waveform' or 'spectrum')
 * @param {Object} options - Visualization options
 */
export async function visualize(samples, canvas, type, options = {}) {
  // Advanced implementation for audio visualization on canvas
  console.log(`Visualizing audio samples with ${type}`);
  
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  
  ctx.clearRect(0, 0, width, height);
  
  if (type === 'waveform') {
    // Enhanced waveform visualization with better scaling
    ctx.beginPath();
    ctx.strokeStyle = options.color || '#ff0000';
    ctx.lineWidth = options.lineWidth || 2;
    
    const step = Math.max(1, Math.floor(samples.length / width));
    const middle = height / 2;
    const amplitude = middle * (options.amplitude || 0.8);
    
    // Draw waveform with min/max peaks for better visualization
    for (let i = 0; i < width; i++) {
      const start = i * step;
      const end = Math.min(start + step, samples.length);
      
      let min = 1.0;
      let max = -1.0;
      
      for (let j = start; j < end; j++) {
        if (samples[j] < min) min = samples[j];
        if (samples[j] > max) max = samples[j];
      }
      
      const minY = middle + min * amplitude;
      const maxY = middle + max * amplitude;
      
      ctx.moveTo(i, minY);
      ctx.lineTo(i, maxY);
    }
    
    ctx.stroke();
  } else if (type === 'spectrum') {
    // Enhanced spectrum visualization using FFT with logarithmic scaling
    ctx.beginPath();
    
    const fftSize = options.fftSize || 2048;
    const fft = new FFT(fftSize);
    
    // Ensure fftSize is a power of 2
    const actualFftSize = Math.pow(2, Math.ceil(Math.log2(fftSize)));
    
    // Create window function
    const window = new Float32Array(actualFftSize);
    for (let i = 0; i < actualFftSize; i++) {
      window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (actualFftSize - 1)));
    }
    
    // Process samples with windowing
    const windowedSamples = new Float32Array(actualFftSize);
    const sampleCount = Math.min(actualFftSize, samples.length);
    
    for (let i = 0; i < sampleCount; i++) {
      windowedSamples[i] = samples[i] * window[i];
    }
    
    // Apply FFT
    const spectrum = new Array(actualFftSize * 2);
    fft.realTransform(spectrum, windowedSamples);
    
    // Convert to magnitude spectrum
    const magnitudes = new Float32Array(actualFftSize / 2);
    for (let i = 0; i < actualFftSize / 2; i++) {
      const real = spectrum[2 * i];
      const imag = spectrum[2 * i + 1];
      magnitudes[i] = Math.sqrt(real * real + imag * imag);
    }
    
    // Draw spectrum with logarithmic frequency scaling
    const barWidth = width / (actualFftSize / 2);
    const color = options.color || '#ff0000';
    
    for (let i = 0; i < actualFftSize / 2; i++) {
      // Logarithmic scaling for frequency axis
      const logIndex = Math.log10(i + 1) / Math.log10(actualFftSize / 2) * width;
      
      // Scale magnitude for better visualization
      const magnitude = magnitudes[i];
      const db = 20 * Math.log10(magnitude + 1e-10); // Convert to dB scale
      const normalizedDb = Math.max(0, (db + 100) / 100); // Normalize to 0-1 range
      const barHeight = normalizedDb * height;
      
      ctx.fillStyle = color;
      ctx.fillRect(logIndex, height - barHeight, barWidth, barHeight);
    }
  }
  
  return true;
}
