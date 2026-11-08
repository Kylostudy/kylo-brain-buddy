import json
import unittest
from decimal import Decimal
from pathlib import Path

BRIEF = json.loads(Path(__file__).with_name("brief.json").read_text())


class PiggyBankBriefTests(unittest.TestCase):
    def test_approved_kylo_price(self):
        self.assertEqual(Decimal(BRIEF["kylo_monthly_usd"]), Decimal("29.99"))

    def test_illustrative_basket_total(self):
        self.assertGreater(sum(item["monthly_usd"] for item in BRIEF["basket"]), 100)

    def test_free_trial_length(self):
        self.assertEqual(BRIEF["trial_days"], 14)

    def test_category_price_range(self):
        for item in BRIEF["basket"]:
            self.assertGreaterEqual(item["monthly_usd"], 10)
            self.assertLessEqual(item["monthly_usd"], 25)

    def test_single_hungarian_trial(self):
        self.assertEqual((BRIEF["output_count"], BRIEF["language"]), (1, "hu"))

    def test_vps_only(self):
        self.assertEqual(BRIEF["render_location"], "vps_only")

    def test_no_automatic_publication(self):
        self.assertFalse(BRIEF["publication_enabled"])

    def test_no_guaranteed_exam_success(self):
        self.assertFalse(BRIEF["exam_success_guaranteed"])


if __name__ == "__main__":
    unittest.main()