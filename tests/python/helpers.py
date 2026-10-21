"""Shared by the collector tests: the fixtures folder and the scripts folder on the path."""

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.join(HERE, "..", "..")
SCRIPTS = os.path.join(SKILL, "scripts")
sys.path.insert(0, SCRIPTS)

WINDOW = ("2026-10-20", "2026-12-01")


def fixture(name):
    with open(os.path.join(HERE, "fixtures", name), "rb") as handle:
        return handle.read()
