"""재현성: 동일 config + 동일 시드 → 동일 결과(bit-identical)."""
import os

import numpy as np

from engine.config import SimConfig
from engine.simulator import Simulator

SAMPLE = os.path.join(os.path.dirname(__file__), "..", "examples", "sample_station.json")


def load_sample():
    with open(SAMPLE, encoding="utf-8") as f:
        return SimConfig.from_json(f.read())


def test_identical_runs():
    r1 = Simulator(load_sample()).run().count.copy()
    r2 = Simulator(load_sample()).run().count
    assert np.array_equal(r1, r2)


def test_seed_changes_output():
    cfg = load_sample()
    r1 = Simulator(cfg).run().count.copy()
    cfg2 = load_sample()
    cfg2.seed = 12345
    r2 = Simulator(cfg2).run().count
    assert not np.array_equal(r1, r2)
