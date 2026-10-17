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
    def test_env_values_with_a_dollar_sign_are_quoted_so_compose_keeps_them_literal(self):
        password = 'E$YCRp1l6yc*cGWUT9JL'
        written = module.env_file_value(password)
        self.assertEqual(written, "'" + password + "'")
        self.assertEqual(module.env_file_read(written), password, 'Reading the file back returns the original password')
        for plain in ('changeme', 'Riverbend Springs', 'a#b&c*d', '10823', ''):
            self.assertEqual(module.env_file_value(plain), plain, 'Values without a dollar sign are written exactly as before')
            self.assertEqual(module.env_file_read(plain), plain)
        self.assertEqual(module.env_file_read("  'x$y'  "), 'x$y')
        self.assertEqual(module.env_file_read("'"), "'", 'A lone quote is not a quoted value')
        with self.assertRaises(ValueError):
            module.env_file_value("it's $5")
        with self.assertRaises(ValueError):
            module.env_file_value("a$b" + chr(10) + "c")

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


class AdminSftpReportTests(unittest.TestCase):
    def summary(self, running=True, host_ip='127.0.0.1', exists=True):
        return {'exists': exists, 'name': 'fsg-panel-admin-sftp', 'running': running, 'status': 'running' if running else 'exited',
                'ports': {'22/tcp': [{'host_ip': host_ip, 'host_port': '22220'}]} if exists else {}}

    def test_loopback_only_node_is_ready_but_needs_a_tunnel(self):
        report = module.admin_sftp_report(self.summary(), 'SSH-2.0-OpenSSH_9.6', {(22220, 'tcp')})
        self.assertEqual(report['state'], 'ready')
        self.assertTrue(report['loopback_only'])
        self.assertEqual(report['port'], 22220)
        self.assertTrue(report['answering'])

    def test_public_binding_reports_firewall(self):
        closed = module.admin_sftp_report(self.summary(host_ip='0.0.0.0'), 'SSH-2.0-OpenSSH_9.6', {(22, 'tcp')})
        self.assertFalse(closed['loopback_only'])
        self.assertFalse(closed['firewall_open'])
        self.assertIsNone(module.admin_sftp_report(self.summary(host_ip='0.0.0.0'), 'SSH-2.0-x', None)['firewall_open'])

    def test_stopped_missing_and_silent_states(self):
        self.assertEqual(module.admin_sftp_report(self.summary(running=False), '', None)['state'], 'stopped')
        self.assertEqual(module.admin_sftp_report(self.summary(exists=False), '', None)['state'], 'missing')
        self.assertEqual(module.admin_sftp_report(self.summary(), '', None)['state'], 'not-answering')
        self.assertEqual(module.admin_sftp_report(self.summary(), 'garbage', None)['state'], 'not-answering')


class AdminSftpAccessTests(unittest.TestCase):
    def test_set_env_value_replaces_or_appends(self):
        self.assertEqual(module.set_env_value('A=1\nADMIN_SFTP_BIND_ADDRESS=127.0.0.1\nB=2\n', 'ADMIN_SFTP_BIND_ADDRESS', '0.0.0.0'), 'A=1\nADMIN_SFTP_BIND_ADDRESS=0.0.0.0\nB=2\n')
        self.assertEqual(module.set_env_value('A=1', 'ADMIN_SFTP_BIND_ADDRESS', '127.0.0.1'), 'A=1\nADMIN_SFTP_BIND_ADDRESS=127.0.0.1\n')
        self.assertEqual(module.set_env_value('# ADMIN_SFTP_BIND_ADDRESS=x\nA=1\n', 'ADMIN_SFTP_BIND_ADDRESS', '0.0.0.0'), '# ADMIN_SFTP_BIND_ADDRESS=x\nA=1\nADMIN_SFTP_BIND_ADDRESS=0.0.0.0\n')

    def test_compose_target_only_accepts_projects_under_opt(self):
        good = {'com.docker.compose.project': 'farmservers', 'com.docker.compose.project.working_dir': '/opt/farmservers/node', 'com.docker.compose.project.config_files': '/opt/farmservers/node/docker-compose.yml'}
        self.assertEqual(module.compose_target(good), {'project': 'farmservers', 'workdir': '/opt/farmservers/node', 'config': '/opt/farmservers/node/docker-compose.yml'})
        self.assertIsNone(module.compose_target({**good, 'com.docker.compose.project.working_dir': '/etc'}))
        self.assertIsNone(module.compose_target({**good, 'com.docker.compose.project.working_dir': '/opt/../etc'}))
        self.assertIsNone(module.compose_target({**good, 'com.docker.compose.project.config_files': '/tmp/evil.yml'}))
        self.assertIsNone(module.compose_target({**good, 'com.docker.compose.project': 'Bad Name'}))
        self.assertIsNone(module.compose_target({}))

    def test_report_names_the_access_mode(self):
        summary = {'exists': True, 'name': 'x', 'running': True, 'status': 'running', 'ports': {'22/tcp': [{'host_ip': '0.0.0.0', 'host_port': '22220'}]}}
        self.assertEqual(module.admin_sftp_report(summary, 'SSH-2.0', None)['access_mode'], 'public')


class RuntimeImageFreshnessTests(unittest.TestCase):
    def make_tree(self, files):
        import tempfile
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        root = Path(folder.name)
        for name, content in files.items():
            target = root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
        return root

    def test_fingerprint_changes_with_content_and_ignores_line_endings_and_caches(self):
        base = self.make_tree({'Dockerfile': b'FROM x\n', 'run/start.sh': b'echo hi\n'})
        same_with_crlf = self.make_tree({'Dockerfile': b'FROM x\r\n', 'run/start.sh': b'echo hi\r\n'})
        with_cache = self.make_tree({'Dockerfile': b'FROM x\n', 'run/start.sh': b'echo hi\n', 'run/__pycache__/x.pyc': b'junk'})
        edited = self.make_tree({'Dockerfile': b'FROM x\n', 'run/start.sh': b'echo changed\n'})
        renamed = self.make_tree({'Dockerfile': b'FROM x\n', 'run/other.sh': b'echo hi\n'})
        fingerprint = module.source_tree_hash(base)
        self.assertEqual(fingerprint, module.source_tree_hash(same_with_crlf))
        self.assertEqual(fingerprint, module.source_tree_hash(with_cache))
        self.assertNotEqual(fingerprint, module.source_tree_hash(edited))
        self.assertNotEqual(fingerprint, module.source_tree_hash(renamed))

    def test_only_a_fingerprinted_image_that_no_longer_matches_is_stale(self):
        self.assertTrue(module.image_is_stale('old', 'new'))
        self.assertFalse(module.image_is_stale('same', 'same'))
        # Built before fingerprints existed: never rebuilt by surprise.
        self.assertFalse(module.image_is_stale('', 'new'))
        # No image at all is the first-start build, handled separately.
        self.assertFalse(module.image_is_stale(None, 'new'))


if __name__ == '__main__':
    unittest.main()
