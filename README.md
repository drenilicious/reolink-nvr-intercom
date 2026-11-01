# Reolink NVR Intercom

**An experimental Home Assistant intercom experience for Reolink cameras connected through a Reolink NVR.**

[![HACS custom repository](https://img.shields.io/badge/HACS-Custom%20repository-41BDF5)](https://www.hacs.xyz/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Status: development](https://img.shields.io/badge/Status-Development-orange)](https://github.com/drenilicious/reolink-nvr-intercom/pulls)

Reolink NVR Intercom is a community fork of [DSorlov/reolinknvr](https://github.com/dsorlov/reolinknvr). It combines an NVR-oriented Home Assistant integration with a customizable camera card designed for a **video doorbell**: watch live video, listen, speak, and operate Home Assistant devices such as a smart lock.

> **Development status:** Work in progress, tested on one Home Assistant Green installation with a Reolink RLN16-410 NVR and a Reolink Video Doorbell PoE connected through the NVR. This is **not** an official Reolink integration, a stable release, or a standalone replacement for the official Reolink mobile app.

## What works today

| Capability | Current state |
| --- | --- |
| Camera view with sound | Working in the test installation |
| Live microphone / hang up | Working on iPhone via the **separately installed** [Reolink Talk](https://github.com/matthewholm/ha-reolink-talk) integration |
| Mobile-friendly card and fullscreen | Working in current iPhone and Firefox testing; still under refinement |
| Nuki door-unlatch button | Configurable through a Home Assistant button entity; requires confirmation; end-to-end action still to be validated |
| Reolink quick replies | UI supported, but **not working** in our NVR test: the official Reolink select reports `options: []` |
| Motion badge | Available; the badge's automatic entity matching may require further adjustment |
| Other NVR cameras, PTZ and grid card | Inherited from upstream; not yet comprehensively re-tested in this fork |

The integration still uses the internal Home Assistant domain **`reolink_nvr`**. It **cannot be installed alongside the original DSorlov integration** using the same domain. It *can* coexist with the official Home Assistant **Reolink** integration (`reolink`).

## Architecture

This is deliberately a combination of existing pieces:

- **Reolink NVR Intercom / `reolink_nvr`** — the forked backend and Lovelace camera card.
- **[Official Home Assistant Reolink integration](https://www.home-assistant.io/integrations/reolink/)** — provides camera entities and additional entities (doorbell press, quick replies, motion).
- **[Reolink Talk (Two-Way Audio)](https://github.com/matthewholm/ha-reolink-talk)** — independent integration providing live microphone transmission and its `reolink-talk-button` frontend element.

**Live talkback is not provided by this repository alone.** Our custom card embeds Reolink Talk's button. We do not redistribute its code or implement its audio protocol here.

Neither go2rtc nor a Windows Reolink CLI process is needed for **Reolink Talk's microphone path**. Video playback uses Home Assistant's normal camera streaming capabilities.

## Install for testing

**Back up your Home Assistant configuration first.** This branch is experimental.

1. Install the [official Reolink integration](https://www.home-assistant.io/integrations/reolink/) and confirm your NVR/doorbell camera entities work.
2. Install [Reolink Talk](https://github.com/matthewholm/ha-reolink-talk) as a HACS custom **Integration**, restart Home Assistant, and configure it against the **official Reolink** integration. Confirm live talkback works independently before using this card.
3. Add **`https://github.com/drenilicious/reolink-nvr-intercom`** to HACS as a custom **Integration** repository. **Important:** HACS normally installs a repository's default branch/release. The features described in this README are currently developed on [`feature/reolink-talk-card-integration`](https://github.com/drenilicious/reolink-nvr-intercom/tree/feature/reolink-talk-card-integration), not necessarily on `main`. To test the branch, use its files explicitly until the changes are reviewed and merged.
4. If using the development branch manually, place its **`custom_components/reolink_nvr`** directory in `<config>/custom_components/reolink_nvr`, replacing an existing installation of this fork. Restart Home Assistant to load Python changes.
5. Add a manual Lovelace card using the example below. After changing only frontend JavaScript, a dashboard refresh is usually enough; browser/app caching may require a full reload.

### Camera card example

The following example matches one **specific test installation**. **Entity IDs are local examples**, not defaults guaranteed on other systems.

```yaml
# Reolink NVR Intercom — example doorbell card
type: custom:reolink-camera-card

# Official Reolink camera entity: "Net" / Clear / main (higher quality)
entity: camera.doorbell_net

# Incoming sound and live talk via separate Reolink Talk integration
show_audio: true
show_microphone: true
talk_camera: doorbell

# Optional Home Assistant button entity (confirmation before pressing)
door_button_entity: button.nukifront_unlatch

# Optional official Reolink select; may have no options behind some NVRs
quick_reply_entity: select.doorbell_lire_un_message_de_reponse_rapide

ptz: false
show_header: true
show_fullscreen: true
show_motion_indicator: true
```

**Configuration notes**

- `entity` is a Home Assistant camera entity. The example uses **`camera.doorbell_net`**, the official Reolink **Clear/Net** stream. **`fluide`** is the lower-bandwidth **Fluent** profile.
- `talk_camera` is the camera name/slug resolved by the separate Reolink Talk integration. It is **not** a Home Assistant entity ID.
- `door_button_entity` must reference a valid Home Assistant `button.*` entity. It triggers a `button.press` service call **after a confirmation dialog**. Only provide this to people who are allowed to open the door.
- `quick_reply_entity` is an optional `select.*` entity from the official Reolink integration. The card can show the options that entity provides; it cannot recover missing messages.
- The obsolete SD/HD badge was removed from this card: select the intended camera stream explicitly instead.
- The fullscreen control uses a modal overlay to avoid iOS dashboard stacking problems. In portrait on small phones, an additional zoom toggle enlarges or fits the image. Enlargement may crop the sides.
- For browser microphone access, use Home Assistant through a **secure HTTPS origin** and grant microphone permission when prompted.

### Camera, PTZ and grid features

The upstream project also includes an NVR camera grid card and PTZ feature:

- `custom:reolink-camera-grid-card`
- `custom:reolink-ptz-feature`

These features remain inherited from [the upstream implementation](https://github.com/dsorlov/reolinknvr). They have not been fully validated as part of our intercom testing.

## Known limitations

### Quick replies show no messages

On our test setup, the official Reolink entity `select.doorbell_lire_un_message_de_reponse_rapide` reports:

```yaml
state: unknown
options: []
```

Although four replies are visible and playable in the Reolink mobile app, neither a reload of the official Reolink integration nor querying `reolink-cli audio replies` against the NVR returned the usable messages. The CLI returned a single disabled, unnamed entry with ID `0`. We **have not determined** whether this is an NVR firmware, camera protocol, or integration limitation.

Until this is resolved, the quick-reply menu cannot send a reply. Avoid guessing or hardcoding reply IDs.

### Live microphone

Reolink Talk must be installed and configured independently. The fork's **older go2rtc/WebRTC microphone implementation did not work** in this test and is not the supported talkback path. Reolink Talk must resolve the camera correctly; this has been validated on the test iPhone but not broadly across NVR models.

### Device notifications

A doorbell press entity (for example `binary_sensor.doorbell_visiteur`) can be used to build Home Assistant automations for phone/tablet notifications. A complete incoming-call interface and cross-device orchestration are **future work**, not features already provided by this repository.

### Other limitations

- The internal integration domain and installation structure are inherited from upstream.
- Browser and iOS/Android fullscreen behavior can differ; please report device-specific problems.
- Video stream quality and the official Reolink camera's `Net` / `Fluide` profiles should not be confused with `reolink_nvr`'s own `main` / `sub` select.
- Model support beyond the test environment is not independently confirmed.

## About the project

This project started as a personal Home Assistant experiment by **[drenilicious](https://github.com/drenilicious)**, an accountant from Belgium with absolutely no advanced coding skills, a slightly unreasonable passion for Home Assistant, and ChatGPT as his coding buddy..

A simple idea grew into a challenge: bring the Reolink doorbell's live video, two-way audio and smart-home door controls together in one practical dashboard. The philisophy that drives this project: If something doesn't exist, we'll build it. If it breaks, we'll fix it. Eventually.

Much of the development and debugging is done in collaboration with **ChatGPT**, as a coding assistant — or, less formally, a coding buddy. The project owner provides the ideas, tests everything on real hardware, reports what works (and what breaks), and makes the decisions. AI-assisted code is reviewed and tested iteratively; it isn't assumed to be correct just because it compiles.

**Powered by curiosity, coffee, plenty of trial and error, and one increasingly busy doorbell.** 😄

## Contributing / feedback

Issues and pull requests for **this fork** belong at [drenilicious/reolink-nvr-intercom](https://github.com/drenilicious/reolink-nvr-intercom/issues). Please include the Home Assistant version, NVR model and firmware, camera model, relevant logs **with passwords, tokens, serial numbers, and network details removed**, and how to reproduce the problem.

Development currently takes place in the [intercom integration pull request](https://github.com/drenilicious/reolink-nvr-intercom/pull/3).

## Credits and license

This project is derived from [**DSorlov/reolinknvr**](https://github.com/dsorlov/reolinknvr), created by **Daniel Sörlöv**. Original copyright and MIT license terms are preserved in [LICENSE](LICENSE).

Live audio functionality is provided by the separately installed [**matthewholm/ha-reolink-talk**](https://github.com/matthewholm/ha-reolink-talk) project. The Home Assistant official [Reolink integration](https://www.home-assistant.io/integrations/reolink/) also provides camera entities used in the examples.

This fork is an independent community project and is not affiliated with or endorsed by Reolink, Home Assistant, or the upstream maintainers.
