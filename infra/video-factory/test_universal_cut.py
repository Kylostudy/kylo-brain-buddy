"""No video rendering: concrete cut/alignment/layout rules and fixed ffmpeg call."""
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch
from universal_media import frame_plan, remap_ms, cut_and_remap


class CutTests(unittest.TestCase):
    def test_round_inward_preserves_boundaries(self):
        kept=frame_plan(120, [(1.01, 2.01)])
        self.assertIn(30, kept)
        self.assertIn(60, kept)
        self.assertEqual(len(kept), 91)

    def test_caption_shift_preserves_character_duration(self):
        kept=frame_plan(120, [(1, 2)])
        self.assertEqual(remap_ms(2500, kept), 1500)
        self.assertEqual(remap_ms(3000, kept)-remap_ms(2500, kept), 500)

    def test_actual_cut_remaps_every_layout_frame(self):
        records=[{'frame':i,'scene':'test','boxes':[]} for i in range(120)]
        with tempfile.TemporaryDirectory() as root, patch('universal_media.detect_gaps',return_value=[(1,2)]), patch('universal_media.subprocess.run') as run:
            output, layout, captions, qa=cut_and_remap(Path(root)/'checked.mp4',records,4000,[{'text':'Kylo','start_ms':2500,'end_ms':3000}],3500)
            self.assertEqual(qa['removed_frames'],30)
            self.assertEqual(layout[30]['source_frame'],60)
            self.assertEqual([r['frame'] for r in layout],list(range(90)))
            self.assertEqual(captions[0]['start_ms'],1500)
            args=run.call_args.args[0]
            self.assertIn('trim=start_frame=60:end_frame=120',args[args.index('-filter_complex')+1])
            self.assertEqual(output.name,'cut-checked.mp4')

    def test_no_gap_does_not_reencode(self):
        with patch('universal_media.detect_gaps',return_value=[]),patch('universal_media.subprocess.run') as run:
            path,_,_,qa=cut_and_remap(Path('original.mp4'),[{'frame':0}],33,[],0)
            self.assertEqual(path,Path('original.mp4'));self.assertEqual(qa['removed_frames'],0);run.assert_not_called()