import importlib.util
import os
import tempfile
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('updater_cleanup', Path(__file__).parents[1] / 'docker/agent/updater_cleanup.py')
cleanup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cleanup)


class ClearUpdaterFolderTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.instance = Path(self.tmp.name)
        self.profile = self.instance / 'data/config/FarmingSimulator2025'
        self.updater = self.profile / 'updater'

    def test_empties_the_updater_folder_but_keeps_the_folder(self):
        (self.updater / 'patch/nested').mkdir(parents=True)
        (self.updater / 'download.part').write_bytes(b'12345')
        (self.updater / 'patch/nested/data.gdp').write_bytes(b'1234567')
        result = cleanup.clear_updater_folder(self.instance)
        self.assertEqual(result, {'ok': True, 'removed_items': 2, 'removed_bytes': 12})
        self.assertTrue(self.updater.is_dir())
        self.assertEqual(list(self.updater.iterdir()), [])

    def test_leaves_the_rest_of_the_profile_alone(self):
        self.updater.mkdir(parents=True)
        (self.updater / 'junk.bin').write_bytes(b'x')
        (self.profile / 'mods').mkdir()
        (self.profile / 'mods/keep.zip').write_bytes(b'mod')
        (self.profile / 'VERSION').write_text('1.0.0.0')
        cleanup.clear_updater_folder(self.instance)
        self.assertTrue((self.profile / 'mods/keep.zip').exists())
        self.assertTrue((self.profile / 'VERSION').exists())

    def test_missing_updater_folder_is_not_an_error(self):
        self.profile.mkdir(parents=True)
        result = cleanup.clear_updater_folder(self.instance)
        self.assertTrue(result['ok'])
        self.assertEqual(result['removed_items'], 0)
        self.assertFalse(self.updater.exists())

    @unittest.skipUnless(hasattr(os, 'symlink'), 'symlinks unavailable')
    def test_symlinks_are_unlinked_never_followed(self):
        outside = self.instance / 'outside'
        outside.mkdir()
        (outside / 'precious.txt').write_text('keep')
        self.updater.mkdir(parents=True)
        try:
            os.symlink(outside, self.updater / 'link-to-dir')
            os.symlink(outside / 'precious.txt', self.updater / 'link-to-file')
        except OSError:
            self.skipTest('cannot create symlinks here')
        result = cleanup.clear_updater_folder(self.instance)
        self.assertTrue(result['ok'])
        self.assertEqual(list(self.updater.iterdir()), [])
        self.assertEqual((outside / 'precious.txt').read_text(), 'keep')

    @unittest.skipUnless(hasattr(os, 'symlink'), 'symlinks unavailable')
    def test_refuses_when_updater_itself_is_a_symlink(self):
        outside = self.instance / 'outside'
        outside.mkdir()
        (outside / 'precious.txt').write_text('keep')
        self.profile.mkdir(parents=True)
        try:
            os.symlink(outside, self.updater)
        except OSError:
            self.skipTest('cannot create symlinks here')
        result = cleanup.clear_updater_folder(self.instance)
        self.assertFalse(result['ok'])
        self.assertEqual((outside / 'precious.txt').read_text(), 'keep')

    def test_refuses_when_updater_is_a_file(self):
        self.profile.mkdir(parents=True)
        self.updater.write_text('not a folder')
        result = cleanup.clear_updater_folder(self.instance)
        self.assertFalse(result['ok'])
        self.assertTrue(self.updater.exists())


if __name__ == '__main__':
    unittest.main()
