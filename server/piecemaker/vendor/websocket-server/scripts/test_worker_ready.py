import subprocess
import sys
import time
import unittest

import convert_and_scan_pipeline as pipeline


CHILD_SOURCE = "import sys, time\nprint('READY', flush=True)\ntime.sleep(10)\n"


class WorkerReadyTests(unittest.TestCase):
    def test_ready_line_detected_within_one_second(self):
        proc = subprocess.Popen(
            [sys.executable, "-c", CHILD_SOURCE],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        try:
            started = time.time()
            ready = pipeline.wait_for_worker_ready(proc, {"total": 0, "offset": 0}, timeout=1)
            elapsed = time.time() - started
        finally:
            proc.kill()
            proc.wait(timeout=5)
            proc.stdin.close()
            proc.stdout.close()
            proc.stderr.close()
        self.assertTrue(ready)
        self.assertLess(elapsed, 1)


if __name__ == "__main__":
    unittest.main()
