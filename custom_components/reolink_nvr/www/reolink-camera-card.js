/**
 * Reolink Camera Card — Touch-friendly single camera view with PTZ and mic.
 *
 * Features:
 * - WebRTC video via HA's <ha-camera-stream>
 * - PTZ directional pad overlay (translucent, touch-friendly)
 * - Optional live microphone powered by Reolink Talk (separate integration)
 * - Pinch-to-zoom (CSS transform)
 * - Double-tap fullscreen
 * - Motion indicator badge
 * - Stream quality toggle (sub/main)
 */

// Register card synchronously so the card picker sees it immediately
window.customCards = window.customCards || [];
window.customCards.push({
  type: "reolink-camera-card",
  name: "Reolink Camera",
  preview: false,
  description:
    "Touch-friendly camera card with WebRTC, PTZ controls, and two-way audio for Reolink NVR cameras.",
});

(async () => {

await customElements.whenDefined("ha-panel-lovelace");

const LitElement = Object.getPrototypeOf(
  customElements.get("ha-panel-lovelace")
);
const html = LitElement.prototype.html;
const css = LitElement.prototype.css;

class ReolinkCameraCard extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      config: { type: Object },
      _fullscreen: { type: Boolean },
      _micActive: { type: Boolean },
      _audioMuted: { type: Boolean },
      _showPtz: { type: Boolean },
      _scale: { type: Number },
      _translateX: { type: Number },
      _translateY: { type: Number },
    };
  }

  constructor() {
    super();
    this._fullscreen = false;
    this._micActive = false;
    this._audioMuted = true;
    this._showPtz = false;
    this._scale = 1;
    this._translateX = 0;
    this._translateY = 0;
    this._lastTap = 0;
    this._initialPinchDistance = null;
    this._initialScale = 1;
    this._mediaStream = null;
  }

  static getConfigElement() {
    return document.createElement("reolink-camera-card-editor");
  }

  static getStubConfig(hass) {
    const cameras = Object.keys(hass.states).filter(
      (e) => e.startsWith("camera.") && e.includes("reolink_nvr")
    );
    return {
      entity: cameras[0] || "camera.reolink_nvr",
      ptz: true,
      show_motion_indicator: true,
      show_microphone: true,
    };
  }

  setConfig(config) {
    if (!config.entity) {
      throw new Error("You must specify a camera entity");
    }
    this.config = {
      ptz: true,
      show_motion_indicator: true,
      show_microphone: true,
      talk_camera: null, // Reolink Talk slug, e.g. 'doorbell'
      show_audio: true,
      show_header: true,
      show_fullscreen: true,
      ...config,
    };
  }

  getCardSize() {
    return 5;
  }

  // --- Helpers ---

  get _stateObj() {
    return this.hass ? this.hass.states[this.config.entity] : null;
  }

  get _hasSpeaker() {
    const state = this._stateObj;
    return state && state.attributes && state.attributes.has_speaker === true;
  }

  get _hasPtz() {
    const state = this._stateObj;
    return state && state.attributes && state.attributes.ptz_supported === true;
  }

  get _motionDetected() {
    if (!this.hass || !this.config.show_motion_indicator) return false;
    // Primary: match by channel attribute (reliable)
    const camState = this._stateObj;
    if (camState && camState.attributes && camState.attributes.channel !== undefined) {
      const ch = camState.attributes.channel;
      for (const [entityId, entityState] of Object.entries(this.hass.states)) {
        if (
          entityId.startsWith("binary_sensor.") &&
          entityState.attributes &&
          entityState.attributes.device_class === "motion" &&
          entityState.attributes.channel === ch
        ) {
          return entityState.state === "on";
        }
      }
    }
    // Fallback: entity_id pattern matching
    const base = this.config.entity.replace("camera.", "");
    const pattern = base.replace("_camera", "");
    for (const [entityId, entityState] of Object.entries(this.hass.states)) {
      if (
        entityId.startsWith("binary_sensor.") &&
        entityId.includes(pattern) &&
        entityId.endsWith("_motion")
      ) {
        return entityState.state === "on";
      }
    }
    return false;
  }

  get _streamQuality() {
    const state = this._stateObj;
    return state && state.attributes
      ? state.attributes.stream_quality || "sub"
      : "sub";
  }

  get _cameraName() {
    const state = this._stateObj;
    return state ? state.attributes.friendly_name || this.config.entity : this.config.entity;
  }

  // --- PTZ ---

  _sendPtzCommand(command) {
    const base = this.config.entity.replace("camera.", "");
    const pattern = base.replace("_camera", "");
    // Find the PTZ button entity
    const buttonEntity = `button.${pattern}_ptz_${command}`;
    // Check if it exists, otherwise try the service
    if (this.hass.states[buttonEntity]) {
      this.hass.callService("button", "press", {
        entity_id: buttonEntity,
      });
    } else {
      // Fallback: try integration service
      this.hass.callService("reolink_nvr", "ptz_control", {
        entity_id: this.config.entity,
        command: command,
      });
    }
  }

  _handlePtzStart(command) {
    this._sendPtzCommand(command);
    this._ptzInterval = setInterval(() => {
      this._sendPtzCommand(command);
    }, 300);
  }

  _handlePtzEnd() {
    if (this._ptzInterval) {
      clearInterval(this._ptzInterval);
      this._ptzInterval = null;
    }
    this._sendPtzCommand("stop");
  }

  // --- Audio ---

  _toggleAudio() {
    this._audioMuted = !this._audioMuted;
  }

  // --- Microphone ---

  async _toggleMic() {
    if (this._micActive) {
      this._stopMic();
    } else {
      await this._startMic();
    }
  }

  async _startMic() {
    try {
      this._mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      this._micActive = true;
      // The actual audio transmission happens via the WebRTC connection
      // managed by go2rtc / ha-camera-stream. We need to signal it.
      const videoEl = this.shadowRoot.querySelector("ha-camera-stream");
      if (videoEl && videoEl._webRtcPeerConnection) {
        const pc = videoEl._webRtcPeerConnection;
        this._mediaStream.getAudioTracks().forEach((track) => {
          pc.addTrack(track, this._mediaStream);
        });
      }
    } catch (err) {
      console.error("Reolink NVR: Microphone access denied", err);
      this._micActive = false;
    }
  }

  _stopMic() {
    if (this._mediaStream) {
      this._mediaStream.getTracks().forEach((track) => track.stop());
      this._mediaStream = null;
    }
    this._micActive = false;
  }

  // --- Reolink Talk integration ---

  updated() {
    // Reolink Talk registers its own custom element and authenticates requests.
    // We only embed the element; we never handle credentials or microphone data.
    const host = this.shadowRoot?.getElementById("reolink-talk-button-host");
    if (!host || !this.config?.talk_camera) return;

    if (!customElements.get("reolink-talk-button")) {
      // Its JS resource may load after ours on the first page visit.
      if (!this._waitingForTalkButton) {
        this._waitingForTalkButton = true;
        customElements.whenDefined("reolink-talk-button").then(() => {
          this._waitingForTalkButton = false;
          if (this.isConnected) this.requestUpdate();
        });
      }
      return;
    }

    let button = host.querySelector("reolink-talk-button");
    if (!button) {
      button = document.createElement("reolink-talk-button");
      button.setConfig({camera: this.config.talk_camera});
      button.hass = this.hass;
      host.appendChild(button);
    } else {
      if (button._camera !== this.config.talk_camera) {
        button._stop?.();
        button.setConfig({camera: this.config.talk_camera});
      }
      button.hass = this.hass;
    }
  }

  // --- Touch gestures ---

  _handleTap(e) {
    const now = Date.now();
    if (now - this._lastTap < 300) {
      this._toggleFullscreen();
    }
    this._lastTap = now;
  }

  _toggleFullscreen() {
    if (!this._fullscreen) {
      const el = this.shadowRoot.querySelector(".card-container");
      if (el && el.requestFullscreen) {
        el.requestFullscreen();
      }
      this._fullscreen = true;
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
      this._fullscreen = false;
    }
  }

  _handleTouchStart(e) {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      this._initialPinchDistance = Math.hypot(dx, dy);
      this._initialScale = this._scale;
    }
  }

  _handleTouchMove(e) {
    if (e.touches.length === 2 && this._initialPinchDistance) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const distance = Math.hypot(dx, dy);
      const ratio = distance / this._initialPinchDistance;
      this._scale = Math.min(Math.max(this._initialScale * ratio, 1), 5);
      e.preventDefault();
    }
  }

  _handleTouchEnd(e) {
    this._initialPinchDistance = null;
    if (this._scale < 1.1) {
      this._scale = 1;
      this._translateX = 0;
      this._translateY = 0;
    }
  }

  _resetZoom() {
    this._scale = 1;
    this._translateX = 0;
    this._translateY = 0;
  }

  // --- Stream quality ---

  _toggleStreamQuality() {
    const base = this.config.entity.replace("camera.", "");
    const pattern = base.replace("_camera", "");
    const selectEntity = `select.${pattern}_stream_quality`;

    const newQuality = this._streamQuality === "sub" ? "main" : "sub";
    this.hass.callService("select", "select_option", {
      entity_id: selectEntity,
      option: newQuality,
    });
  }

  // --- Render ---

  render() {
    if (!this.hass || !this.config) {
      return html`<ha-card>Loading...</ha-card>`;
    }

    const stateObj = this._stateObj;
    if (!stateObj) {
      return html`<ha-card>
        <div class="error">Entity not found: ${this.config.entity}</div>
      </ha-card>`;
    }

    const showPtz = this.config.ptz && this._hasPtz;
    // The legacy mic button cannot send sound to the NVR. Only expose the
    // working Reolink Talk control when an explicit camera slug is configured.
    const showMic = this.config.show_microphone && !!this.config.talk_camera;
    const motionActive = this._motionDetected;

    const videoTransform = `scale(${this._scale}) translate(${this._translateX}px, ${this._translateY}px)`;

    return html`
      <ha-card>
        <div
          class="card-container ${this._fullscreen ? "fullscreen" : ""}"
          @touchstart=${this._handleTouchStart}
          @touchmove=${this._handleTouchMove}
          @touchend=${this._handleTouchEnd}
        >
          <!-- Header bar -->
          ${this.config.show_header ? html`
          <div class="header">
            <span class="camera-name">${this._cameraName}</span>
            <div class="header-badges">
              ${motionActive
                ? html`<span class="badge motion-badge">Motion</span>`
                : ""}
              <span
                class="badge quality-badge"
                @click=${this._toggleStreamQuality}
              >
                ${this._streamQuality === "sub" ? "SD" : "HD"}
              </span>
            </div>
          </div>
          ` : ""}

          <!-- Video -->
          <div
            class="video-container"
            @click=${this._handleTap}
            style="transform: ${videoTransform}; transform-origin: center center;"
          >
            <ha-camera-stream
              .hass=${this.hass}
              .stateObj=${stateObj}
              .muted=${this._audioMuted}
            ></ha-camera-stream>
          </div>

          <!-- Controls overlay -->
          <div class="controls-overlay">
            <!-- Left controls -->
            <div class="controls-left">
              ${this.config.show_audio ? html`
              <button
                class="control-btn speaker-btn ${this._audioMuted
                  ? ""
                  : "active"}"
                @click=${this._toggleAudio}
                title="Toggle audio"
              >
                <ha-icon
                  icon=${this._audioMuted
                    ? "mdi:volume-off"
                    : "mdi:volume-high"}
                ></ha-icon>
              </button>
              ` : ""}
              ${showMic
                ? html`<div id="reolink-talk-button-host" class="talk-button-host"></div>`
                : ""}
              ${this.config.show_fullscreen ? html`
              <button
                class="control-btn"
                @click=${this._toggleFullscreen}
                title="Fullscreen"
              >
                <ha-icon
                  icon=${this._fullscreen
                    ? "mdi:fullscreen-exit"
                    : "mdi:fullscreen"}
                ></ha-icon>
              </button>
              ` : ""}
              ${this._scale > 1.1
                ? html`
                    <button
                      class="control-btn"
                      @click=${this._resetZoom}
                      title="Reset zoom"
                    >
                      <ha-icon icon="mdi:magnify-close"></ha-icon>
                    </button>
                  `
                : ""}
            </div>

            <!-- PTZ pad -->
            ${showPtz
              ? html`
                  <div class="ptz-overlay">
                    <div class="ptz-pad">
                      <button
                        class="ptz-btn ptz-up"
                        @pointerdown=${() => this._handlePtzStart("up")}
                        @pointerup=${this._handlePtzEnd}
                        @pointerleave=${this._handlePtzEnd}
                      >
                        <ha-icon icon="mdi:chevron-up"></ha-icon>
                      </button>
                      <button
                        class="ptz-btn ptz-left"
                        @pointerdown=${() => this._handlePtzStart("left")}
                        @pointerup=${this._handlePtzEnd}
                        @pointerleave=${this._handlePtzEnd}
                      >
                        <ha-icon icon="mdi:chevron-left"></ha-icon>
                      </button>
                      <button
                        class="ptz-btn ptz-center"
                        @click=${() => this._sendPtzCommand("stop")}
                      >
                        <ha-icon icon="mdi:circle-small"></ha-icon>
                      </button>
                      <button
                        class="ptz-btn ptz-right"
                        @pointerdown=${() => this._handlePtzStart("right")}
                        @pointerup=${this._handlePtzEnd}
                        @pointerleave=${this._handlePtzEnd}
                      >
                        <ha-icon icon="mdi:chevron-right"></ha-icon>
                      </button>
                      <button
                        class="ptz-btn ptz-down"
                        @pointerdown=${() => this._handlePtzStart("down")}
                        @pointerup=${this._handlePtzEnd}
                        @pointerleave=${this._handlePtzEnd}
                      >
                        <ha-icon icon="mdi:chevron-down"></ha-icon>
                      </button>
                    </div>
                    <!-- Zoom controls -->
                    <div class="zoom-controls">
                      <button
                        class="ptz-btn"
                        @pointerdown=${() => this._handlePtzStart("zoom_in")}
                        @pointerup=${this._handlePtzEnd}
                        @pointerleave=${this._handlePtzEnd}
                      >
                        <ha-icon icon="mdi:plus"></ha-icon>
                      </button>
                      <button
                        class="ptz-btn"
                        @pointerdown=${() => this._handlePtzStart("zoom_out")}
                        @pointerup=${this._handlePtzEnd}
                        @pointerleave=${this._handlePtzEnd}
                      >
                        <ha-icon icon="mdi:minus"></ha-icon>
                      </button>
                    </div>
                  </div>
                `
              : ""}
          </div>
        </div>
      </ha-card>
    `;
  }

  static get styles() {
    return css`
      :host {
        display: block;
      }

      ha-card {
        overflow: hidden;
        position: relative;
        border-radius: var(--ha-card-border-radius, 12px);
      }

      .card-container {
        position: relative;
        background: #000;
        aspect-ratio: 16 / 9;
        overflow: hidden;
      }

      .card-container.fullscreen {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        z-index: 9999;
        aspect-ratio: auto;
      }

      /* Header */
      .header {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 12px;
        background: linear-gradient(
          to bottom,
          rgba(0, 0, 0, 0.6),
          transparent
        );
        z-index: 3;
        pointer-events: none;
      }

      .camera-name {
        color: #fff;
        font-size: 14px;
        font-weight: 500;
        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
      }

      .header-badges {
        display: flex;
        gap: 6px;
        pointer-events: auto;
      }

      .badge {
        padding: 2px 8px;
        border-radius: 10px;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        cursor: pointer;
        user-select: none;
      }

      .motion-badge {
        background: rgba(244, 67, 54, 0.9);
        color: #fff;
        animation: pulse 1.5s ease-in-out infinite;
      }

      .quality-badge {
        background: rgba(255, 255, 255, 0.25);
        color: #fff;
        backdrop-filter: blur(4px);
      }

      @keyframes pulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.5;
        }
      }

      /* Video */
      .video-container {
        width: 100%;
        height: 100%;
        transition: transform 0.1s ease;
      }

      .video-container ha-camera-stream {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: contain;
      }

      /* Controls overlay */
      .controls-overlay {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
        padding: 12px;
        background: linear-gradient(
          to top,
          rgba(0, 0, 0, 0.6),
          transparent
        );
        z-index: 3;
      }

      .controls-left {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .control-btn {
        width: 44px;
        height: 44px;
        border-radius: 50%;
        border: none;
        background: rgba(255, 255, 255, 0.2);
        backdrop-filter: blur(4px);
        color: #fff;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s;
        -webkit-tap-highlight-color: transparent;
      }

      .control-btn:hover,
      .control-btn:active {
        background: rgba(255, 255, 255, 0.35);
      }

      .control-btn.mic-btn.active {
        background: rgba(76, 175, 80, 0.8);
        animation: micPulse 1.5s ease-in-out infinite;
      }

      .control-btn.speaker-btn.active {
        background: rgba(33, 150, 243, 0.8);
      }

      @keyframes micPulse {
        0%,
        100% {
          box-shadow: 0 0 0 0 rgba(76, 175, 80, 0.4);
        }
        50% {
          box-shadow: 0 0 0 10px rgba(76, 175, 80, 0);
        }
      }

      .talk-button-host {
        width: 48px;
        height: 48px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      /* PTZ overlay */
      .ptz-overlay {
        display: flex;
        align-items: flex-end;
        gap: 12px;
      }

      .ptz-pad {
        display: grid;
        grid-template-columns: 48px 48px 48px;
        grid-template-rows: 48px 48px 48px;
        gap: 2px;
      }

      .ptz-btn {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        border: none;
        background: rgba(255, 255, 255, 0.2);
        backdrop-filter: blur(4px);
        color: #fff;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.15s;
        -webkit-tap-highlight-color: transparent;
        touch-action: none;
      }

      .ptz-btn:hover,
      .ptz-btn:active {
        background: rgba(255, 255, 255, 0.4);
      }

      .ptz-up {
        grid-column: 2;
        grid-row: 1;
      }
      .ptz-left {
        grid-column: 1;
        grid-row: 2;
      }
      .ptz-center {
        grid-column: 2;
        grid-row: 2;
        background: rgba(255, 255, 255, 0.1);
      }
      .ptz-right {
        grid-column: 3;
        grid-row: 2;
      }
      .ptz-down {
        grid-column: 2;
        grid-row: 3;
      }

      .zoom-controls {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .error {
        padding: 16px;
        color: var(--error-color, #db4437);
      }
    `;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._stopMic();
    if (this._ptzInterval) {
      clearInterval(this._ptzInterval);
    }
  }
}

