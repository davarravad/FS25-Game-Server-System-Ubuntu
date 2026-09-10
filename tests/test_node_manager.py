import importlib.util
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import types
import unittest
from unittest.mock import patch

if sys.platform == 'win32':
    sys.modules['fcntl'] = types.SimpleNamespace()
spec = importlib.util.spec_from_file_location('node_manager', Path(__file__).resolve().parents[1]/'scripts/node-manager.py')
manager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(manager)


def archive(extra=None):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w:gz') as tar:
        for name in ['docker-compose.yml', '.env.example', 'scripts/node-manager.py']:
            info = tarfile.TarInfo(name)
            info.size = 2
            tar.addfile(info, io.BytesIO(b'ok'))
        if extra:
            tar.addfile(extra, io.BytesIO(b'x'*extra.size))
    return output.getvalue()


class NodeManagerTests(unittest.TestCase):
    def test_failed_build_restores_source_and_images_without_touching_env(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)/'node'
            root.mkdir()
            (root/'.env').write_text('original secret')
            (root/'docker-compose.yml').write_bytes(b'old compose')
            calls = []
            def compose(config, *args, **kwargs):
                calls.append(args)
                if args[0] == 'exec':
                    kwargs['stdout'].write(b'database backup')
                if args[0] == 'build':
                    raise RuntimeError('deliberate build failure')
                return types.SimpleNamespace(stdout='container-id')
            def command(args, **kwargs):
                return types.SimpleNamespace(stdout=json.dumps([{'Image':'sha256:old','Config':{'Image':'project-image'}}]))
            with patch.object(manager, 'BACKUPS', Path(tmp)/'backups'), patch.object(manager, 'compose', side_effect=compose), patch.object(manager, 'call', side_effect=command) as command_mock:
                with self.assertRaises(RuntimeError):
                    manager.apply({'root':str(root)}, 'v1.0.0', {'docker-compose.yml':(b'new compose',0o644),'scripts/new.py':(b'new',0o644)}, 'job')
                self.assertEqual((root/'docker-compose.yml').read_bytes(), b'old compose')
                self.assertFalse((root/'scripts/new.py').exists())
                self.assertEqual((root/'.env').read_text(), 'original secret')
                self.assertEqual((Path(tmp)/'backups/job/panel.sql').read_bytes(), b'database backup')
                self.assertEqual(calls[-1], ('up','-d','--no-build','--no-deps','--force-recreate','web','agent','nginx','publisher'))
                self.assertTrue(any(call.args[0] == ['docker','tag','sha256:old','project-image'] for call in command_mock.call_args_list))

    def test_archive_allowlist_and_links(self):
        self.assertEqual(len(manager.archive_files(archive())), 3)
        for name in ['../escape', '/etc/cron.d/bad', 'scripts/../../escape', '.env', 'scripts\\escape', 'docker-compose.yml']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                manager.archive_files(archive(tarfile.TarInfo(name)))
        link = tarfile.TarInfo('scripts/link')
        link.type = tarfile.SYMTYPE
        link.linkname = '/etc/passwd'
        with self.assertRaises(ValueError):
            manager.archive_files(archive(link))

    def test_paths_stay_inside_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):
                manager.safe_target(Path(tmp), '../escape')

    def test_result_retry_does_not_reapply(self):
        job = {'id': 'a'*8+'-'+'b'*4+'-'+'c'*4+'-'+'d'*4+'-'+'e'*12, 'version': 'v1.0.0'}
        calls = []
        def request(config, path, body=None):
            calls.append(path)
            if path == 'poll':
                return json.dumps({'job': job}).encode()
            if calls.count('result') == 1:
                raise OSError('lost result connection')
            return b'{}'
        with tempfile.TemporaryDirectory() as tmp, patch.object(manager, 'STATE', Path(tmp)), patch.object(manager, 'request', side_effect=request), patch.object(manager, 'download', return_value={}), patch.object(manager, 'apply') as apply:
            with self.assertRaises(OSError):
                manager.poll({})
            manager.poll({})
            apply.assert_called_once()
            self.assertEqual(json.loads((Path(tmp)/(job['id']+'.json')).read_text())['status'], 'succeeded')

    def test_interrupted_job_reports_failure(self):
        job = {'id': 'a'*8+'-'+'b'*4+'-'+'c'*4+'-'+'d'*4+'-'+'e'*12, 'version': 'v1.0.0'}
        with tempfile.TemporaryDirectory() as tmp, patch.object(manager, 'STATE', Path(tmp)), patch.object(manager, 'request', return_value=json.dumps({'job':job}).encode()) as request, patch.object(manager, 'apply') as apply:
            manager.save(Path(tmp)/(job['id']+'.json'), {'id':job['id'],'status':'applying'})
            manager.poll({})
            apply.assert_not_called()
            self.assertEqual(request.call_args.args[2]['status'], 'failed')


if __name__ == '__main__':
    unittest.main()
