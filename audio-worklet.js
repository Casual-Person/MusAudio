class PcmPlayerProcessor extends AudioWorkletProcessor{
  constructor(){
    super();
    // Primary buffer A
    this.bufferA = new Float32Array(0); // interleaved
    this.channelsA = 2;
    this.readIndexA = 0; // frames
    this.playingA = false;
    // Secondary buffer B (for automix)
    this.bufferB = null; // Float32Array
    this.channelsB = 2;
    this.readIndexB = 0; // frames
    this.playingB = false; // becomes true during crossfade
    // Crossfade
    this.fadeActive = false;
    this.fadeStartA = 0; // frame index in A when fade started
    this.fadeDurFrames = 0;
    this.fadeProgFrames = 0; // progresses regardless of A availability
    // Misc
    this.sampleRate = sampleRate;
    this.lastTimeReport = 0;
    this.port.onmessage = (e)=>{
      const d = e.data||{};
      if (d.type==='load'){
        // reset and load into A
        this.bufferA = d.pcm||new Float32Array(0);
        this.channelsA = d.channels||2;
        this.readIndexA = 0;
        this.playingA = true;
        // clear B and fade
        this.bufferB = null; this.readIndexB = 0; this.channelsB = 2; this.playingB = false;
        this.fadeActive = false; this.fadeDurFrames = 0;
      } else if (d.type==='play'){ this.playingA = true; /* if fading, B continues */ }
      else if (d.type==='pause'){ this.playingA = false; this.playingB = false; }
      else if (d.type==='seek'){
        const totalFramesA = Math.floor((this.bufferA.length||0)/Math.max(1,this.channelsA));
        const frames = Math.max(0, Math.min(totalFramesA, Math.floor(d.position*this.sampleRate)));
        this.readIndexA = frames;
      } else if (d.type==='nudge'){
        const totalFramesA = Math.floor((this.bufferA.length||0)/Math.max(1,this.channelsA));
        const frames = Math.floor(d.delta*this.sampleRate);
        this.readIndexA = Math.max(0, Math.min(totalFramesA, this.readIndexA+frames));
      } else if (d.type==='prepareB'){
        this.bufferB = d.pcm||null;
        this.channelsB = d.channels||2;
        const totalFramesB = Math.floor((this.bufferB?this.bufferB.length:0)/Math.max(1,this.channelsB));
        const start = Math.max(0, Math.min(totalFramesB, Math.floor(d.startFrame||0)));
        this.readIndexB = start;
        this.playingB = false;
      } else if (d.type==='startCrossfade'){
        const dur = Math.max(0.01, Number(d.durationSec||0));
        this.fadeDurFrames = Math.floor(dur*this.sampleRate);
        this.fadeStartA = this.readIndexA;
        this.fadeProgFrames = 0;
        this.playingB = true;
        this.fadeActive = true;
      }
    };
  }
  _readStereo(buf, channels, frameIndex){
    const i = frameIndex*channels;
    const L = buf[i]||0;
    const R = channels>1? (buf[i+1]||0) : L;
    return [L, R];
  }
  process(inputs, outputs, params){
    const out = outputs[0];
    const ch0 = out[0]; const ch1 = out[1] || out[0];
    const frames = ch0.length;
    for (let i=0;i<frames;i++){
      let aL=0, aR=0, bL=0, bR=0;
      const totalFramesA = Math.floor((this.bufferA.length||0)/Math.max(1,this.channelsA));
      const totalFramesB = Math.floor((this.bufferB?this.bufferB.length:0)/Math.max(1,this.channelsB));
      const aActive = this.playingA && this.readIndexA < totalFramesA;
      const bActive = this.playingB && this.bufferB && this.readIndexB < totalFramesB;
      if (aActive){
        const s = this._readStereo(this.bufferA, this.channelsA, this.readIndexA);
        aL = s[0]; aR = s[1];
      }
      if (bActive){
        const s = this._readStereo(this.bufferB, this.channelsB, this.readIndexB);
        bL = s[0]; bR = s[1];
      }
      let gA = aActive? 1: 0;
      let gB = bActive? 0: 0;
      if (this.fadeActive){
        const t = this.fadeDurFrames>0? Math.min(1, this.fadeProgFrames/this.fadeDurFrames) : 1;
        gA = aActive? (1 - t) : 0;
        gB = bActive? t : 0;
        if (t>=1){
          // Fade complete: switch B -> A
          this.fadeActive = false;
          this.playingA = true;
          this.bufferA = this.bufferB || new Float32Array(0);
          this.channelsA = this.channelsB||2;
          this.readIndexA = this.readIndexB;
          // clear B
          this.bufferB = null; this.channelsB = 2; this.readIndexB = 0; this.playingB = false;
          // Notify main thread that switch occurred and provide new duration
          const durSec = (this.bufferA.length/(Math.max(1,this.channelsA)*this.sampleRate))||0;
          this.port.postMessage({ type:'automix_switched', duration: durSec });
        }
      }
      ch0[i] = aL*gA + bL*gB;
      ch1[i] = aR*gA + bR*gB;
      if (aActive) this.readIndexA++;
      if (bActive) this.readIndexB++;
      if (this.fadeActive) this.fadeProgFrames++;
      if (!aActive && !this.fadeActive){ this.playingA = false; }
    }
    // report time of primary A at ~10Hz
    if (currentTime - this.lastTimeReport > 0.1){
      const timeA = this.readIndexA/this.sampleRate;
      this.port.postMessage({ type:'tick', time: timeA });
      this.lastTimeReport = currentTime;
    }
    return true;
  }
}
registerProcessor('pcm-player', PcmPlayerProcessor);
