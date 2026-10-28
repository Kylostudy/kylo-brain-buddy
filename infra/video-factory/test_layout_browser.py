"""Browser text-fit tests only; no Remotion, screenshots or video production."""
import json
from pathlib import Path
import subprocess
import unittest
from playwright.sync_api import sync_playwright


class BrowserLayoutTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path=Path(__file__).parent/"universal-renderer/src/layout.ts"
        code="const code=await Bun.file("+json.dumps(str(path.resolve()))+").text();console.log(new Bun.Transpiler({loader:'ts'}).transformSync(code).replaceAll('export ',''));"
        cls.js=subprocess.run(["bun","-e",code],check=True,capture_output=True,text=True).stdout
        cls.playwright=sync_playwright().start();cls.browser=cls.playwright.chromium.launch(headless=True)

    @classmethod
    def tearDownClass(cls):cls.browser.close();cls.playwright.stop()

    def fitted(self,text):
        page=self.browser.new_page(viewport={"width":1080,"height":1920})
        try:
            page.set_content('<div id="base" style="position:absolute;left:0;top:0;width:1080px;height:1920px"><div id="caption" style="position:absolute;left:77px;top:1274.8px;width:861px;max-height:171.92px;overflow-wrap:anywhere;line-height:1.2;white-space:pre-wrap;text-align:center"></div></div>')
            page.add_script_tag(content=self.js)
            return page.evaluate("""text=>{const el=document.getElementById('caption');el.textContent=text;const rect={left:77,right:938,top:1274.8,bottom:1446.72};const size=fitElement(el,rect,44);return {size,...textBounds(el,document.getElementById('base').getBoundingClientRect())};}""",text)
        finally:page.close()

    def test_long_german_caption_fits(self):
        text="Mit der ausführlichen Prüfungssimulation und nachvollziehbaren Rückmeldungen bereitet dich Kylo auf anspruchsvolle Sprachprüfungen vor. "*5
        r=self.fitted(text);self.assertLessEqual(r['bottom'],1459);self.assertGreaterEqual(r['top'],231);self.assertGreaterEqual(r['left'],65);self.assertLessEqual(r['right'],950);self.assertLess(r['size'],44)

    def test_long_finnish_caption_fits(self):
        text="Kielitutkintoon valmistautuminen helpottuu yksityiskohtaisella harjoittelulla ja henkilökohtaisella palautteella. "*5
        r=self.fitted(text);self.assertLessEqual(r['bottom'],1459);self.assertGreaterEqual(r['top'],231);self.assertGreaterEqual(r['left'],65);self.assertLessEqual(r['right'],950);self.assertLess(r['size'],44)


if __name__=='__main__':unittest.main()