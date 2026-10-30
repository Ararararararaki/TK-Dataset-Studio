"""本轮两处改动的契约测试：caption 专用指导词、WD14 标签强度默认值与校验。

指导词只对 caption 预设生效（tags / hybrid / moss 继续用各自的 guidance），
标签强度默认 0.6，settings.save 接受 0.6、拒绝越界值。
"""

import tempfile
import unittest
from pathlib import Path

from backend.presets import BUILTINS, CAPTION, build_task, compile_output
from backend.server import DEFAULTS, Server

ROW = {'width': 832, 'height': 1216}
RAW = {'1girl': 0.94, 'blue_hair': 0.81, 'school_uniform': 0.72}

# 参考集 kase_daiki 里的真实风格样本（287 字符 / 48 词），用于确认正常 caption 不被误判。
REFERENCE_CAPTION = (
    'A schoolgirl on a playground seen from a low rear angle, her pleated skirt lifted '
    'to bare her buttocks and white panties, looking back over her shoulder with flushed '
    'cheeks. White shirt, navy school bag, playground bars and blue sky behind her, '
    'rendered in glossy cel-shaded anime style.'
)


def task_text(preset_id, **overrides):
    preset = next(p for p in BUILTINS if p['id'] == preset_id)
    return build_task({**preset, **overrides}, ROW, RAW)


class CaptionGuidanceTests(unittest.TestCase):
    def test_caption_task_carries_the_caption_guide(self):
        text = task_text('caption')
        self.assertIn(CAPTION, text)
        for phrase in ('a single English paragraph', '44-59 words', '250-335 characters',
                       'at most two sentences'):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, text)

    def test_caption_guide_forbids_tag_lists_and_meta_openers(self):
        text = task_text('caption')
        self.assertIn('do not use a comma-stacked keyword list', text)
        self.assertIn('The image shows', text)
        self.assertIn('plus the main subject', text)
        self.assertIn('finite copula', text)

    def test_other_presets_do_not_inherit_the_caption_guide(self):
        for preset_id in ('tags', 'hybrid', 'moss'):
            text = task_text(preset_id)
            with self.subTest(preset=preset_id):
                self.assertNotIn(CAPTION, text)
                self.assertNotIn('a single English paragraph', text)
                self.assertNotIn('comma-stacked keyword list', text)
                self.assertNotIn('plus the main subject', text)

    def test_custom_guidance_still_wins_for_non_caption_formats(self):
        text = task_text('tags', guidance='CUSTOM GUIDANCE MARKER')
        self.assertIn('CUSTOM GUIDANCE MARKER', text)
        self.assertNotIn(CAPTION, text)

    def test_caption_format_ignores_stored_guidance_in_favour_of_the_guide(self):
        # 内置 caption 预设自带 guidance=FAITHFUL；caption 格式必须用 CAPTION 覆盖它。
        text = task_text('caption', guidance='CUSTOM GUIDANCE MARKER')
        self.assertIn(CAPTION, text)
        self.assertNotIn('CUSTOM GUIDANCE MARKER', text)

    def test_caption_task_keeps_the_output_contract_and_dimensions(self):
        text = task_text('caption')
        self.assertIn('832 x 1216', text)
        self.assertIn('Return only the finished English training caption', text)
        self.assertIn('"1girl": 0.94', text)


class CompileOutputCaptionTests(unittest.TestCase):
    def test_reference_style_paragraph_passes_through_unchanged(self):
        self.assertEqual(compile_output(REFERENCE_CAPTION, 'caption', 832, 1216), REFERENCE_CAPTION)

    def test_legacy_json_wrapper_is_unwrapped(self):
        import json
        self.assertEqual(
            compile_output(json.dumps({'caption': REFERENCE_CAPTION}), 'caption', 832, 1216),
            REFERENCE_CAPTION,
        )

    def test_tag_list_reply_is_still_rejected(self):
        for text in ('1girl, solo, blue_hair, school_uniform', 'blue hair, red eyes, white dress'):
            with self.subTest(text=text), self.assertRaisesRegex(ValueError, '标签'):
                compile_output(text, 'caption', 832, 1216)

    def test_empty_caption_object_is_rejected(self):
        import json
        with self.assertRaises(ValueError):
            compile_output(json.dumps({'caption': '   '}), 'caption', 832, 1216)


