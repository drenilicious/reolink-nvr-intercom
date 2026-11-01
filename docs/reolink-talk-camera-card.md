# Camera card + Reolink Talk live microphone (experimental)

This feature keeps the existing `ha-camera-stream` video and speaker toggle and embeds the independently installed `reolink-talk-button` for microphone talkback.

## Prerequisites

- HACS integration [matthewholm/ha-reolink-talk](https://github.com/matthewholm/ha-reolink-talk), configured against the official Home Assistant Reolink integration.
- Secure HTTPS Home Assistant URL for browser microphone permission.
- The Reolink Talk JS resource must be registered by that integration.

## Lovelace example

```yaml
type: custom:reolink-camera-card
entity: camera.doorbell
ptz: false
show_microphone: true
talk_camera: doorbell
show_audio: true
show_header: true
show_fullscreen: true
show_motion_indicator: true
```

`talk_camera` is the *Reolink Talk camera name slug*, not the Home Assistant camera entity ID. It must match the camera name advertised by the official Reolink integration. The working live microphone component is only displayed when `talk_camera` is configured.

The legacy nonfunctional go2rtc microphone button is hidden in this mode; its code is not invoked. The Reolink Talk element opens and closes its own authorized audio WebSocket. No Reolink passwords are passed to the card or stored in this repository.

## Testing / known limits

- Not yet tested on the user's Home Assistant Green and RLN16-410.
- If the camera does not appear in the Reolink Talk channel map, the talk button cannot connect even though the video works.
- iPhone permissions and secure HTTPS origin are required.
- Frontend JS caching may require a hard reload after replacing the installed card JS.
- This branch does not merge the Reolink Talk integration into this repository and does not implement the Reolink protocol itself.
