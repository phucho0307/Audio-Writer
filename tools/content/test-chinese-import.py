import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('chinese_import', Path(__file__).with_name('import-chinese-stories.py'))
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)
spec = importlib.util.spec_from_file_location('chinese_clean', Path(__file__).with_name('clean-chinese-stories.py'))
cleanup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cleanup)


class ChineseImportChecks(unittest.TestCase):
    def test_visible_css_words_are_retained_in_order(self):
        raw = '''<style>.a-123:before { content: "đã"; }.b-456::before { content: "biết"; }</style>
        <div id="chapter-content-render"><p>Đại ca <span class="a-123"></span> <span class="b-456"></span> sử dụng hồi mã thương.</p></div>'''
        root = c.h.Document(raw).root
        self.assertEqual(c.visible_monkey_text(root.one(id='chapter-content-render'), raw), 'Đại ca đã biết sử dụng hồi mã thương.')

    def test_missing_visible_word_rejects_incomplete_text(self):
        raw = '<div id="chapter-content-render"><p>Ta <span class="q-0123456789abcdef0123456789abcdef"></span> đi.</p></div>'
        with self.assertRaisesRegex(ValueError, 'Unresolved'):
            c.visible_monkey_text(c.h.Document(raw).root.one(id='chapter-content-render'), raw)

    def test_numbered_chapters_are_chronological(self):
        urls = [f'https://metruyen.fit/truyen/book/chuong-{n}/' for n in [3, 2, 1]]
        self.assertEqual(c.ordered_source_urls(urls), list(reversed(urls)))

    def test_missing_chapter_rejects_complete_status(self):
        urls = [f'https://metruyen.fit/truyen/book/chuong-{n}/' for n in [1, 2, 4]]
        with self.assertRaisesRegex(ValueError, 'missing'):
            c.ordered_source_urls(urls)

    def test_long_source_page_keeps_every_word_in_order(self):
        text = '\n\n'.join(' '.join(f'từ{p}_{i}' for i in range(130)) for p in range(22))
        parts = c.review.reading_parts([{'title': 'Chương 1', 'text': text, 'sourceUrl': 'https://metruyen.fit/truyen/book/chuong-1/', 'sha256': c.sha256(text.encode()).hexdigest()}])
        self.assertGreater(len(parts), 1)
        self.assertTrue(all(len(x['text']) <= 12000 for x in parts))
        self.assertEqual(' '.join(' '.join(x['text'].split()) for x in parts), ' '.join(text.split()))

    def test_reading_parts_stay_together_when_source_order_is_corrected(self):
        work = {'chapters': [
            {'title': '2 · phần 1', 'sourceUrl': 'https://metruyen.fit/truyen/book/chuong-2/', 'text': 'hai a'},
            {'title': '2 · phần 2', 'sourceUrl': 'https://metruyen.fit/truyen/book/chuong-2/', 'text': 'hai b'},
            {'title': '1', 'sourceUrl': 'https://metruyen.fit/truyen/book/chuong-1/', 'text': 'một'},
        ]}
        self.assertEqual([x['text'] for x in c.validate_cached_work(work)['chapters']], ['một', 'hai a', 'hai b'])

    def test_navigation_and_publisher_calls_to_action_do_not_enter_narration(self):
        text = 'Ta mở cửa.\n\n🍒Follow page Diệp Gia Gia trên Facebook để theo dõi thông tin cập nhật truyện mới nhé.\n\nHắn đã về.\n\nChương trước\n\nChương sau'
        self.assertEqual(cleanup.clean(text), 'Ta mở cửa.\n\nHắn đã về.')

    def test_only_reviewed_split_words_are_joined(self):
        text = 'Nàng nói về c/h/ế/t và thê t/ử, ngày 12/05, anh/em và/hoặc người khác.'
        self.assertEqual(cleanup.clean(text), 'Nàng nói về chết và thê tử, ngày 12/05, anh/em và/hoặc người khác.')

    def test_social_media_actions_in_the_plot_are_retained(self):
        text = 'Tôi lên Facebook tìm thông tin về hắn.\n\nTôi quyết định follow page công ty của hắn để điều tra.'
        self.assertEqual(cleanup.clean(text), text)


if __name__ == '__main__':
    unittest.main()
