// Simple Web Atmos virtualization mixer (vanilla JS)
// Accepts interleaved Float32 PCM with N channels and outputs stereo (L/R)
// via a pragmatic per-channel mixing matrix.

class AtmosMixerProcessor extends AudioWorkletProcessor{
  constructor(){
    super();
    this.buffer = new Float32Array(0); // interleaved Nch
    this.readIndex = 0; // frames
    this.playing = false;
    this.sampleRate = sampleRate;
    this.channels = 2; // input channels
    this.duration = 0;
    this.lastTimeReport = 0;
    this.lastLevelReport = 0;
    this.mixL = [1,0]; // per-channel gains to L
    this.mixR = [0,1]; // per-channel gains to R
    this.lfeIndex = -1;
    this.virtualization = true;
    this.lastLayout = {};

    this.port.onmessage = (e)=>{
      const d = e.data||{};
      if (d.type==='load'){
        this.buffer = d.pcm||new Float32Array(0);
        this.channels = Math.max(1, d.channels|0 || 2);
        this.sampleRate = d.sampleRate||this.sampleRate;
        this.duration = this.buffer.length/(this.channels*this.sampleRate);
        this.readIndex = 0; this.playing = true;
        this.virtualization = d.virtualization!==false;
        this.lastLayout = d.layout||{};
        this.configureMatrix(this.lastLayout, this.channels);
      } else if (d.type==='play'){ this.playing = true; }
      else if (d.type==='pause'){ this.playing = false; }
      else if (d.type==='seek'){
        const frames = Math.max(0, Math.min(this.buffer.length/this.channels, Math.floor((d.position||0)*this.sampleRate)));
        this.readIndex = frames;
      } else if (d.type==='nudge'){
        const frames = Math.floor((d.delta||0)*this.sampleRate);
        this.readIndex = Math.max(0, Math.min(this.buffer.length/this.channels, this.readIndex+frames));
      } else if (d.type==='virtualization'){
        this.virtualization = !!d.enabled;
        this.configureMatrix(this.lastLayout, this.channels);
      }
    };
  }

