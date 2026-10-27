import json
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).parent


class CaptionSafeV2(unittest.TestCase):
    def bounds(self):
        module = ROOT / "exam-safe-renderer/src/captionSafeZone.ts"
        code = f'import {{captionBounds,CAPTION_SAFE_ZONE}} from {json.dumps(str(module.resolve()))}; console.log(JSON.stringify({{bounds:captionBounds(),zone:CAPTION_SAFE_ZONE}}));'
        result = subprocess.run(["bun", "-e", code], capture_output=True, text=True, check=True)
        return json.loads(result.stdout)

    def test_caption_horizontal_limits(self):
        result = self.bounds()
        self.assertEqual(result["bounds"]["left"], 81)
        self.assertEqual(result["bounds"]["right"], 934)

    def test_caption_animation_bottom_limit(self):
        result = self.bounds()
        self.assertEqual(result["bounds"]["bottom"], 1444)
        self.assertGreaterEqual(result["bounds"]["top"], result["zone"]["top"])
        self.assertLessEqual(result["bounds"]["bottom"], result["zone"]["bottom"])


if __name__ == "__main__":
    unittest.main()