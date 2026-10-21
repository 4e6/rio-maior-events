# Writes the fixture collected folder, then exits non-zero as collect.py does for some failures.
import shutil, sys, os
shutil.copytree(os.path.join(os.path.dirname(__file__), "collected"), sys.argv[1], dirs_exist_ok=True)
sys.exit(3)
