import json
import os
from pathlib import Path

import pytest

import erzberg


class Proc:
    def __init__(self, out="", code=0, err=""):
        self.stdout, self.returncode, self.stderr = out, code, err


@pytest.fixture
def calls(monkeypatch):
    seen = []

    def fake(cmd, **kw):
        seen.append(cmd)
        if "--stats" in cmd:
            return Proc(json.dumps({"strokes": 12}))
        if cmd[-2:] == ["list", "modes"]:
            return Proc("Lines         Lines\nContours      Contours\n")
        if cmd[-2:] == ["list", "presets"]:
            return Proc("First Light\nBlueprint\n")
        return Proc()

    monkeypatch.setattr(erzberg.subprocess, "run", fake)
    monkeypatch.setenv("ERZBERG_CLI", "/x/scripts/erzberg.js")
    return seen


def test_render_builds_the_tool_arguments(calls, tmp_path):
    out = tmp_path / "a.svg"
    plate = erzberg.render("dem.tif", out, preset="Blueprint", modes=["Lines", "Contours"], only=True,
                           set={"intervalContours": 6, "showFrame": True}, size=(800, 600), frame="iso")
    cmd = calls[0]
    assert cmd[:4] == ["node", "/x/scripts/erzberg.js", "render", "dem.tif"]
    assert ["-o", str(out)] == cmd[4:6]
    pairs = list(zip(cmd, cmd[1:]))
    for a in (("-p", "Blueprint"), ("-m", "Lines,Contours"), ("-s", "intervalContours=6"),
              ("-s", "showFrame=true"), ("--size", "800x600"), ("--frame", "iso")):
        assert a in pairs, a
    assert "--only" in cmd and cmd[-1] == "-q"
    assert plate.files == [out]


def test_stats_come_back_parsed(calls):
    plate = erzberg.render("dem.png", "a.png", stats=True)
    assert plate.stats == {"strokes": 12}


def test_without_out_a_png_goes_to_a_temporary_folder(calls):
    plate = erzberg.render("dem.png")
    assert plate.path.name == "plate.png"


def test_save_renders_again_without_stats(calls):
    plate = erzberg.render("dem.png", "a.png", stats=True)
    plate.save("b.svg")
    assert "--stats" not in calls[-1] and ["-o", "b.svg"] == calls[-1][4:6]


def test_lists(calls):
    assert erzberg.presets() == ["First Light", "Blueprint"]
    assert erzberg.modes() == {"Lines": "Lines", "Contours": "Contours"}


def test_a_failure_raises_with_the_exit_code(monkeypatch):
    monkeypatch.setenv("ERZBERG_CLI", "/x/scripts/erzberg.js")
    monkeypatch.setattr(erzberg.subprocess, "run", lambda cmd, **kw: Proc(code=3, err="nothing to draw"))
    with pytest.raises(erzberg.ErzbergError) as e:
        erzberg.render("dem.png", "a.png")
    assert e.value.code == 3 and "nothing to draw" in str(e.value)


def test_the_repository_script_is_found(monkeypatch):
    monkeypatch.delenv("ERZBERG_CLI", raising=False)
    cmd = erzberg.cli_command()
    assert cmd[0] == "node" and Path(cmd[1]).name == "erzberg.js"


@pytest.mark.skipif(not os.environ.get("ERZBERG_E2E"), reason="set ERZBERG_E2E=1 to drive the real tool")
def test_a_real_render(tmp_path):
    root = Path(__file__).resolve().parents[2]
    plate = erzberg.render(root / "public" / "Heightmap.png", tmp_path / "p.png", preset="Blueprint", size=(400, 300))
    assert plate.png()[:8] == b"\x89PNG\r\n\x1a\n"
