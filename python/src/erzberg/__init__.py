"""Render erzberg plates from Python, through the erzberg command-line tool.

There is no second renderer here. Every call builds the arguments for
``scripts/erzberg.js`` and runs it with Node, so a plate looks exactly as it
does in the app.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Iterable, Mapping, Optional, Sequence, Union

__all__ = ["Plate", "ErzbergError", "render", "atlas", "presets", "modes", "cli_command"]
__version__ = "0.1.0"

PathLike = Union[str, os.PathLike]


class ErzbergError(RuntimeError):
    """The tool failed. ``code`` is its exit code: 1 error, 2 bad arguments, 3 nothing to draw."""

    def __init__(self, message: str, code: int):
        super().__init__(message)
        self.code = code


def cli_command() -> list:
    """The command that runs the tool, as a list for ``subprocess``."""
    env = os.environ.get("ERZBERG_CLI")
    if env:
        return ["node", env] if env.endswith(".js") else [env]
    # The repository this package sits in: python/src/erzberg/__init__.py.
    script = Path(__file__).resolve().parents[3] / "scripts" / "erzberg.js"
    if script.is_file():
        return ["node", str(script)]
    found = shutil.which("erzberg")
    if found:
        return [found]
    raise ErzbergError("erzberg not found: set ERZBERG_CLI to scripts/erzberg.js", 1)


def _run(args: Sequence[str], timeout: Optional[float] = None) -> str:
    proc = subprocess.run(cli_command() + list(args), capture_output=True, text=True,
                          timeout=None if timeout is None else timeout + 60)
    if proc.returncode != 0:
        msg = (proc.stderr or proc.stdout).strip().splitlines()
        raise ErzbergError(msg[-1] if msg else f"erzberg exited with {proc.returncode}", proc.returncode)
    return proc.stdout


def _value(v) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    return str(v)


def _options(preset=None, modes=None, only=False, set=None, size=None, frame=None,
             pen_order=False, alpha=False, stats=False, timeout=None) -> list:
    """The shared render options, in the tool's own spelling."""
    a = []
    if preset is not None:
        a += ["-p", str(preset)]
    if modes:
        a += ["-m", modes if isinstance(modes, str) else ",".join(modes)]
    if only:
        a.append("--only")
    for k, v in (set or {}).items():
        a += ["-s", f"{k}={_value(v)}"]
    if size is not None:
        a += ["--size", size if isinstance(size, str) else f"{size[0]}x{size[1]}"]
    if frame:
        a += ["--frame", str(frame)]
    if pen_order:
        a.append("--pen-order")
    if alpha:
        a.append("--alpha")
    if stats:
        a.append("--stats")
    if timeout is not None:
        a += ["--timeout", str(int(timeout))]
    return a + ["-q"]


class Plate:
    """One rendered plate. A notebook shows it as its PNG."""

    def __init__(self, heightmap: PathLike, options: list, files: list, stats=None, timeout=None):
        self.heightmap = Path(heightmap)
        self.files = [Path(f) for f in files]
        self.stats = stats
        self._options = options
        self._timeout = timeout

    @property
    def path(self) -> Optional[Path]:
        """The first PNG this plate wrote, if any."""
        return next((f for f in self.files if f.suffix.lower() == ".png"), None)

    def png(self) -> bytes:
        """The PNG bytes. Renders a PNG first if the plate wrote none."""
        if self.path is None:
            self.save(Path(tempfile.mkdtemp(prefix="erzberg-")) / "plate.png")
        return self.path.read_bytes()

    def save(self, *out: PathLike) -> "Plate":
        """Render the same plate again into these files (.svg, .png or .stl)."""
        args = ["render", str(self.heightmap)]
        for f in out:
            args += ["-o", str(f)]
        _run(args + [o for o in self._options if o != "--stats"], self._timeout)
        self.files += [Path(f) for f in out]
        return self

    def _repr_png_(self):
        return self.png()

    def __repr__(self):
        return f"Plate({str(self.heightmap)!r}, files={[str(f) for f in self.files]})"


def render(heightmap: PathLike, out: Union[None, PathLike, Iterable[PathLike]] = None, *,
           preset: Optional[str] = None, modes: Union[None, str, Sequence[str]] = None,
           only: bool = False, set: Optional[Mapping[str, object]] = None,
           size=None, frame: Optional[str] = None, pen_order: bool = False,
           alpha: bool = False, stats: bool = False, timeout: Optional[float] = None) -> Plate:
    """Render a heightmap (PNG or GeoTIFF). Without ``out``, writes a PNG to a temporary folder."""
    if out is None:
        outs = [Path(tempfile.mkdtemp(prefix="erzberg-")) / "plate.png"]
    elif isinstance(out, (str, os.PathLike)):
        outs = [Path(out)]
    else:
        outs = [Path(o) for o in out]
    opts = _options(preset, modes, only, set, size, frame, pen_order, alpha, stats, timeout)
    args = ["render", str(heightmap)]
    for f in outs:
        args += ["-o", str(f)]
    text = _run(args + opts, timeout)
    figures = json.loads(text) if stats and text.strip() else None
    return Plate(heightmap, [o for o in opts if o != "--stats"], outs, figures, timeout)


def atlas(features: PathLike, out: Union[PathLike, Iterable[PathLike]], *, dem: Optional[PathLike] = None,
          box: Optional[float] = None, **options) -> list:
    """Run ``erzberg atlas``. Each ``out`` must hold ``{name}``. Returns one record per sheet."""
    outs = [out] if isinstance(out, (str, os.PathLike)) else list(out)
    args = ["atlas", str(features)]
    for f in outs:
        args += ["-o", str(f)]
    if dem is not None:
        args += ["--dem", str(dem)]
    if box is not None:
        args += ["--box", str(box)]
    opts = _options(stats=True, **options)
    text = _run(args + opts, options.get("timeout"))
    return [json.loads(line) for line in text.splitlines() if line.strip().startswith("{")]


def presets() -> list:
    """The bundled preset names."""
    return [line.strip() for line in _run(["list", "presets"]).splitlines() if line.strip()]


def modes() -> dict:
    """Every draw mode, as {id: label}."""
    out = {}
    for line in _run(["list", "modes"]).splitlines():
        parts = line.split(None, 1)
        if parts:
            out[parts[0]] = parts[1].strip() if len(parts) > 1 else parts[0]
    return out
