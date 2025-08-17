Place the following files in this folder to enable local ffmpeg.wasm decoding:

Required (version 0.12.x):
- ffmpeg.min.js
- ffmpeg-core.js
- ffmpeg-core.wasm

You can obtain them from the @ffmpeg npm package or CDN and copy locally:
- Package: @ffmpeg/ffmpeg@0.12.x and @ffmpeg/core@0.12.x

File mapping expected by the app:
- ./vendor/ffmpeg/ffmpeg.min.js
- ./vendor/ffmpeg/ffmpeg-core.js
- ./vendor/ffmpeg/ffmpeg-core.wasm

No code changes required after placing these files. Reload the app and decoding will initialize without external network requests.
