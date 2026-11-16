"""Owner-authorized Chinese/Zhihu fiction import from MonkeyD and Mê Truyện.

Rights to republish text and audio were explicitly confirmed on 2026-11-16.
This importer reads public complete texts, preserves attribution and source
rankings, and uses the app's Edge TTS pipeline. It does not bypass MonkeyD's
advertisement gate to retrieve recordings, log in, or click advertisements.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
from datetime import datetime, timezone
from hashlib import sha256
import html as html_entities
import importlib.util
import json
from pathlib import Path
import re
import tempfile
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

try:
    import truststore
    truststore.inject_into_ssl()
except ImportError:
    pass
try:
    import requests
except ImportError:
    requests = None

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'apps/api/prisma/chinese-stories'
CACHE = Path(tempfile.gettempdir()) / 'audio-writer-chinese-stories'
spec = importlib.util.spec_from_file_location('source_html', Path(__file__).with_name('text-source.py'))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)
spec = importlib.util.spec_from_file_location('native_review', Path(__file__).with_name('finalize-native-texts.py'))
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)
HOSTS = {'www.monkeydd.com', 'monkeydd.com', 'metruyen.fit'}
# Reviewed same-plot editions: openings, characters and endings were compared.
# Keep the credited Mê Truyện translation of Phi tâm kế and the higher-ranked
# MonkeyD translation of Hạ xuân hảo; generic shared titles remain distinct.
DUPLICATE_EDITION_OF = {
    'monkeyd-phi-tam-ke': 'metruyen-phi-tam-ke',
    'monkeyd-ha-xuan-hao': 'monkeyd-ha-xuan-hao-lade',
}
rate_lock = threading.Lock()
last_request = 0.0
pause_until = 0.0
thread_state = threading.local()


def read_response(url):
    if requests is None:
        request = urllib.request.Request(url, headers={'User-Agent': 'AudioWriterLibrary/1.0 (owner-authorized text import; two concurrent requests)'})
        with urllib.request.urlopen(request, timeout=50) as response:
            if urllib.parse.urlparse(response.url).hostname not in HOSTS:
                raise ValueError('Unexpected source redirect')
            return response.read(8_000_001)
    if not hasattr(thread_state, 'session'):
        thread_state.session = requests.Session()
        thread_state.session.headers['User-Agent'] = 'AudioWriterLibrary/1.0 (owner-authorized text import; two concurrent requests)'
    current = url
    for _ in range(5):
        parsed = urllib.parse.urlparse(current)
        if parsed.scheme != 'https' or parsed.hostname not in HOSTS:
            raise ValueError('Unexpected source redirect')
        try:
            with thread_state.session.get(current, timeout=(15, 50), stream=True, allow_redirects=False) as response:
                if response.status_code in {301, 302, 303, 307, 308}:
                    current = urllib.parse.urljoin(current, response.headers['Location'])
                    continue
                if response.status_code >= 400:
                    raise urllib.error.HTTPError(current, response.status_code, response.reason, response.headers, None)
                parts, size = [], 0
                for chunk in response.iter_content(65536):
                    size += len(chunk)
                    if size > 8_000_000:
                        raise ValueError('Source response too large')
                    parts.append(chunk)
                return b''.join(parts)
        except requests.RequestException as error:
            raise OSError(str(error)) from error
    raise ValueError('Too many source redirects')


def log(**value):
    print(json.dumps(value, ensure_ascii=True), flush=True)


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    tmp.replace(path)


def fetch(url, binary=False):
    global last_request, pause_until
    url = urllib.parse.quote(url, safe=':/?&=%+#@;,')
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != 'https' or parsed.hostname not in HOSTS:
        raise ValueError('Unapproved public source: ' + url)
    cache = CACHE / (sha256(url.encode()).hexdigest() + ('.bin' if binary else '.html'))
    if cache.exists():
        data = cache.read_bytes()
        if binary or b'</html>' in data[-10000:].lower():
            return data if binary else data.decode('utf-8-sig')
    for attempt in range(4):
        with rate_lock:
            delay = max(0, .65 - (time.monotonic() - last_request), pause_until - time.monotonic())
            if delay:
                time.sleep(delay)
            last_request = time.monotonic()
        try:
            data = read_response(url)
            if len(data) > 8_000_000:
                raise ValueError('Source response too large')
            temporary = cache.with_suffix(cache.suffix + '.tmp')
            temporary.write_bytes(data)
            temporary.replace(cache)
            return data if binary else data.decode('utf-8-sig')
        except urllib.error.HTTPError as error:
            if error.code in {400, 401, 403, 404, 410} or attempt == 3:
                raise
            if error.code == 429:
                retry = error.headers.get('Retry-After', '')
                with rate_lock:
                    pause_until = time.monotonic() + max(60, int(retry) if retry.isdigit() else 60)
                log(stage='source-rate-pause', source=parsed.hostname, seconds=60)
        except (OSError, TimeoutError):
            if attempt == 3:
                raise
        time.sleep(2 ** (attempt + 1))


def document(url):
    raw = fetch(url)
    return h.Document(raw).root, raw


def fold(value):
    value = h.clean_text(value).lower().replace('đ', 'd')
    value = ''.join(c for c in unicodedata.normalize('NFD', value) if not unicodedata.combining(c))
    return re.sub(r'[^a-z0-9]+', ' ', value).strip()


def clean_title(value):
    value = re.sub(r'^(?:FULL|TRUYỆN DÀI|TRUYỆN NGẮN)\s*[:\-–]?\s*', '', h.clean_text(value), flags=re.I)
    return value.capitalize() if value.isupper() else value


def stable_id(key):
    data = bytearray(sha256(('audio-writer:chinese-stories:v1:' + key).encode()).digest()[:16])
    data[6] = (data[6] & 15) | 80
    data[8] = (data[8] & 63) | 128
    value = data.hex()
    return f'{value[:8]}-{value[8:12]}-{value[12:16]}-{value[16:20]}-{value[20:]}'


def discover_monkey():
    root, _ = document('https://www.monkeydd.com/')
    found = {}
    for period in ['year', 'month', 'week', 'day']:
        table = root.one(id='top-' + period)
        if not table:
            continue
        for rank, item in enumerate(table.all(cls='top-item'), 1):
            link = next((a for a in item.all(tag='a') if h.plain(a) and re.fullmatch(r'/[^/]+\.html', urllib.parse.urlparse(a.attrs.get('href', '')).path)), None)
            if not link:
                continue
            url = link.attrs['href']
            found.setdefault(url, {'key': 'monkeyd-' + urllib.parse.urlparse(url).path[1:-5],
                'sourceId': 'monkeyd', 'sourceName': 'MonkeyD', 'sourceUrl': url,
                'title': clean_title(h.plain(link)),
                'popularity': {'kind': 'source-period-ranking', 'period': period, 'rank': rank, 'url': 'https://www.monkeydd.com/#top-' + period}})
    log(stage='monkey-ranked', candidates=len(found))
    return list(found.values())


def discover_me(pages):
    found = {}
    for page in range(1, pages + 1):
        url = 'https://metruyen.fit/' + (f'page/{page}/' if page > 1 else '') + '?s=&post_type=wp-manga&m_orderby=views'
        root, _ = document(url)
        cards = list(root.all(cls='c-tabs-item__content'))
        if not cards:
            break
        for index, card in enumerate(cards):
            node = card.one(cls='post-title')
            link = node.one(tag='a') if node else None
            status = card.one(cls='mg_status')
            if not link or not status or 'completed' not in fold(h.plain(status)):
                continue
            genres = [h.plain(a) for a in card.all(tag='a') if '/the-loai/' in a.attrs.get('href', '')]
            if any(re.search(r'\b(?:18|r18|adult|ecchi|hentai|cao h|caoh|smut|sac)\b', fold(g)) for g in genres):
                continue
            source = link.attrs['href']
            slug = urllib.parse.urlparse(source).path.strip('/').split('/')[-1]
            found.setdefault(source, {'key': 'metruyen-' + slug, 'sourceId': 'metruyen', 'sourceName': 'Mê Truyện',
                'sourceUrl': source, 'title': clean_title(h.plain(link)), 'sourceGenres': genres,
                'popularity': {'kind': 'source-most-views', 'rank': (page - 1) * 12 + index + 1, 'url': url}})
        log(stage='me-ranked', page=page, candidates=len(found))
    return list(found.values())


def visible_monkey_text(node, raw):
    # Public pages render some words with CSS ::before. Preserve those visible
    # words; never import the incomplete textContent of empty styled spans.
    pattern = r'\.([a-z][\w-]+)::?before\s*\{\s*content\s*:\s*([\"\'])(.*?)\2\s*;?\s*\}'
    mapping = {}
    for match in re.finditer(pattern, raw, re.S):
        value = re.sub(r'\\([0-9a-fA-F]{1,6})\s?', lambda m: chr(int(m[1], 16)), match[3])
        value = re.sub(r'\\([\\\"\'])', r'\1', value)
        mapping[match[1]] = html_entities.unescape(value)
    for span in node.all(tag='span'):
        if span.children:
            continue
        classes = span.attrs.get('class', '').split()
        for name in classes:
            if name in mapping:
                span.children.append(mapping[name])
                break
        else:
            if any(re.fullmatch(r'[a-z]-[0-9a-f]{32}', name) for name in classes):
                raise ValueError('Unresolved visible source word')
    return h.clean_text(node.text(blocks=True))


def metadata(root, label):
    for row in root.all(cls='post-content_item'):
        heading = row.one(cls='summary-heading')
        if heading and fold(h.plain(heading)) == fold(label):
            return h.plain(row.one(cls='summary-content'))
    return ''


def monkey_metadata(root, label):
    for term in root.all(tag='dt'):
        if fold(h.plain(term)) == fold(label):
            siblings = [x for x in term.parent.children if isinstance(x, h.Node)]
            index = siblings.index(term)
            if index + 1 < len(siblings) and siblings[index + 1].tag == 'dd':
                return siblings[index + 1]
    return None


def image(root, source_id):
    og = next((n.attrs.get('content') for n in root.all(tag='meta') if n.attrs.get('property') == 'og:image'), None)
    if og:
        return og
    container = root.one(cls='summary_image') if source_id == 'metruyen' else root.one(cls='single-story-img')
    if source_id == 'monkeyd':
        # Detail cover is distinct from the small recommendation sliders.
        title = root.one(tag='h1')
        for img in root.all(tag='img'):
            alt = clean_title(img.attrs.get('alt', ''))
            if title and alt and fold(alt) == fold(clean_title(h.plain(title))):
                return img.attrs.get('data-src') or img.attrs.get('src')
    img = container.one(tag='img') if container else None
    return (img.attrs.get('data-src') or img.attrs.get('src')) if img else None


def download_cover(work, source):
    if not source:
        return None
    source = urllib.parse.urljoin(work['sourceUrl'], source)
    if urllib.parse.urlparse(source).hostname not in HOSTS:
        return None
    try:
        data = fetch(source, binary=True)
        ext = '.jpg' if data.startswith(b'\xff\xd8\xff') else '.png' if data.startswith(b'\x89PNG\r\n\x1a\n') else '.webp' if data.startswith(b'RIFF') and data[8:12] == b'WEBP' else None
        if not ext or len(data) < 1500:
            return None
        name = sha256(work['key'].encode()).hexdigest()[:24] + ext
        target = ROOT / 'apps/web/public/chinese-covers' / name
        target.write_bytes(data)
        return '/chinese-covers/' + name
    except Exception as error:
        log(stage='cover-warning', key=work['key'], error=str(error))
        return None


def genres_for(source):
    mapping = {'trong sinh': 'Trùng sinh', 'trung sinh': 'Trùng sinh', 'tra thu': 'Báo thù', 'bao thu': 'Báo thù',
        'hao mon the gia': 'Hào môn', 'hao mon': 'Hào môn', 'tong tai': 'Tổng tài', 'sang van': 'Sảng văn', 'va mat': 'Vả mặt',
        'tra xanh': 'Trà xanh', 'xuyen sach': 'Xuyên sách', 'xuyen khong': 'Xuyên không', 'nu cuong': 'Nữ cường',
        'co dai': 'Cổ đại', 'hien dai': 'Hiện đại', 'cung dau': 'Cung đấu', 'ngon tinh': 'Ngôn tình',
        'gia dinh': 'Gia đình', 'tinh cam gia dinh': 'Gia đình', 'doc tam': 'Đọc tâm', 'gia dau': 'Gia đấu',
        'kinh di': 'Kinh dị', 'linh di': 'Linh dị', 'hai huoc': 'Hài hước', 'guong vo khong lanh': 'Gương vỡ không lành',
        'guong vo lai lanh': 'Gương vỡ lại lành', 'huyen huyen': 'Huyền huyễn', 'tu tien': 'Tu tiên', 'do thi': 'Đô thị',
        'he thong': 'Hệ thống', 'ngot sung': 'Ngọt sủng', 'sung': 'Sủng', 'nguoc': 'Ngược', 'hoc duong': 'Học đường',
        'thanh xuan vuon truong': 'Thanh xuân vườn trường', 'dam my': 'Đam mỹ', 'bach hop': 'Bách hợp'}
    result = ['Truyện Trung']
    for genre in source:
        normalized = mapping.get(fold(genre))
        if normalized and normalized not in result:
            result.append(normalized)
    return result


def ordered_source_urls(urls):
    """Validate ordinary chapter sequences and retain source appendix order."""
    numbers = [re.search(r'/chuong-(\d+)(?:/|\.html)?$', urllib.parse.urlparse(url).path) for url in urls]
    if numbers and all(numbers):
        values = [int(match[1]) for match in numbers]
        if min(values) not in {0, 1} or len(set(values)) != len(values) or sorted(values) != list(range(min(values), max(values) + 1)):
            raise ValueError('Public source contents has a missing or repeated chapter number')
        return [url for _, url in sorted(zip(values, urls))]
    known = [int(match[1]) for match in numbers if match]
    return list(reversed(urls)) if len(known) > 1 and known[0] > known[-1] else urls


def validate_cached_work(work):
    groups = []
    for chapter in work['chapters']:
        if groups and groups[-1][0]['sourceUrl'] == chapter['sourceUrl']:
            groups[-1].append(chapter)
        else:
            groups.append([chapter])
    urls = [group[0]['sourceUrl'] for group in groups]
    ordered = ordered_source_urls(urls)
    by_url = {group[0]['sourceUrl']: group for group in groups}
    work['chapters'] = [chapter for url in ordered for chapter in by_url[url]]
    return work


def import_work(work):
    path = OUTPUT / (work['key'] + '.json')
    if path.exists():
        cached = validate_cached_work(json.loads(path.read_text(encoding='utf-8')))
        return cached
    root, raw = document(work['sourceUrl'])
    if work['sourceId'] == 'metruyen':
        name = h.plain(root.one(tag='h1'))
        if fold(clean_title(name)) != fold(work['title']):
            raise ValueError('Detail title does not match ranked work')
        chapters_root = root.one(cls='listing-chapters_wrap')
        links = list(chapters_root.all(tag='a')) if chapters_root else []
        source_chapters = list(dict.fromkeys(a.attrs['href'] for a in reversed(links) if a.attrs.get('href', '').startswith(work['sourceUrl'])))
        titles = {a.attrs['href']: h.plain(a) for a in links if a.attrs.get('href')}
        if not source_chapters:
            raise ValueError('Complete public table of contents is not available')
        author = h.plain(root.one(cls='author-content')) or 'Khuyết danh'
        translator = h.plain(root.one(cls='artist-content'))
        genre_node = root.one(cls='genres-content')
        source_genres = [h.plain(a) for a in genre_node.all(tag='a')] if genre_node else work.get('sourceGenres', [])
        synopsis = h.plain(root.one(cls='summary__content'))
    else:
        status = h.plain(monkey_metadata(root, 'Trạng thái'))
        if 'du bo' not in fold(status) and 'hoan thanh' not in fold(status):
            raise ValueError('Ranked MonkeyD story is still ongoing')
        chapter_node = root.one(cls='list-chapters')
        links = list(chapter_node.all(tag='a')) if chapter_node else []
        source_chapters = list(dict.fromkeys(a.attrs['href'] for a in reversed(links) if re.search(r'/[^/]+/[^/]+\.html$', a.attrs.get('href', ''))))
        titles = {a.attrs['href']: h.plain(a).split('\n')[0] for a in links if a.attrs.get('href')}
        if not source_chapters:
            raise ValueError('No public text chapters')
        author = h.plain(monkey_metadata(root, 'Tác giả')) or 'Khuyết danh'
        translator = h.plain(monkey_metadata(root, 'Team'))
        source_genres = [h.plain(a) for a in monkey_metadata(root, 'Thể loại').all(tag='a')]
        synopsis_node = root.one(cls='story-description')
        synopsis = visible_monkey_text(synopsis_node, raw) if synopsis_node else ''
    # Preserve full chapters from the advertised source contents; never save a
    # partially downloaded book under a COMPLETE status.
    source_chapters = ordered_source_urls(source_chapters)
    chapters = []
    for url in source_chapters:
        chapter_root, chapter_raw = document(url)
        if work['sourceId'] == 'metruyen':
            content = chapter_root.one(cls='reading-content')
            node = content.one(cls='text-left') if content else None
            text = h.clean_text(node.text(blocks=True)) if node else ''
        else:
            node = chapter_root.one(id='chapter-content-render')
            text = visible_monkey_text(node, chapter_raw) if node else ''
        if len(text.split()) < 8 or '\ufffd' in text:
            raise ValueError('Empty, gated or damaged source chapter: ' + url)
        if re.search(r'đăng nhập.{0,60}(đọc|mở khóa)|mua chương|không có quyền đọc', text[:500], re.I):
            raise ValueError('Source chapter requires additional access')
        chapters.append({'title': titles[url] or f'Chương {len(chapters) + 1}', 'text': text, 'sourceUrl': url,
            'sha256': sha256(text.encode()).hexdigest()})
    hashes = [c['sha256'] for c in chapters]
    if len(hashes) != len(set(hashes)):
        raise ValueError('Source contains identical chapter bodies; needs review')
    if len(chapters) == 1 and len(chapters[0]['text'].split()) < 400:
        raise ValueError('Too little source text for a complete story')
    imported = datetime.now(timezone.utc).isoformat()
    source = {'authorId': 'cn-' + fold(author).replace(' ', '-')[:65], 'authorName': author,
        'name': work['sourceName'], 'url': work['sourceUrl'], 'importedAt': imported,
        'collectionId': 'chinese-drama', 'translator': translator or None,
        'changes': 'Chuẩn hóa bố cục và chia phần đọc dài; giữ nguyên nội dung.'}
    source_image = image(root, work['sourceId'])
    normalized_genres = genres_for(source_genres)
    if 'tra xanh' in fold(work['title'] + ' ' + synopsis) and 'Trà xanh' not in normalized_genres:
        normalized_genres.append('Trà xanh')
    if any(fold(g) == 'zhihu' for g in source_genres):
        normalized_genres.append('Zhihu')
    result = {**work, 'storyId': stable_id(work['key']), 'branchId': stable_id(work['key'] + ':main'),
        'title': clean_title(work['title']), 'authorName': author, 'authorId': source['authorId'], 'translator': translator,
        'sourceGenres': source_genres, 'genres': normalized_genres,
        'synopsis': synopsis[:1400].strip() if synopsis else f"{work['title']} — truyện Trung được tuyển từ {work['sourceName']}.",
        'sourceChapterCount': len(chapters), 'chapters': review.reading_parts(chapters),
        'wordCount': sum(len(c['text'].split()) for c in chapters), 'textSource': source,
        'coverUrl': download_cover(work, source_image), 'imageSourceUrl': source_image,
        'rights': {'basis': 'OWNER_AUTHORIZATION', 'confirmedAt': '2026-11-16', 'scope': 'Full-text and audio republication'},
        'narration': {'provider': 'edge', 'sourceRecordingImported': False},
        'importedAt': imported, 'sourceHtmlSha256': sha256(raw.encode()).hexdigest()}
    write_json(path, result)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--target', type=int, default=500)
    parser.add_argument('--pages', type=int, default=60)
    parser.add_argument('--discover-only', action='store_true')
    args = parser.parse_args()
    CACHE.mkdir(exist_ok=True)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (ROOT / 'apps/web/public/chinese-covers').mkdir(exist_ok=True)
    discovery = OUTPUT / 'discovered.json'
    if discovery.exists():
        candidates = json.loads(discovery.read_text(encoding='utf-8'))
    else:
        monkeys = discover_monkey()
        mes = discover_me(args.pages)
        candidates = []
        # Each source retains its own actual ranking. Interleave sources;
        # do not invent comparable cross-site view totals or popularity scores.
        while monkeys or mes:
            if monkeys:
                candidates.append(monkeys.pop(0))
            candidates.extend(mes[:12])
            mes = mes[12:]
        write_json(discovery, candidates)
    candidates = [w for w in candidates if w['key'] not in DUPLICATE_EDITION_OF]
    log(stage='discovered', candidates=len(candidates), target=args.target)
    if args.discover_only:
        return
    successes, failures, duplicate_texts = {}, [], []
    text_keys = set()
    iterator = iter(enumerate(candidates))
    with ThreadPoolExecutor(max_workers=2) as pool:
        pending = {}
        for index, work in list(next(iterator, None) for _ in range(2)):
            pending[pool.submit(import_work, work)] = (index, work)
        while pending:
            ready, _ = wait(pending, return_when=FIRST_COMPLETED)
            for future in ready:
                index, work = pending.pop(future)
                try:
                    result = future.result()
                    fingerprint = sha256(re.sub(r'\s+', ' ', ' '.join(c['text'] for c in result['chapters'])).encode()).hexdigest()
                    if fingerprint in text_keys:
                        duplicate_texts.append(work['key'])
                        log(stage='duplicate-text', key=work['key'])
                    else:
                        text_keys.add(fingerprint)
                        successes[index] = result
                        log(stage='imported', key=work['key'], stories=len(successes), chapters=len(result['chapters']), words=result['wordCount'])
                except Exception as error:
                    failures.append({'key': work['key'], 'title': work['title'], 'sourceUrl': work['sourceUrl'], 'error': str(error)})
                    log(stage='excluded', **failures[-1])
                if len(successes) < args.target:
                    next_item = next(iterator, None)
                    if next_item:
                        next_index, next_work = next_item
                        pending[pool.submit(import_work, next_work)] = (next_index, next_work)
            if len(successes) >= args.target:
                # At most the other active download finishes. Its manuscript
                # stays cached, but only the first target ranked stories enter.
                for future in pending:
                    future.cancel()
                break
        for future, (index, work) in pending.items():
            if future.cancelled():
                continue
            try:
                result = future.result()
                fingerprint = sha256(re.sub(r'\s+', ' ', ' '.join(c['text'] for c in result['chapters'])).encode()).hexdigest()
                if fingerprint not in text_keys:
                    text_keys.add(fingerprint)
                    successes[index] = result
            except Exception as error:
                failures.append({'key': work['key'], 'title': work['title'], 'sourceUrl': work['sourceUrl'], 'error': str(error)})
    selected = [work for _, work in sorted(successes.items())][:args.target]
    write_json(OUTPUT / 'manifest.json', {'keys': [w['key'] for w in selected], 'target': args.target,
        'counts': {'works': len(selected), 'chapters': sum(len(w['chapters']) for w in selected), 'words': sum(w['wordCount'] for w in selected)},
        'duplicates': duplicate_texts, 'failures': failures})
    log(stage='complete', works=len(selected), chapters=sum(len(w['chapters']) for w in selected), words=sum(w['wordCount'] for w in selected), failures=len(failures))


if __name__ == '__main__':
    main()
