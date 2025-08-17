// Minimal EC-3 / AC-3 syncframe header parser (vanilla JS)
// Parses first syncframe to infer sampleRate, channels (approx), acmod, lfeon, bsid.
// References: ATSC A/52, ETSI TS 102 366 (simplified, not a full decoder)

class BitReader{
  constructor(u8, bitOffset=0){ this.u8=u8; this.bitPos=bitOffset; }
  read(n){ let v=0; for(let i=0;i<n;i++){ const byteI = this.bitPos>>3; const bitI = 7-(this.bitPos&7); const b = (this.u8[byteI]>>bitI)&1; v=(v<<1)|b; this.bitPos++; } return v; }
  skip(n){ this.bitPos+=n; }
  align(){ const m=this.bitPos&7; if(m) this.bitPos+=8-m; }
}

function acmodToChannels(acmod){
  // AC-3 style channel config counts (without LFE)
  // 0: dual mono (2), 1: 1/0, 2: 2/0, 3: 3/0, 4: 2/1, 5: 3/1, 6: 2/2, 7: 3/2
  const table = {0:2,1:1,2:2,3:3,4:3,5:4,6:4,7:5};
  return table[acmod] ?? 2;
}

export function parseEc3Info(buffer){
  try{
    const u8 = buffer instanceof Uint8Array? buffer : new Uint8Array(buffer);
    // find syncword 0x0B77
    let i=0; const N=u8.length;
    for(; i+1<N; i++) if(u8[i]===0x0B && u8[i+1]===0x77) break;
    if (i+1>=N) return { ok:false, reason:'no-sync' };
    const br = new BitReader(u8, (i+2)*8); // after syncword

    // Try E-AC-3 layout first
    const strmtyp = br.read(2);
    const substreamid = br.read(3);
    const frmsiz = br.read(11); // bytes = (frmsiz+1)*2 in AC-3/E-AC-3
    const fscod = br.read(2);
    let fscod2 = 0;
    let sampleRate = 0;
    if (fscod !== 3){
      sampleRate = [48000,44100,32000][fscod] || 0;
    } else {
      fscod2 = br.read(2);
      sampleRate = [24000,22050,16000][fscod2] || 0;
    }
    const bsid = br.read(5);
    const bsmod = br.read(3);
    const acmod = br.read(3);
    const lfeon = br.read(1);

    let channels = acmodToChannels(acmod) + (lfeon?1:0);

    const frameSizeBytes = (frmsiz+1)*2;
    const isEac3 = bsid>=11; // heuristic: E-AC-3 typically 11..16

    return {
      ok:true,
      isEac3: !!isEac3,
      bsid, acmod, lfeon: !!lfeon, bsmod,
      sampleRate, frameSize: frameSizeBytes,
      channels,
      strmtyp, substreamid,
    };
  }catch(e){
    return { ok:false, reason:e.message||'parse-failed' };
  }
}

export default parseEc3Info;