class Wd14ThresholdDefaultTests(unittest.TestCase):
    def test_default_threshold_is_six_tenths(self):
        self.assertEqual(DEFAULTS['wd14']['threshold'], 0.6)

    def test_character_threshold_unchanged(self):
        self.assertEqual(DEFAULTS['wd14']['character_threshold'], 0.85)


class SettingsThresholdTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.server = Server(self.root / 'data')
        self.server.notify = lambda event: None

    async def asyncTearDown(self):
        await self.server.agent.close()
        await self.server.jobs.close()
        self.server.store.close()
        self.temp.cleanup()

    def config(self):
        cfg = self.server.settings()
        cfg['agent_access'] = 'off'  # 不在测试里拉起本地 Agent HTTP 服务
        return cfg

    async def save(self, cfg):
        return await self.server.dispatch('settings.save', cfg)

    async def test_fresh_store_reports_six_tenths(self):
        self.assertEqual(self.server.settings()['wd14']['threshold'], 0.6)

    async def test_save_accepts_six_tenths_and_persists_it(self):
        cfg = self.config()
        cfg['wd14']['threshold'] = 0.6
        await self.save(cfg)
        self.assertEqual(self.server.settings()['wd14']['threshold'], 0.6)
        self.assertEqual(self.server.store.get_setting('config')['wd14']['threshold'], 0.6)

    async def test_save_accepts_the_ui_slider_bounds(self):
        for value in (0.05, 0.35, 0.95):
            cfg = self.config()
            cfg['wd14']['threshold'] = value
            with self.subTest(value=value):
                await self.save(cfg)
                self.assertEqual(self.server.settings()['wd14']['threshold'], value)

    async def test_save_rejects_out_of_range_values(self):
        for value in (1.5, -0.1, 1.01, 'abc', None):
            cfg = self.config()
            cfg['wd14']['threshold'] = value
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, '阈值'):
                await self.save(cfg)

    async def test_partial_wd14_patch_keeps_the_other_wd14_fields(self):
        # 只传 threshold 时 wd14 必须深合并，不能把 model/device/角色阈值/exclude_tags 吞掉。
        before = self.config()
        await self.save({'wd14': {'threshold': 0.6}, 'agent_access': 'off'})
        after = self.server.settings()['wd14']
        self.assertEqual(after['threshold'], 0.6)
        for key in ('model', 'device', 'character_threshold', 'exclude_tags'):
            with self.subTest(field=key):
                self.assertIn(key, after)
                self.assertEqual(after[key], before['wd14'][key])
        stored = self.server.store.get_setting('config')['wd14']
        for key in ('model', 'device', 'character_threshold', 'exclude_tags'):
            with self.subTest(stored=key):
                self.assertIn(key, stored)

    async def test_bool_threshold_is_rejected(self):
        for value in (True, False):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, '阈值'):
                await self.save({'wd14': {'threshold': value}, 'agent_access': 'off'})

    async def test_character_threshold_uses_its_own_wider_range(self):
        for value in (0.05, 0.99):
            with self.subTest(value=value):
                await self.save({'wd14': {'character_threshold': value}, 'agent_access': 'off'})
                self.assertEqual(self.server.settings()['wd14']['character_threshold'], value)
        for value in (1.0, 0.04):
            with self.subTest(rejected=value), self.assertRaisesRegex(ValueError, 'character_threshold'):
                await self.save({'wd14': {'character_threshold': value}, 'agent_access': 'off'})

    async def test_rejected_value_does_not_touch_the_stored_config(self):
        cfg = self.config()
        cfg['wd14']['threshold'] = 0.6
        await self.save(cfg)
        broken = self.config()
        broken['wd14']['threshold'] = 2
        with self.assertRaisesRegex(ValueError, '阈值'):
            await self.save(broken)
        self.assertEqual(self.server.settings()['wd14']['threshold'], 0.6)


if __name__ == '__main__':
    unittest.main()
