"""Base entity for Reolink NVR integration."""

from __future__ import annotations

from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import ReolinkNvrCoordinator


class ReolinkNvrEntity(CoordinatorEntity[ReolinkNvrCoordinator]):
    """Base class for Reolink NVR entities."""

    _attr_has_entity_name = True

    def __init__(
        self,
        coordinator: ReolinkNvrCoordinator,
        channel: int,
    ) -> None:
        """Initialize the entity."""
        super().__init__(coordinator)
        self._channel = channel
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, f"{coordinator.nvr_serial}_{channel}")},
            name=self._channel_name,
            manufacturer="Reolink",
            model=self._channel_model,
            # Do not use deprecated via_device. The parent NVR association
            # can be restored using its registered device ID in a later change.
        )

    @property
    def _channel_name(self) -> str:
        """Return the camera name for this channel."""
        data = self.coordinator.data
        if data and self._channel in data:
            return data[self._channel].get("name", f"Channel {self._channel}")
        return f"Channel {self._channel}"

    @property
    def _channel_model(self) -> str | None:
        """Return the camera model for this channel."""
        data = self.coordinator.data
        if data and self._channel in data:
            return data[self._channel].get("model")
        return None

    @property
    def available(self) -> bool:
        """Return True if entity is available."""
        if not super().available:
            return False
        data = self.coordinator.data
        if data is None or self._channel not in data:
            return False
        return data[self._channel].get("online", False)


class ReolinkNvrNvrEntity(CoordinatorEntity[ReolinkNvrCoordinator]):
    """Base class for NVR-level entities (not per-channel)."""

    _attr_has_entity_name = True

    def __init__(self, coordinator: ReolinkNvrCoordinator) -> None:
        """Initialize the NVR entity."""
        super().__init__(coordinator)
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, coordinator.nvr_serial)},
            name=coordinator.nvr_name,
            manufacturer="Reolink",
            model=coordinator.nvr_model,
            sw_version=coordinator.nvr_sw_version,
        )