  // Configure a pragmatic matrix from layout or channel count
  configureMatrix(layout, ch){
    // AC-3 aware mapping. Assume input order per AC-3: for 3/2: L, C, R, Ls, Rs, (+LFE)
    // For 2/0: L, R. For 3/0: L, C, R. For 2/2: L, R, Ls, Rs. For 3/1: L, C, R, S.
    // We will generate a role list for channels and a template of [L,R] coefficients.
    const acmod = (layout.acmod|0) || (ch===1?1:(ch===2?2:(ch===3?3:(ch===4?4:(ch===5?6:7)))));
    const lfeon = !!layout.lfeon;
    const roles = []; // 'L','R','C','Ls','Rs','S','LFE','X'
    const templ = []; // per-channel [L,R]

    const push = (role, l, r)=>{ roles.push(role); templ.push([l, r]); };

    const C3 = 0.7071;   // -3 dB for center into L/R
    const S6 = 0.5;      // -6 dB for surrounds in stereo downmix
    const LFE = 0.3162;  // -10 dB for LFE into stereo

    if (acmod === 2){ // 2/0: L R
      if (ch>=1) push('L', 1.0, 0.0);
      if (ch>=2) push('R', 0.0, 1.0);
    } else if (acmod === 7){ // 3/2: L C R Ls Rs
      push('L', 1.0, 0.0);
      if (ch>=2) push('C', C3, C3);
      if (ch>=3) push('R', 0.0, 1.0);
      if (ch>=4) push('Ls', 0.6, 0.2);
      if (ch>=5) push('Rs', 0.2, 0.6);
    } else if (acmod === 6){ // 2/2: L R Ls Rs
      push('L', 1.0, 0.0);
      if (ch>=2) push('R', 0.0, 1.0);
      if (ch>=3) push('Ls', 0.6, 0.2);
      if (ch>=4) push('Rs', 0.2, 0.6);
    } else if (acmod === 3){ // 3/0: L C R
      push('L', 1.0, 0.0);
      if (ch>=2) push('C', C3, C3);
      if (ch>=3) push('R', 0.0, 1.0);
    } else if (acmod === 5){ // 3/1: L C R S
      push('L', 1.0, 0.0);
      if (ch>=2) push('C', C3, C3);
      if (ch>=3) push('R', 0.0, 1.0);
      if (ch>=4) push('S', S6, S6);
    } else if (acmod === 4){ // 2/1: L R S
      push('L', 1.0, 0.0);
      if (ch>=2) push('R', 0.0, 1.0);
      if (ch>=3) push('S', S6, S6);
    } else if (acmod === 1){ // 1/0: C
      push('C', C3, C3);
    } else {
      // Fallback by count
      if (ch>=1) push('L', 1.0, 0.0);
      if (ch>=2) push('R', 0.0, 1.0);
      if (ch>=3) push('C', C3, C3);
      if (ch>=4) push('Ls', 0.6, 0.2);
      if (ch>=5) push('Rs', 0.2, 0.6);
    }

    // LFE if present
    if (lfeon && roles.length < ch){ this.lfeIndex = roles.length; push('LFE', LFE, LFE); }

    // Any extra channels (heights/wides) beyond known roles
    for (let i=roles.length; i<ch; i++){
      const k = i - roles.length;
      const phase = k % 4; // alternate left/right bias
      const base = 0.45, cross = 0.30;
      if (phase===0){ push('X', base, cross); }
      else if (phase===1){ push('X', cross, base); }
      else if (phase===2){ push('X', base*0.8, cross*1.05); }
      else { push('X', cross*1.05, base*0.8); }
    }

    // Virtualization toggle behavior: if disabled, use a conservative stereo downmix (no crossfeed for surrounds/extra)
    if (!this.virtualization){
      for (let i=0;i<templ.length;i++){
        const role = roles[i];
        if (role==='Ls'){ templ[i][1] = 0.0; templ[i][0] = S6; }
        else if (role==='Rs'){ templ[i][0] = 0.0; templ[i][1] = S6; }
        else if (role==='S'){ templ[i][0] = S6; templ[i][1] = S6; }
        else if (role==='X'){ // extra channels -> slight feed to both
          templ[i][0] = 0.35; templ[i][1] = 0.35;
        }
        // L, R, C, LFE remain as assigned above
      }
    }

    // Safer normalization: bound peak gain per output based on sum of abs coeffs
    let sumL = 0, sumR = 0;
    for (let i=0;i<templ.length;i++){ sumL += Math.abs(templ[i][0]); sumR += Math.abs(templ[i][1]); }
    const peak = Math.max(sumL, sumR, 1);
    const norm = peak>1 ? (1/peak) : 1;

    this.mixL = new Float32Array(ch); this.mixR = new Float32Array(ch);
    for (let i=0;i<ch;i++){
      const t = templ[i] || [0,0];
      this.mixL[i] = t[0] * norm;
      this.mixR[i] = t[1] * norm;
    }
  }

  process(inputs, outputs){
    const out = outputs[0];
    const L = out[0]; const R = out[1] || out[0];
    const frames = L.length; const ch = this.channels;
    const buf = this.buffer;
    const mixL = this.mixL, mixR = this.mixR;
    // Meter accumulators
    const acc = new Float32Array(ch);

    for (let i=0;i<frames;i++){
      if (!this.playing || this.readIndex>=buf.length/ch){ L[i]=0; R[i]=0; continue; }
      let sumL = 0.0, sumR = 0.0;
      const base = this.readIndex*ch;
      for (let c=0;c<ch;c++){
        const s = buf[base+c]||0;
        acc[c] += s*s;
        sumL += s * (mixL[c]||0);
        sumR += s * (mixR[c]||0);
      }
      // Simple soft clip
      L[i] = Math.max(-1, Math.min(1, sumL));
      R[i] = Math.max(-1, Math.min(1, sumR));
      this.readIndex++;
    }

    // report time
    if (currentTime - this.lastTimeReport > 0.1){
      this.port.postMessage({ type:'tick', time: this.readIndex/this.sampleRate });
      this.lastTimeReport = currentTime;
    }
    // report levels (RMS per input channel)
    if (currentTime - this.lastLevelReport > 0.08){
      const levels = new Float32Array(ch);
      const denom = Math.max(1, frames);
      for (let c=0;c<ch;c++) levels[c] = Math.sqrt((acc[c]||0)/denom);
      this.port.postMessage({ type:'levels', channels: ch, levels });
      this.lastLevelReport = currentTime;
    }
    return true;
  }
}

registerProcessor('atmos-mixer', AtmosMixerProcessor);