customElements.define("reolink-camera-card", ReolinkCameraCard);

class ReolinkCameraCardEditor extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      _config: { type: Object },
    };
  }

  setConfig(config) {
    this._config = config;
  }

  get _schema() {
    const cameraEntities = this.hass
      ? Object.keys(this.hass.states)
          .filter((e) => e.startsWith("camera."))
          .map((e) => ({ value: e, label: this.hass.states[e].attributes.friendly_name || e }))
      : [];

    return [
      {
        name: "entity",
        required: true,
        selector: { entity: { domain: "camera" } },
      },
      {
        name: "ptz",
        selector: { boolean: {} },
      },
      {
        name: "show_motion_indicator",
        selector: { boolean: {} },
      },
      {
        name: "show_microphone",
        selector: { boolean: {} },
      },
      {
        name: "talk_camera",
        selector: { text: {} },
      },
      {
        name: "show_audio",
        selector: { boolean: {} },
      },
      {
        name: "show_header",
        selector: { boolean: {} },
      },
      {
        name: "show_fullscreen",
        selector: { boolean: {} },
      },
    ];
  }

  render() {
    if (!this.hass || !this._config) return html``;

    const data = {
      entity: this._config.entity || "",
      ptz: this._config.ptz !== false,
      show_motion_indicator: this._config.show_motion_indicator !== false,
      show_microphone: this._config.show_microphone !== false,
      talk_camera: this._config.talk_camera || "",
      show_audio: this._config.show_audio !== false,
      show_header: this._config.show_header !== false,
      show_fullscreen: this._config.show_fullscreen !== false,
    };

    return html`
      <ha-form
        .hass=${this.hass}
        .data=${data}
        .schema=${this._schema}
        .computeLabel=${(s) => {
          const labels = {
            entity: "Camera Entity",
            ptz: "Show PTZ Controls",
            show_motion_indicator: "Show Motion Indicator",
            show_microphone: "Show Reolink Talk Microphone",
            talk_camera: "Reolink Talk Camera Slug (e.g. doorbell)",
            show_audio: "Show Audio Toggle",
            show_header: "Show Header Bar",
            show_fullscreen: "Show Fullscreen Button",
          };
          return labels[s.name] || s.name;
        }}
        @value-changed=${this._valueChanged}
      ></ha-form>
    `;
  }

  _valueChanged(ev) {
    const config = { ...this._config, ...ev.detail.value };
    this._config = config;
    const event = new CustomEvent("config-changed", {
      detail: { config },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(event);
  }
}

customElements.define("reolink-camera-card-editor", ReolinkCameraCardEditor);

})();
