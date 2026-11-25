"""Synthetic export examples cover public CSV formatting and conservative map joins."""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('shipwreck_build', ROOT / 'scripts/build.py')
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


class ImportTests(unittest.TestCase):
    def setUp(self):
        self.raw = (Path(__file__).parent / 'fixtures/shipwrecks-soda3.csv').read_bytes()

    def test_export_preserves_dates_and_only_maps_unambiguous_matches(self):
        # The production importer rejects suspiciously small exports. Repeat this
        # synthetic four-row fixture to exercise that guard without a large fixture.
        header, body = self.raw.split(b'\n', 1)
        raw = header + b'\n' + body * 250
        match = {'attributes': {'OBJECTID': 7}, 'geometry': {'x': -63.5, 'y': 44.7}}
        by_key = {
            build.join_key(('Example Vessel - 1875', '1875-05-01', 'Example Island, Cape Breton')): [match],
            build.join_key(('Ambiguous Vessel - 1900', '1900-04-10', 'Example Cove')): [match, match],
        }
        rows = build.import_records(raw, by_key)
        self.assertEqual(len(rows), 1000)
        self.assertEqual(len({r['id'] for r in rows}), 1000)
        self.assertEqual(rows[0]['name'], 'Example Vessel')
        self.assertEqual(rows[0]['date'], '1875-05-01')
        self.assertEqual(rows[0]['point'], [-63.5, 44.7])
        self.assertEqual(rows[0]['mapId'], 7)
        self.assertEqual(rows[0]['details']['Story'], 'A quoted detail, preserved.')
        self.assertIsNone(rows[1]['point'])
        self.assertIsNone(rows[1]['mapId'])
        self.assertEqual((rows[2]['year'], rows[2]['date'], rows[2]['point']), (1890, '1890', None))
        self.assertEqual((rows[3]['year'], rows[3]['date']), (None, ''))

    def test_truncated_export_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'export appears incomplete'):
            build.import_records(self.raw, {})

    def test_error_page_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'schema changed'):
            build.import_records(b'<html>Source unavailable</html>', {})


if __name__ == '__main__':
    unittest.main()
