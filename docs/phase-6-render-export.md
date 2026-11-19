# Phase 6 — Final Server-Side FFmpeg Rendering & Export Engine

## 1. Architecture Overview
Phase 6 completes the end-to-end production pipeline of **Motion AI Studio** by turning saved `timelineData`, `audioSettings`, and uploaded user assets into downloadable commercial video and graphic exports on the server:

1. **Server Frame Rasterizer (`src/server/videoRenderer.ts`)**:
   - Registers system Arabic/Persian (`NotoSansArabic`) and Latin (`NotoSans`) fonts via `@napi-rs/canvas` `GlobalFonts`.
   - Preloads referenced image/logo `mediaAssets` safely from `UPLOADS_DIR` using `resolveSafeUserPath`.
   - Renders each frame with 1:1 parity against `computeClipMotionFrameState` (`src/shared/motionEngine.ts`): background gradients, studio accent glow, image scaling/positioning, overlays, kinetic typography animations (`fade_slide_up`, `kinetic_pop`, `typewriter`, `scale_reveal`, `slide_left`, `zoom_pulse`), and exit transitions (`whip_pan`, `zoom_cut`).
2. **FFmpeg Pipe & Multi-Format Encoding**:
   - Pipes raw RGBA frames directly to `ffmpeg` (`-f rawvideo -pix_fmt rgba -s WxH -r fps -i pipe:0`) to avoid intermediate disk bottlenecks.
   - **MP4 (`libx264`, `yuv420p`, `+faststart`, `aac`)**: Standard commercial/social output with even resolution enforcement.
   - **WebM (`libvpx-vp9`, `yuv420p`, `libopus`)**: Web-optimized streaming output.
   - **GIF (`split` + `palettegen` + `paletteuse`)**: Crisp looping animated GIFs.
   - **PNG Frame Sequence (`JSZip`)**: Packs rendered `frame_XXXX.png` frames + `manifest.json` into a single downloadable `.zip`.
   - **Audio Mixing**: Resolves `audioSettings.musicAssetId` and `audioSettings.voiceoverAssetId` (or timeline `audio` track clips), applies volume scaling, `afade` in/out, and `amix` into `mp4`/`webm` exports unless muted.
3. **Queue, Live Progress, Cancellation & Quota Safety (`src/server/routes/render.ts`)**:
   - `GET /api/renders` & `GET /api/projects/:projectId/renders`
   - `POST /api/projects/:projectId/renders` (`format`, `quality`, `fps`)
   - `POST /api/renders/:jobId/cancel` (signals abort & kills active FFmpeg child process, cleans temp directory)
   - `POST /api/renders/:jobId/retry`
   - `GET /api/renders/:jobId/download` (ownership-checked, `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`)
   - `DELETE /api/renders/:jobId?confirm=true` (removes export artifact & reclaims `users.storageUsedBytes`)
   - Emits `render:queued`, `render:progress`, `render:completed`, `render:failed`, `render:cancelled` over WebSocket (`/ws`).
4. **Frontend Export Workspace (`src/components/RenderExportView.tsx`)**:
   - Integrated as the 5th tab (`خروجی و رندر نهایی` / `Render & Export`) in `ProjectsWorkspaceView.tsx`.
   - Includes format/quality/FPS selectors, calculated output dimensions, storage quota bar, live progress bars, authenticated video/GIF preview modal, authenticated Blob download, and `ConfirmDialog` deletion.
   - `DashboardView.tsx` outputs table also supports direct authenticated download and size/progress display.
