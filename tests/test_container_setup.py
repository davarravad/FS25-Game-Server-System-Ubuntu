import importlib.util
import json
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('container_setup', Path(__file__).parents[1] / 'docker/agent/container_setup.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def inspect_output(running=True, networks=('fsg-management', 'fs25-001_default'), bindings=None):
    return {
        'State': {'Status': 'running' if running else 'exited', 'Running': running},
        'NetworkSettings': {'Networks': {name: {} for name in networks}},
        'HostConfig': {'PortBindings': bindings if bindings is not None else {
            '5900/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '5901'}],
            '6080/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '6081'}],
            '18000/tcp': [{'HostIp': '', 'HostPort': '18000'}],
            '28000/tcp': [{'HostIp': '', 'HostPort': '28000'}],
            '10823/tcp': [{'HostIp': '', 'HostPort': '10823'}],
            '10823/udp': [{'HostIp': '', 'HostPort': '10823'}],
        }},
    }


class ContainerSetupTests(unittest.TestCase):
    def test_central_mode_container_passes(self):
        summary = module.summarize(inspect_output(), 'fs25-001')
        self.assertTrue(summary['exists'])
        self.assertTrue(summary['running'])
        self.assertTrue(summary['management_network'])
        self.assertTrue(summary['admin_ports_loopback'])
        self.assertEqual(summary['exposed_admin_ports'], [])

    def test_public_admin_ports_and_missing_network_are_reported(self):
        summary = module.summarize(inspect_output(running=False, networks=('fs25-001_default',), bindings={
            '5900/tcp': [{'HostIp': '0.0.0.0', 'HostPort': '5901'}],
            '6080/tcp': [{'HostIp': '', 'HostPort': '6081'}],
            '18000/tcp': [{'HostIp': '', 'HostPort': '18000'}],
            '10823/tcp': [{'HostIp': '', 'HostPort': '10823'}],
        }), 'fs25-001')
        self.assertFalse(summary['running'])
        self.assertEqual(summary['status'], 'exited')
        self.assertFalse(summary['management_network'])
        self.assertFalse(summary['admin_ports_loopback'])
        self.assertEqual(summary['exposed_admin_ports'], ['0.0.0.0:5901->5900/tcp', '0.0.0.0:6081->6080/tcp'])

    def test_missing_or_malformed_container_is_safe(self):
        self.assertEqual(module.summarize(None, 'gone')['status'], 'missing')
        self.assertFalse(module.summarize({}, 'gone')['exists'])
        calls = []

        def run_command(cmd, timeout=None):
            calls.append((cmd, timeout))
            return {'code': 1, 'stdout': '', 'stderr': 'No such object'}

        self.assertFalse(module.inspect_setup(run_command, 'gone')['exists'])
        self.assertEqual(calls[0][0][:2], ['docker', 'inspect'])
        self.assertEqual(module.inspect_setup(lambda cmd, timeout=None: {'code': 0, 'stdout': 'not json'}, 'x')['exists'], False)
        good = module.inspect_setup(lambda cmd, timeout=None: {'code': 0, 'stdout': json.dumps(inspect_output())}, 'fs25-001')
        self.assertTrue(good['management_network'])


if __name__ == '__main__':
    unittest.main()
