"""Experimental PCM16 talkback transport using the official Reolink CLI.

This module is deliberately *not* exposed as a Home Assistant service yet.
It requires a local reolink-cli binary, registered camera alias and gateway.
A future authenticated HA WebSocket handler will own one instance per talk session.

The vendor's CLI binary is proprietary and must be installed separately.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from pathlib import Path

PCM_SAMPLE_RATE = 16000
PCM_CHANNELS = 1
PCM_BYTES_PER_SAMPLE = 2
MAX_CHUNK_BYTES = 32000  # No more than one second of PCM16 mono at 16 kHz.


class TalkbackError(RuntimeError):
    """Raised when a talkback transport cannot start or stops unexpectedly."""


class ReolinkCliTalkback:
    """Feed a single talkback session with raw PCM16 LE audio from a caller.

    The caller must downsample/encode browser microphone audio to 16 kHz,
    mono, signed 16-bit little-endian PCM and supply chunks in real time.
    This transport does not capture microphones, transcode or open sockets.
    """

    def __init__(
        self,
        *,
        binary: str | Path,
        camera_alias: str,
        gateway_addr: str = "127.0.0.1:9000",
    ) -> None:
        if not camera_alias or any(ch.isspace() for ch in camera_alias):
            raise ValueError("A nonempty, whitespace-free camera alias is required")
        self._binary = str(binary)
        self._camera_alias = camera_alias
        self._gateway_addr = gateway_addr
        self._process: asyncio.subprocess.Process | None = None
        self._lock = asyncio.Lock()

    @property
    def active(self) -> bool:
        """Whether a CLI process is running for this talk session."""
        return self._process is not None and self._process.returncode is None

    async def start(self) -> None:
        """Open a stdin-driven CLI talkback process (one active session)."""
        async with self._lock:
            if self._process is not None:
                raise TalkbackError("Talkback session has already been started")
            try:
                self._process = await asyncio.create_subprocess_exec(
                    self._binary,
                    "--gateway-addr",
                    self._gateway_addr,
                    "--camera",
                    self._camera_alias,
                    "audio",
                    "talk",
                    "--stdin",
                    "--sample-rate",
                    str(PCM_SAMPLE_RATE),
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
            except OSError as err:
                raise TalkbackError("Cannot launch the Reolink CLI binary") from err

    async def write(self, pcm_chunk: bytes) -> None:
        """Send a frame; reject wrong-sized/oversized PCM data."""
        if not pcm_chunk or len(pcm_chunk) % PCM_BYTES_PER_SAMPLE:
            raise ValueError("PCM16 frames must contain an even number of bytes")
        if len(pcm_chunk) > MAX_CHUNK_BYTES:
            raise ValueError("PCM chunk exceeds the one-second safety limit")
        process = self._process
        if process is None or process.stdin is None or process.returncode is not None:
            raise TalkbackError("No active talkback session")
        try:
            process.stdin.write(pcm_chunk)
            await process.stdin.drain()
        except (BrokenPipeError, ConnectionResetError) as err:
            raise TalkbackError("Reolink CLI closed the audio input") from err

    async def stop(self, *, timeout: float = 5.0) -> tuple[int, bytes, bytes]:
        """Close audio input, collect command result, kill if it hangs.

        No microphone bytes are persisted to disk by this transport.
        """
        async with self._lock:
            process = self._process
            if process is None:
                raise TalkbackError("Talkback session has not started")
            self._process = None
            if process.stdin is not None and not process.stdin.is_closing():
                process.stdin.close()
            try:
                stdout, stderr = await asyncio.wait_for(process.communicate(), timeout)
            except asyncio.TimeoutError:
                process.kill()
                stdout, stderr = await process.communicate()
                raise TalkbackError("Reolink CLI did not stop before timeout")
            return process.returncode or 0, stdout, stderr

    async def cancel(self) -> None:
        """Force cleanup on browser disconnect or Home Assistant unload."""
        async with self._lock:
            process = self._process
            self._process = None
            if process is not None and process.returncode is None:
                process.kill()
                await process.communicate()
