# Experimental live talkback bridge

Status: **transport skeleton only; not enabled by Home Assistant**.

## Verified on user's RLN16-410 H3MB18

- Reolink CLI 0.20.0 connects to the NVR using a dedicated local user.
- `device expand` identifies Doorbell as `nvr-maison-ch5` (zero-based channel 5).
- `audio talk --file ... --sample-rate 16000` transmitted a three-second PCM beep through the Doorbell speaker, heard by the user.
- `capabilities` fails with protocol command 199 / code 300 on this NVR; this does **not** prevent the proven file talkback.
- RTSP `Preview_06_main` provides video and camera-to-user AAC, but no advertised return-audio channel.
- No credentials or private LAN addressing should be committed to this repository.

## Why this module exists

Official reolink-cli documentation supports `audio talk --stdin` for PCM16 LE mono. `custom_components/reolink_nvr/talkback.py` is a bounded asynchronous transport that launches the proprietary CLI using `asyncio.create_subprocess_exec` (no shell), pipes PCM chunks to stdin, and cleans up the child process.

**Important:** stdin streaming has not yet been verified against the user's NVR. A successful three-second `--file` test does not prove low-latency continuous talkback.

## Remaining implementation

1. Verify `audio talk --stdin` works with short, incremental chunks and confirm whether the CLI emits speech while stdin is still open (not only after EOF).
2. Install the appropriate official Linux arm64 musl release of reolink-cli and gateway in a suitable managed environment on Home Assistant Green; do not bundle proprietary binaries in this open-source fork.
3. Add an authenticated Home Assistant WebSocket handler with explicit camera/channel authorization, single-speaker session lock, size/rate limits, idle timeout, browser-disconnect cleanup, and user-visible errors.
4. In Lovelace, capture microphone on a secure origin, resample to 16 kHz and convert Float32 to PCM16 LE, stream bounded chunks to the backend, and handle start/stop and permission errors.
5. Preserve existing working video and speaker playback. Never depend on internal `ha-camera-stream._webRtcPeerConnection` internals.
6. Test on Firefox, iPhone and Lenovo tablet, including browser permission denial and connection loss.

The reference camera alias is deliberately **not** hard-coded in the transport; it must come from an explicitly configured, authorized mapping. No username or password is required in source files.

## Documentation

- https://github.com/reolink/reolink-cli
- https://github.com/reolink/reolink-cli/blob/main/skills/reolink-cli/SKILL.md

The Reolink CLI executable is proprietary; its public repository contains distribution and documentation, not its application source.
