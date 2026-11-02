"""Select platform for Reolink NVR (stream quality, PTZ presets)."""

from __future__ import annotations

import logging

from homeassistant.components.select import SelectEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.dispatcher import async_dispatcher_send

from .const import DEFAULT_STREAM, DOMAIN, STREAM_OPTIONS
from .coordinator import ReolinkNvrCoordinator
from .entity import ReolinkNvrEntity

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up Reolink NVR select entities."""
    coordinator: ReolinkNvrCoordinator = hass.data[DOMAIN][entry.entry_id]

    entities: list[SelectEntity] = []
    if coordinator.data:
        for channel, channel_data in coordinator.data.items():
            # Stream quality select for every channel
            entities.append(ReolinkStreamQualitySelect(coordinator, channel))

            # PTZ preset select only for PTZ-capable cameras
            if channel_data.get("ptz_supported"):
                entities.append(ReolinkPtzPresetSelect(coordinator, channel))

    async_add_entities(entities)


class ReolinkStreamQualitySelect(ReolinkNvrEntity, SelectEntity):
    """Select entity for camera stream quality (sub/main)."""

    _attr_translation_key = "stream_quality"
    _attr_icon = "mdi:video-switch"
    _attr_options = STREAM_OPTIONS

    def __init__(
        self,
        coordinator: ReolinkNvrCoordinator,
        channel: int,
    ) -> None:
        """Initialize the stream quality select."""
        super().__init__(coordinator, channel)
        self._attr_unique_id = f"{coordinator.nvr_serial}_{channel}_stream_quality"
        self._current_option = coordinator.config_entry.options.get(
            "stream_default", DEFAULT_STREAM
        )

    @property
    def current_option(self) -> str:
        """Return the current stream quality."""
        return self._current_option

    async def async_select_option(self, option: str) -> None:
        """Change the stream quality."""
        self._current_option = option

        # Notify the matching camera entity directly. HomeAssistant has no
        # `hass.helpers` attribute, and the old event had no listener.
        signal = (
            f"{DOMAIN}_stream_quality_"
            f"{self.coordinator.config_entry.entry_id}_{self._channel}"
        )
        async_dispatcher_send(self.hass, signal, option)

        self.async_write_ha_state()


class ReolinkPtzPresetSelect(ReolinkNvrEntity, SelectEntity):
    """Select entity for PTZ presets."""

    _attr_translation_key = "ptz_preset"
    _attr_icon = "mdi:crosshairs-gps"

    def __init__(
        self,
        coordinator: ReolinkNvrCoordinator,
        channel: int,
    ) -> None:
        """Initialize the PTZ preset select."""
        super().__init__(coordinator, channel)
        self._attr_unique_id = f"{coordinator.nvr_serial}_{channel}_ptz_preset"
        self._presets: dict[str, int] = {}
        self._current_option: str | None = None
        self._load_presets()

    def _load_presets(self) -> None:
        """Load available PTZ presets from the API."""
        ch_info = self.coordinator.api.channels.get(self._channel)
        if ch_info and ch_info.ptz_presets:
            self._presets = {
                name: idx
                for idx, name in ch_info.ptz_presets.items()
                if name  # skip empty names
            }
        if not self._presets:
            self._presets = {f"Preset {i}": i for i in range(1, 9)}

    @property
    def options(self) -> list[str]:
        """Return available preset options."""
        return list(self._presets.keys()) if self._presets else ["Preset 1"]

    @property
    def current_option(self) -> str | None:
        """Return the current preset."""
        return self._current_option

    async def async_select_option(self, option: str) -> None:
        """Move to the selected PTZ preset."""
        preset_id = self._presets.get(option)
        if preset_id is None:
            return

        try:
            await self.coordinator.api.set_ptz_command(
                self._channel, "ToPos", preset=preset_id
            )
            self._current_option = option
        except Exception:
            _LOGGER.error(
                "Error moving to PTZ preset %s on channel %d",
                option,
                self._channel,
                exc_info=True,
            )

        self.async_write_ha_state()
