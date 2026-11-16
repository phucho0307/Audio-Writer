"""Import the existing Thạch Lam prose texts on Vietnamese Wikisource.

Public-domain works only, with permanent revision links and CC BY-SA credit
for the source's transcription/formatting. Missing pages are never filled in.
"""
import importlib.util
import json
from pathlib import Path
import re
import tempfile
import time
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timezone

spec = importlib.util.spec_from_file_location('native_import', Path(__file__).with_name('import-native-texts.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
cache = Path(tempfile.gettempdir()) / 'audio-writer-public-domain'
cache.mkdir(exist_ok=True)


def parse(title):
    path = cache / (m.sha256(title.encode()).hexdigest() + '.json')
    if path.exists():
        result = json.loads(path.read_text(encoding='utf-8'))
    else:
        query = urllib.parse.urlencode({'action': 'parse', 'page': title, 'prop': 'text|links|revid|categories', 'format': 'json', 'formatversion': 2, 'redirects': 1, 'maxlag': 5})
        request = urllib.request.Request('https://vi.wikisource.org/w/api.php?' + query, headers={'User-Agent': 'AudioWriterLibrary/1.0 (public-domain import; source and revision credited)'})
        for attempt in range(4):
            try:
                with urllib.request.urlopen(request, timeout=45) as response:
                    result = json.load(response)
                break
            except urllib.error.HTTPError as error:
                if error.code != 429 or attempt == 3:
                    raise
                retry = error.headers.get('Retry-After', '')
                delay = max(60 * (attempt + 1), int(retry) if retry.isdigit() else 60)
                m.log(stage='wikisource-rate-pause', seconds=delay)
                time.sleep(delay)
        m.write_json(path, result)
        time.sleep(3)
    if 'error' in result:
        raise ValueError(result['error'])
    return result['parse']


def source_url(title):
    return 'https://vi.wikisource.org/wiki/' + urllib.parse.quote(title.replace(' ', '_'), safe='/')


def body(page):
    root = m.html.Document(page['text']).root
    node = root.one(cls='prose')
    if not node:
        # Some older chapters (including the author's preface) use direct
        # paragraphs rather than Wikisource's newer .prose wrapper.
        container = root.one(cls='mw-parser-output')
        node = m.html.Node()
        node.children = [c for c in container.children if isinstance(c, m.html.Node)
                         and c.tag in {'p', 'div'} and not c.attrs.get('class')
                         and not c.attrs.get('id')]
    text = m.html.clean_text(node.text(blocks=True))
    if len(text.split()) < 20 or '\ufffd' in text:
        raise ValueError('Empty or damaged source prose')
    return text


def main():
    author = parse('Tác gia:Thạch Lam')
    existing = {link['title'] for link in author['links'] if link.get('ns') == 0 and link.get('exists')}
    raw = author['text']
    segment = raw[raw.index('id="Tác_phẩm"'):raw.index('class="licenseContainer')]
    titles = list(dict.fromkeys(a.attrs['title'] for a in m.html.Document(segment).root.all(tag='a') if a.attrs.get('title') in existing))
    for title in titles:
        key = 'wikisource-' + m.folded(title).replace(' ', '-')
        path = m.OUTPUT / (key + '.json')
        if path.exists():
            continue
        try:
            page = parse(title)
            root = m.html.Document(page['text']).root
            if root.one(cls='prose'):
                pages = [(title, page)]
            else:
                children = list(dict.fromkeys(a.attrs['title'] for a in root.all(tag='a') if a.attrs.get('title', '').startswith(title + '/')))
                if not children:
                    raise ValueError('No prose or complete table of contents')
                available = {link['title'] for link in page['links'] if link.get('exists')}
                if any(child not in available for child in children):
                    raise ValueError('Source contents includes missing chapters')
                pages = [(child.rsplit('/', 1)[-1], parse(child)) for child in children]
            chapters = []
            for name, source in pages:
                text = body(source)
                chapters.append({'title': m.html.clean_text(name), 'text': text, 'sha256': m.sha256(text.encode()).hexdigest(),
                                 'sourceUrl': f"https://vi.wikisource.org/w/index.php?oldid={source['revid']}", 'sourceRevision': source['revid']})
            result = {'key': key, 'storyId': m.stable_id(key), 'branchId': m.stable_id(key + ':main'),
                'title': m.html.clean_text(title.replace(' (truyện ngắn)', '')), 'authorId': 'thach-lam', 'authorName': 'Thạch Lam',
                'authorSourceUrl': source_url('Tác gia:Thạch Lam'), 'sourceName': 'Wikisource tiếng Việt', 'sourceUrl': source_url(title),
                'permanentUrl': f"https://vi.wikisource.org/w/index.php?oldid={page['revid']}",
                'license': {'name': 'CC BY-SA 4.0 · văn bản biên tập trên Wikisource', 'url': 'https://creativecommons.org/licenses/by-sa/4.0/'},
                'genres': ['Tản văn' if len(chapters) > 1 else 'Truyện ngắn'], 'coverUrl': None, 'imageSourceUrl': None,
                'rights': {'basis': 'PUBLIC_DOMAIN_CC_BY_SA', 'source': source_url(title)},
                'importedAt': datetime.now(timezone.utc).isoformat(), 'chapters': chapters,
                'wordCount': sum(len(c['text'].split()) for c in chapters)}
            m.write_json(path, result)
            m.log(stage='wikisource-imported', title=title, chapters=len(chapters), words=result['wordCount'])
        except Exception as error:
            m.log(stage='wikisource-excluded', title=title, error=str(error))
            if isinstance(error, urllib.error.HTTPError) and error.code == 429:
                break  # Respect a persistent source-wide limit.


if __name__ == '__main__':
    main()
