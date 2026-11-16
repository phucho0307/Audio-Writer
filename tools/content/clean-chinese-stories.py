"""Remove source navigation/promotional paragraphs, retaining literary text.

This is a literal formatting cleanup, not rewriting or summarization. Original
import hashes and all attribution remain recorded. Existing cleaned splits are
retained on re-runs so published contributions stay immutable.
"""
import importlib.util
from pathlib import Path
import json
import re

spec = importlib.util.spec_from_file_location('chinese_import', Path(__file__).with_name('import-chinese-stories.py'))
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)

SPLIT_WORDS = {'chết', 'giết', 'máu', 'xác', 'tử', 'dao', 'mạng', 'hại', 'sát', 'thịt', 'bắn', 'đâm', 'chém', 'độc', 'bệnh', 'tàn', 'thi', 'thù', 'hôn', 'mất', 'đau', 'huyết', 'thê'}


def is_promotion(paragraph):
    value = c.fold(paragraph)
    if re.match(r'^(?:follow|hay follow|nho follow|theo doi)\b', value) and re.search(r'\b(page|fanpage|facebook|fb)\b', value) and re.search(r'\b(truyen|nha xoan|diep gia gia)\b', value):
        return True
    if len(value.split()) < 130 and re.match(r'^(?:neu duoc|cac bac|cho xoan|cho gia|cho minh)\b', value) and re.search(r'\b(cho|xin)\b.{0,60}\b(vai dong|review|comment|com review)\b', value) and re.search(r'\b(cac bac|nha xoan|cho xoan|cho gia|gia xin)\b', value):
        return True
    if re.search(r'^(?:queo com|chao mung cac bac den voi|cam on cac bac rat nhieu vi da luon)', value):
        return True
    if re.search(r'^(?:ban dang doc truyen|doc truyen tai|nguon truyen)', value) and re.search(r'monkeyd|metruyen', value):
        return True
    return False


def clean(text):
    # The literal footer was confirmed to be the source's .my-4 navigation.
    text = re.sub(r'(?:\n\s*)+Chương trước(?:\n\s*)+Chương sau\s*$', '', text).strip()
    paragraphs = re.split(r'\n\s*\n', text)
    paragraphs = [p for p in paragraphs if p.strip() and not is_promotion(p)]
    text = '\n\n'.join(paragraphs)
    # Only a reviewed word allowlist is joined: valid alternatives such as
    # "và/hoặc", "anh/em", URLs and numeric dates are left unchanged.
    text = re.sub(r'\b[^\W\d_]+(?:/[^\W\d_]+)+\b',
        lambda m: m[0].replace('/', '') if m[0].replace('/', '').lower() in SPLIT_WORDS else m[0], text)
    return text.strip()


def clean_work(work):
    if work.get('cleanupVersion') == 1 and work.get('cleanupRuleset') == 2:
        return work
    if work.get('cleanupVersion') == 1:
        if work.get('sourceFormattingWordsRemoved', 0) == 0:
            work['cleanupRuleset'] = 2
            return work
        # Re-read cached public source pages for the small set that had
        # promotional/navigation text removed, applying the stricter rules.
        original = []
        seen = set()
        for chapter in work['chapters']:
            url = chapter['sourceUrl']
            if url in seen:
                continue
            seen.add(url)
            root, raw = c.document(url)
            if work['sourceId'] == 'monkeyd':
                text = c.visible_monkey_text(root.one(id='chapter-content-render'), raw)
            else:
                node = root.one(cls='reading-content').one(cls='text-left')
                text = c.h.clean_text(node.text(blocks=True))
            original.append({'title': chapter.get('sourceChapterTitle', chapter['title']), 'text': text,
                'sourceUrl': url, 'sha256': c.sha256(text.encode()).hexdigest()})
        work['chapters'] = original
    groups = []
    for chapter in work['chapters']:
        if groups and groups[-1][0]['sourceUrl'] == chapter['sourceUrl']:
            groups[-1].append(chapter)
        else:
            groups.append([chapter])
    source = []
    removed_words = 0
    for group in groups:
        original = '\n\n'.join(part['text'] for part in group)
        text = clean(original)
        if not text:
            raise ValueError('Cleanup removed an entire source chapter: ' + work['key'])
        first = group[0]
        chapter = {k: v for k, v in first.items() if k not in {'sourcePart', 'sourcePartCount', 'sourceChapterTitle', 'sourceTextSha256'}}
        chapter.update({'title': first.get('sourceChapterTitle', first['title']), 'text': text,
            'sha256': c.sha256(text.encode()).hexdigest(), 'preCleanupSha256': c.sha256(original.encode()).hexdigest()})
        source.append(chapter)
        removed_words += len(original.split()) - len(text.split())
    work['chapters'] = c.review.reading_parts(source)
    work['wordCount'] = sum(len(x['text'].split()) for x in work['chapters'])
    work['cleanupVersion'] = 1
    work['cleanupRuleset'] = 2
    work['sourceFormattingWordsRemoved'] = removed_words
    work['textSource']['changes'] = 'Loại thanh điều hướng và lời quảng bá của nguồn; chuẩn hóa từ viết tách bằng dấu / và chia phần đọc dài. Giữ nguyên nội dung truyện.'
    return work


def main():
    manifest = json.loads((c.OUTPUT / 'manifest.json').read_text(encoding='utf-8'))
    for key in manifest['keys']:
        path = c.OUTPUT / (key + '.json')
        work = clean_work(json.loads(path.read_text(encoding='utf-8')))
        c.write_json(path, work)
    works = [json.loads((c.OUTPUT / (key + '.json')).read_text(encoding='utf-8')) for key in manifest['keys']]
    manifest['counts'] = {'works': len(works), 'chapters': sum(len(w['chapters']) for w in works), 'words': sum(w['wordCount'] for w in works)}
    manifest['reviewedDuplicateEditions'] = c.DUPLICATE_EDITION_OF
    c.write_json(c.OUTPUT / 'manifest.json', manifest)
    c.log(stage='cleaned', **manifest['counts'])


if __name__ == '__main__':
    main()
