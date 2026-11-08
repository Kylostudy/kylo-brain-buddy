"""Text measurement regression only; never render video or load media."""
import json
from pathlib import Path
import subprocess
import unittest
from playwright.sync_api import sync_playwright


class PiggyLayoutTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Extract the actual root dimensions from compiled JSX, not a fixture.
        source = Path(__file__).parent / 'piggy-layout-v2-renderer/src/Composition.tsx'
        code = ('const s=await Bun.file(' + json.dumps(str(source.resolve())) + ').text();'
                'console.log(new Bun.Transpiler({loader:"tsx"}).transformSync(s));')
        compiled = subprocess.run(['bun', '-e', code], check=True, capture_output=True, text=True).stdout
        start = compiled.index('"data-piggy-root": true')
        style = compiled[compiled.index('style:', start):].split('children:', 1)[0]
        cls.style = style.replace('style:', 'const style =', 1).rstrip().rstrip(',') + ';'
        cls.p = sync_playwright().start()
        cls.browser = cls.p.chromium.launch(headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.p.stop()

    def test_real_root_has_dimensions_in_zero_size_metadata_portal(self):
        page = self.browser.new_page(viewport={'width':1280,'height':1800})
        try:
            page.set_content('<div style="position:fixed;top:-999999px"><div style="position:absolute;inset:0;width:100%;height:100%"><div id="root" style="position:absolute;inset:0;width:100%;height:100%"><div id="text" style="position:absolute;left:85px;top:240px;width:845px;height:170px;font-size:58px;line-height:1.16;text-align:center">Mennyibe kerül havonta a tanulásod?</div></div></div></div>')
            self.assertEqual(page.eval_on_selector('#root','el=>el.getBoundingClientRect().width'),0)
            result = page.evaluate('''() => {''' + self.style + '''
                const root=document.getElementById('root');
                root.style.width=style.width+'px';root.style.height=style.height+'px';
                const base=root.getBoundingClientRect();
                const range=document.createRange();range.selectNodeContents(document.getElementById('text'));
                const rects=[...range.getClientRects()];
                return {width:base.width,height:base.height,count:rects.length,
                    left:Math.min(...rects.map(r=>r.left))-base.left,
                    right:Math.max(...rects.map(r=>r.right))-base.left,
                    top:Math.min(...rects.map(r=>r.top))-base.top,
                    bottom:Math.max(...rects.map(r=>r.bottom))-base.top};
            }''')
            self.assertEqual(result['width'],1080)
            self.assertEqual(result['height'],1920)
            self.assertGreater(result['count'],0)
            self.assertGreaterEqual(result['left'],65)
            self.assertLessEqual(result['right'],950)
            self.assertGreaterEqual(result['top'],231)
            self.assertLessEqual(result['bottom'],1459)
        finally:
            page.close()


if __name__ == '__main__':
    unittest.main()