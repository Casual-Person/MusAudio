// MP3 metadata extraction using jsmediatags
// Exports: extractMp3Tags(file: File) => Promise<{ title, artist, album, track, year, genre, pictureUrl, mime, raw }>

export async function extractMp3Tags(file){
  if (!file) return null;
  const jsmt = (window.jsmediatags || self.jsmediatags);
  if (!jsmt || typeof jsmt.read !== 'function') return null;
  return new Promise((resolve) => {
    try{
      jsmt.read(file, {
        onSuccess: (res)=>{
          const tags = res?.tags || {};
          const out = {
            title: tags.title || '',
            artist: tags.artist || '',
            album: tags.album || '',
            track: (typeof tags.track === 'string' ? tags.track : (tags.track?.toString?.()||'')),
            year: tags.year || '',
            genre: tags.genre || '',
            pictureUrl: '',
            mime: '',
            raw: res
          };
          try{
            const pic = tags.picture;
            if (pic && Array.isArray(pic.data)){
              const mime = pic.format || pic.mime || 'image/jpeg';
              const u8 = new Uint8Array(pic.data);
              const blob = new Blob([u8], { type: mime });
              const url = URL.createObjectURL(blob);
              out.pictureUrl = url; out.mime = mime;
            }
          }catch{}
          resolve(out);
        },
        onError: ()=> resolve(null)
      });
    }catch{ resolve(null); }
  });
}
