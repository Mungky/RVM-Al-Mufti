"""Compile and test the exact flow embedded in the standalone production sketch."""
from pathlib import Path
import subprocess
import tempfile
root = Path(__file__).resolve().parents[2]
source = (root / 'firmware/arduino/rvm_production/rvm_production.ino').read_text()
flow = source.split('// BEGIN PRODUCTION FLOW\n', 1)[1].split('// END PRODUCTION FLOW', 1)[0]
with tempfile.TemporaryDirectory(prefix='rvm-production-tests-') as work:
    folder = Path(work)
    (folder / 'production-flow-under-test.h').write_text(flow)
    binary = folder / 'flow-test'
    subprocess.run(['g++', '-std=c++11', '-Wall', '-Wextra', '-Werror',
                    '-I', work, str(root / 'scripts/production/flow-test.cpp'),
                    '-o', str(binary)], check=True)
    subprocess.run([str(binary)], check=True)

    # Exercise the exact ISR/start/stop and production movement wiring with fake GPIO/timer.
    config = source.split('constexpr uint32_t PRODUCTION_SPEED', 1)[1].split('void applyProduction();', 1)[0]
    variables = source.split('bool relayOn[2]', 1)[1].split('bool loadcellReady', 1)[0]
    motor = source.split('bool motorMoving()', 1)[1].split('void pollIR()', 1)[0]
    actions = source.split('void applyProduction() {', 1)[1].split('void updateProduction()', 1)[0]
    (folder / 'motor-under-test.h').write_text(
        'constexpr uint32_t PRODUCTION_SPEED' + config +
        'bool relayOn[2]' + variables +
        'bool motorMoving()' + motor +
        'void applyProduction() {' + actions)
    subprocess.run(['g++', '-std=c++11', '-Wall', '-Wextra', '-Werror',
                    '-I', work, str(root / 'scripts/production/motor-test.cpp'),
                    '-o', str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
