import importlib.util
import tempfile
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('game_details', Path(__file__).parents[1] / 'docker/agent/game_details.py')
details = importlib.util.module_from_spec(spec)
spec.loader.exec_module(details)


class GameDetailsTests(unittest.TestCase):
    PANEL = '''<html><body><table><tr><td>Game</td><td>Farming Simulator 25 (1.23.1.0)</td></tr>
<tr><td>Server Game Name</td><td><input type="text" name="game_name" value="TFC - 01"></td></tr>
<tr><td>Savegame Slot</td><td><select name="savegame"><option value="1" selected="selected">SAVEGAME 1 - Map: FSG Realism &amp; Back Roads County 4x, Money: 18268672 $</option><option value="2">SAVEGAME 2 - Empty</option></select></td></tr>
<tr><td>Slots</td><td><select name = "max_player"><option value="12">12</option><option value="16" selected="selected">16</option></select></td></tr>
</table></body></html>'''

    def test_panel_page_reports_version_slots_and_loaded_map(self):
        data = details.parse_panel(self.PANEL)
        self.assertEqual(data, {'game_version': '1.23.1.0', 'player_capacity': 16, 'game_map': 'FSG Realism & Back Roads County 4x'})

    def test_login_page_is_not_mistaken_for_settings(self):
        with self.assertRaises(ValueError):
            details.parse_panel('<html><form><input name="username"><input name="password"></form></html>')
        self.assertEqual(details.parse_panel(self.PANEL.replace('selected="selected"', '')), {'game_version': '1.23.1.0'})

    def test_collect_prefers_panel_version_and_keeps_credentials_in_container(self):
        with tempfile.TemporaryDirectory() as tmp:
            instance = Path(tmp)
            profile = instance / 'data/config/FarmingSimulator2025'
            profile.mkdir(parents=True)
            (profile / 'VERSION').write_text('1.22.0.0')
            calls = []

            def command(cmd, timeout=None):
                calls.append(cmd)
                return {'code': 0, 'stdout': self.PANEL} if details.PANEL_SCRIPT in cmd else {'code': 1, 'stdout': ''}

            details.PANEL_CACHE.clear()
            values = {'WEB_PORT': '18000', 'WEB_USERNAME': 'admin', 'WEB_PASSWORD': 'panel-secret'}
            self.assertEqual(details.collect(instance, 'fs25-001', values, False, command), {'game_version': '1.22.0.0'})
            self.assertEqual(calls, [])
            result = details.collect(instance, 'fs25-001', values, True, command)
            self.assertEqual((result['game_version'], result['player_capacity'], result['game_map']), ('1.23.1.0', 16, 'FSG Realism & Back Roads County 4x'))
            self.assertNotIn('panel-secret', ' '.join(calls[0]))
            self.assertNotIn('game_sampled_at', result)
            # The panel is polled at most every few minutes; a second collection reuses the cached answer.
            polls = len([c for c in calls if details.PANEL_SCRIPT in c])
            self.assertEqual(details.collect(instance, 'fs25-001', values, True, command)['game_version'], '1.23.1.0')
            self.assertEqual(len([c for c in calls if details.PANEL_SCRIPT in c]), polls)

    def test_public_details_only(self):
        data = details.parse_feed(b'<Server version="1.4.0.0" mapName="Riverbend Springs"><Slots numUsed="2" capacity="16"><Player isUsed="true">Private player</Player></Slots></Server>')
        self.assertEqual(data['player_count'], 2)
        self.assertEqual(data['player_capacity'], 16)
        self.assertEqual(data['game_version'], '1.4.0.0')
        self.assertEqual(data['game_map'], 'Riverbend Springs')
        self.assertNotIn('Private player', str(data))

    def test_missing_slots_are_unknown_not_zero(self):
        self.assertNotIn('player_count', details.parse_feed(b'<Server/>'))
        self.assertEqual(details.parse_feed(b'<Server><Slots numUsed="0" capacity="16"/></Server>')['player_count'], 0)

    def test_reject_invalid_or_entity_xml(self):
        for data in [b'<html/>', b'<!DOCTYPE Server><Server/>', b'<Server><Slots numUsed="many"/></Server>']:
            with self.assertRaises(ValueError):
                details.parse_feed(data)


if __name__ == '__main__':
    unittest.main()
