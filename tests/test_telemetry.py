import importlib.util
import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('telemetry', Path(__file__).parents[1] / 'docker/agent/telemetry.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class TelemetryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.store = module.Telemetry(self.base, None, None)

    def test_history_survives_restart_and_scopes_are_isolated(self):
        self.store.save('host', {'cpu_percent': 12})
        self.store.save('server1', {'cpu_percent': 80})
        restarted = module.Telemetry(self.base, None, None)
        self.assertEqual(restarted.latest('host')['latest']['cpu_percent'], 12)
        self.assertEqual(restarted.read('server1', 1)['points'][0]['cpu_percent'], 80)
        self.assertIsNone(restarted.latest('missing')['latest'])

    def test_long_range_bounded_and_missing_values_not_zero_filled(self):
        now = int(time.time())
        with self.store.connect() as conn:
            conn.executemany('INSERT INTO samples VALUES (?, ?, ?)', [
                ('host', now-i*30, json.dumps({'cpu_percent': 50 if i%2 else None})) for i in range(4000)
            ])
        result = self.store.read('host', 24)
        self.assertLessEqual(len(result['points']), 361)
        self.assertTrue(all(point['timestamp'] >= now-86400 for point in result['points']))
        self.assertTrue(all(point['cpu_percent'] in (None, 50) for point in result['points']))

    def test_network_counter_reset_does_not_make_negative_rates(self):
        readings = iter([{'network_in_bytes': 100, 'network_out_bytes': 200},
                         {'network_in_bytes': 300, 'network_out_bytes': 600},
                         {'network_in_bytes': 10, 'network_out_bytes': 20}])
        self.store.collect_instance = lambda *_: {'ok': True, 'metrics': next(readings)}
        with patch.object(module.time, 'monotonic', side_effect=[10, 20, 30]):
            self.store.sample_instance('server1', '')
            self.assertIsNone(self.store.latest('server1')['latest']['network_in_bytes_sec'])
            self.store.sample_instance('server1', '')
            self.assertEqual(self.store.latest('server1')['latest']['network_in_bytes_sec'], 20)
            self.store.sample_instance('server1', '')
            self.assertIsNone(self.store.latest('server1')['latest']['network_in_bytes_sec'])

    def test_host_cpu_uses_deltas_and_first_sample_is_unknown(self):
        proc = self.base / 'proc'
        (proc / '1/net').mkdir(parents=True)
        (proc / 'stat').write_text('cpu 100 0 100 800 0 0 0 0\n')
        (proc / 'meminfo').write_text('MemTotal: 1000 kB\nMemAvailable: 400 kB\n')
        (proc / 'uptime').write_text('120 0')
        (proc / '1/net/dev').write_text('header\nheader\n eth0: 1000 0 0 0 0 0 0 0 2000 0 0 0 0 0 0 0\n')
        class FS:
            f_blocks = 100
            f_bfree = 20
            f_frsize = 1024
        with patch.dict(module.os.environ, {'HOST_PROC_PATH': str(proc)}), patch.object(module.os, 'statvfs', return_value=FS(), create=True):
            first = self.store.host()
            self.assertIsNone(first['cpu_percent'])
            self.assertEqual(first['memory_used_bytes'], 600*1024)
            (proc / 'stat').write_text('cpu 150 0 100 850 0 0 0 0\n')
            second = self.store.host()
            self.assertEqual(second['cpu_percent'], 50)
            self.assertEqual(second['disk_used_bytes'], 80*1024)
            (proc / '1/net/dev').unlink()
            self.assertIsNone(self.store.host()['network_in_bytes_sec'])


if __name__ == '__main__':
    unittest.main()
