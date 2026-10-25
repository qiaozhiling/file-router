# libmedia 1.3.1

Player: @libmedia/avplayer-ui 1.3.1, copyright the libmedia contributors,
LGPL-3.0-or-later. See COPYING.LGPLv3.

Source and build instructions:
https://github.com/zhaohappy/libmedia/tree/v1.3.1

The player UMD bundle (including its dynamic chunks) is from the official npm
package. The cheap polyfill and baseline WASM decoder, resampling and pitch
modules are from the same v1.3.1 release's dist directory. The decoder modules
include FFmpeg code; upstream source, third-party notices and build configuration
are available in that release. The modules are loaded as separate local resources
and may be replaced with compatible builds. No video is uploaded to a third party.

Asset hashes are recorded in manifest.json. Application integration is in
/video-player.js. The application uses no Service Worker, Cache API, IndexedDB
or filesystem storage for media playback.
