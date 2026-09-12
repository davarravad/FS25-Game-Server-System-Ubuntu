import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

if sys.platform=='win32':
    sys.modules['fcntl']=types.SimpleNamespace(LOCK_EX=1,LOCK_SH=2,LOCK_NB=4,flock=lambda *args:None)
spec=importlib.util.spec_from_file_location('game_sync',Path(__file__).resolve().parents[1]/'scripts/game-sync.py')
sync=importlib.util.module_from_spec(spec);spec.loader.exec_module(sync)

class GameSyncTests(unittest.TestCase):
    def make_game(self,root):
        for name,data in [('VERSION',b'1.2.3.0'),('x64/FarmingSimulator2025Game.exe',b'game'),('FarmingSimulator2025.exe',b'launcher'),('dedicatedServer.exe',b'server'),('data/map.xml',b'map')]:
            path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)

    def test_requests_identify_the_node_software(self):
        # Cloudflare bot protection answers Python's default User-Agent with HTTP 403.
        seen={}
        class Opener:
            def open(self,req,timeout):
                seen.update(req.headers);raise ValueError('stop')
        with patch.object(sync.urllib.request,'build_opener',lambda *handlers:Opener()),self.assertRaises(ValueError):
            sync.request({'token':'t','node':'n'},'poll',{})
        self.assertEqual(seen.get('User-agent'),'Farmservers-Node/1.0 (+https://farmservers.sargentweb.com)')

    def test_manifest_excludes_node_specific_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)/'game';self.make_game(root)
            for name in ['10823/dedicatedServer.xml','start_fs25_10823.sh','cert.pem','pk.pem','log.txt','.env','savegame1/career.xml','mods/custom.zip']:
                path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_text('private')
            with patch.object(sync,'STATE',Path(tmp)/'state'):
                result=sync.manifest(root,Path(tmp)/'dlc')
            names={f['path'] for f in result['files']}
            self.assertEqual(names,{'VERSION','x64/FarmingSimulator2025Game.exe','FarmingSimulator2025.exe','dedicatedServer.exe','data/map.xml'})

    def test_unsafe_paths(self):
        for path in ['../x','/etc/passwd','x/../y','a\\b','a//b','mods/a','12345/settings','pk.pem','data/../../x']:
            self.assertFalse(sync.safe_path(path),path)
        self.assertTrue(sync.safe_path('data/maps/map.xml'))

    def test_download_waits_for_running_games_then_applies_without_redownloading(self):
        with tempfile.TemporaryDirectory() as tmp:
            state=Path(tmp)/'state';state.mkdir();source=Path(tmp)/'source';self.make_game(source)
            with patch.object(sync,'STATE',state):
                manifest=sync.manifest(source,Path(tmp)/'dlc')
                chunks={sync.hashlib.sha256((source/f['path']).read_bytes()).hexdigest():(source/f['path']).read_bytes() for f in manifest['files']}
                target=Path(tmp)/'target';target.mkdir();(target/'cert.pem').write_text('node certificate');(target/'pk.pem').write_text('node private key')
                (target/'10823').mkdir();(target/'10823'/'settings').write_text('keep')
                count=[];reports=[]
                def request(config,operation,*args,**kwargs):
                    if operation.startswith('manifest'):return manifest
                    if operation.startswith('chunk'):count.append(operation);return chunks[operation.split('hash=')[1]]
                    raise AssertionError(operation)
                job={'id':'a'*36,'dlcs':[]}
                with patch.object(sync,'request',side_effect=request),patch.object(sync,'progress',side_effect=lambda *args:reports.append(args)),patch.object(sync,'running',return_value=True):
                    sync.install({},job,target,Path(tmp)/'dest-dlc',Path(tmp)/'instances')
                self.assertEqual(reports[-1][2],'waiting');self.assertFalse((target/'VERSION').exists())
                first=len(count)
                with patch.object(sync,'request',side_effect=request),patch.object(sync,'progress',side_effect=lambda *args:reports.append(args)),patch.object(sync,'running',return_value=False):
                    sync.install({},job,target,Path(tmp)/'dest-dlc',Path(tmp)/'instances')
                self.assertEqual(len(count),first);self.assertEqual(reports[-1][2],'succeeded')
                self.assertEqual((target/'VERSION').read_bytes(),b'1.2.3.0')
                self.assertEqual((target/'10823'/'settings').read_text(),'keep')
                self.assertEqual((target/'pk.pem').read_text(),'node private key')
                self.assertFalse((target/'.farmservers-sync-in-progress').exists())

    def test_corrupted_download_never_reaches_game_folder(self):
        with tempfile.TemporaryDirectory() as tmp:
            state=Path(tmp)/'state';state.mkdir();source=Path(tmp)/'source';self.make_game(source)
            with patch.object(sync,'STATE',state):
                manifest=sync.manifest(source,Path(tmp)/'dlc')
                def request(config,op,*args,**kwargs):return manifest if op.startswith('manifest') else b'corrupt'
                with patch.object(sync,'request',side_effect=request),patch.object(sync,'progress'):
                    with self.assertRaisesRegex(ValueError,'verification'):
                        sync.install({}, {'id':'b'*36},Path(tmp)/'target',Path(tmp)/'dlc',Path(tmp)/'instances')
                self.assertFalse((Path(tmp)/'target').exists())

    def test_control_agent_does_not_block_game_sync(self):
        root=Path('/opt/fs25/game/Farming Simulator 2025')
        row={'Name':'/fsg-panel-agent','Config':{'Labels':{'com.docker.compose.service':'agent'}},'Mounts':[{'Type':'bind','Source':'/opt/fs25/game','Destination':'/opt/fs25/game'}]}
        self.assertFalse(sync.uses_game(row,root))
        row['Name']='/game-1';row['Config']['Labels']['com.docker.compose.service']='fs25'
        self.assertTrue(sync.uses_game(row,root))

    def test_only_selected_dlc_is_copied(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp);state=base/'state';state.mkdir();source=base/'source';self.make_game(source)
            dlc=base/'library-dlc';dlc.mkdir()
            for name in ['Selected','Other']:(dlc/f'FarmingSimulator25_{name}_1.exe').write_text(name)
            with patch.object(sync,'STATE',state):
                manifest=sync.manifest(source,dlc)
                contents={}
                for file in manifest['files']:
                    origin=dlc/file['path'].removeprefix('__dlc__/') if file['path'].startswith('__dlc__/') else source/file['path']
                    contents[sync.hashlib.sha256(origin.read_bytes()).hexdigest()]=origin.read_bytes()
                def request(config,op,*args,**kwargs):return manifest if op.startswith('manifest') else contents[op.split('hash=')[1]]
                dest=base/'target';dest.mkdir();(dest/'cert.pem').write_text('cert');(dest/'pk.pem').write_text('key')
                instances=base/'instances';(instances/'game-1').mkdir(parents=True)
                job={'id':'c'*36,'dlcs':['Selected'],'dlc_settings':[{'instance':'game-1','packages':['Selected']}]}
                with patch.object(sync,'request',side_effect=request),patch.object(sync,'progress'),patch.object(sync,'running',return_value=False),patch.object(sync,'dlc_runtime_ready',return_value=True):
                    sync.install({},job,dest,base/'destination-dlc',instances)
                self.assertTrue((base/'destination-dlc'/'FarmingSimulator25_Selected_1.exe').exists())
                self.assertFalse((base/'destination-dlc'/'FarmingSimulator25_Other_1.exe').exists())
                self.assertEqual((instances/'game-1/data/config/FarmingSimulator2025/.farmservers-enabled-dlcs').read_text(),'Selected\n')
                with patch.object(sync,'request',side_effect=AssertionError('must not download twice')),patch.object(sync,'progress') as report:
                    sync.install({},job,dest,base/'destination-dlc',instances)
                    self.assertEqual(report.call_args.args[2],'succeeded')

    def test_apply_failure_restores_existing_game_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp);state=base/'state';state.mkdir();source=base/'source';self.make_game(source)
            with patch.object(sync,'STATE',state):
                manifest=sync.manifest(source,base/'dlc')
                chunks={sync.hashlib.sha256((source/f['path']).read_bytes()).hexdigest():(source/f['path']).read_bytes() for f in manifest['files']}
                def request(config,op,*args,**kwargs):return manifest if op.startswith('manifest') else chunks[op.split('hash=')[1]]
                dest=base/'target';self.make_game(dest);(dest/'VERSION').write_text('old version')
                original=sync.shutil.copyfile
                def copy(src,target,*args,**kwargs):
                    if str(target).endswith('dedicatedServer.exe.farmservers-new'):raise OSError('simulated disk failure')
                    return original(src,target,*args,**kwargs)
                with patch.object(sync,'request',side_effect=request),patch.object(sync,'progress'),patch.object(sync,'running',return_value=False),patch.object(sync.shutil,'copyfile',side_effect=copy):
                    with self.assertRaisesRegex(OSError,'simulated'):
                        sync.install({}, {'id':'d'*36},dest,base/'dest-dlc',base/'instances')
                self.assertEqual((dest/'VERSION').read_text(),'old version')
                self.assertFalse((dest/'.farmservers-sync-in-progress').exists())

if __name__=='__main__':unittest.main()
