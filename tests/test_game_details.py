import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('game_details', Path(__file__).parents[1] / 'docker/agent/game_details.py')
details = importlib.util.module_from_spec(spec)
spec.loader.exec_module(details)


class GameDetailsTests(unittest.TestCase):
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
