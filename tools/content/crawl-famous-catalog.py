"""Import public catalog metadata, covers and official playback links.

No book text, transcripts, audio or video files are downloaded. Run from the
repository root. HTML is cached in the OS temp folder to avoid repeat requests.
"""
from __future__ import annotations

import concurrent.futures
import hashlib
import html
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import tempfile
import time
import unicodedata
import urllib.parse
import urllib.request
import urllib.error

ROOT = Path(__file__).resolve().parents[2]
CACHE = Path(tempfile.gettempdir()) / 'audio-writer-famous-catalog'
OUT = ROOT / 'apps/web/lib/famous-catalog.json'
COVERS = ROOT / 'apps/web/public/author-covers'
CACHE.mkdir(exist_ok=True)

AUTHORS = [
    {'id': 'nguyen-ngoc-ngan', 'name': 'Nguyễn Ngọc Ngạn', 'sourceUrl': 'https://www.youtube.com/@nguyenngocnganofficial', 'note': 'Truyện ma, truyện ngắn và truyện dài qua giọng đọc Nguyễn Ngọc Ngạn.', 'genres': ['tâm lý', 'tình cảm']},
    {'id': 'nguyen-nhat-anh', 'name': 'Nguyễn Nhật Ánh', 'sourceUrl': 'https://www.nxbtre.com.vn/tac-gia/nguyen-nhat-anh-3525.html', 'note': 'Tuổi học trò, ký ức tuổi thơ và những câu chuyện tình đầu.', 'genres': ['tuổi trẻ', 'tình cảm']},
    {'id': 'nguyen-ngoc-tu', 'name': 'Nguyễn Ngọc Tư', 'sourceUrl': 'https://www.nxbtre.com.vn/tac-gia/nguyen-ngoc-tu-3524.html', 'note': 'Thân phận con người, đời sống miền sông nước và những biến động trong tâm hồn.', 'genres': ['tâm lý', 'đời sống']},
    {'id': 'nguyen-huy-thiep', 'name': 'Nguyễn Huy Thiệp', 'sourceUrl': 'https://www.nxbtre.com.vn/tac-gia/nguyen-huy-thiep-4806.html', 'note': 'Truyện ngắn về con người và xã hội, với những góc nhìn sắc sảo.', 'genres': ['tâm lý', 'xã hội']},
    {'id': 'vu-trong-phung', 'name': 'Vũ Trọng Phụng', 'sourceUrl': 'https://fonos.vn/tac-gia/422/', 'note': 'Văn học hiện thực và trào phúng Việt Nam.', 'genres': ['trào phúng', 'xã hội']},
    {'id': 'thach-lam', 'name': 'Thạch Lam', 'sourceUrl': 'https://fonos.vn/sach-noi/viet-nam-danh-tac-ha-noi-bam-sau-pho-phuong-1682656479503/', 'note': 'Những trang văn về đời sống, con người và Hà Nội.', 'genres': ['đời sống', 'tùy bút']},
]


def fetch(url: str, *, binary: bool = False):
    key = hashlib.sha256(url.encode()).hexdigest()
    cached = CACHE / (key + ('.bin' if binary else '.html'))
    if cached.exists():
        data = cached.read_bytes()
    else:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'vi,en;q=0.8'})
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=30) as response:
                    data = response.read(3_000_001)
                    if len(data) > 3_000_000:
                        raise ValueError('Response larger than catalog metadata budget')
                cached.write_bytes(data)
                break
            except Exception as error:
                if isinstance(error, urllib.error.HTTPError) and error.code in (400, 401, 403, 404, 410):
                    raise
                if attempt == 2:
                    raise
                time.sleep(attempt + 1)
    return data if binary else data.decode('utf-8', errors='replace')


def slug(text: str) -> str:
    text = text.lower().replace('đ', 'd')
    text = ''.join(c for c in unicodedata.normalize('NFD', text) if not unicodedata.combining(c))
    return re.sub(r'[^a-z0-9]+', '-', text).strip('-')


def walk(value, key):
    if isinstance(value, dict):
        if key in value:
            yield value[key]
        for child in value.values():
            yield from walk(child, key)
    elif isinstance(value, list):
        for child in value:
            yield from walk(child, key)


def youtube_data(text: str):
    match = re.search(r'(?:var\s+)?ytInitialData\s*=\s*', text)
    if not match:
        raise ValueError('YouTube catalog data is missing')
    return json.JSONDecoder().raw_decode(text[match.end():])[0]


def youtube_catalog():
    playlists = [
        ('PLIOgUmbMyiK7efSkr5C7N1x2vyO9SARzD', ['kinh dị', 'huyền bí']),
        ('PLIOgUmbMyiK5JoM7ZVLneKAFxGU2v6gbc', ['tâm lý', 'tình cảm']),
        ('PLIOgUmbMyiK7bGPbtPpvbQy_l2L5YQhoC', ['tâm lý', 'tình cảm']),
        ('PLIOgUmbMyiK6HmR7HR_pEGwLxKe6ZUEkO', ['tâm lý', 'tình cảm']),
    ]
    candidates = {}
    for playlist_id, genres in playlists:
        url = f'https://www.youtube.com/playlist?list={playlist_id}'
        data = youtube_data(fetch(url))
        for video in walk(data, 'lockupViewModel'):
            if video.get('contentType') != 'LOCKUP_CONTENT_TYPE_VIDEO':
                continue
            video_id = video.get('contentId', '')
            title = video.get('metadata', {}).get('lockupMetadataViewModel', {}).get('title', {}).get('content', '')
            if not re.fullmatch(r'[\w-]{11}', video_id):
                continue
            if re.search(r'Paris By Night|PBN\s*\d|Phỏng vấn|sân\s+khấu|Mạnh Thường Quân|trích trong|[-–]\s*Phần\s*\d', title, re.I):
                continue
            clean = re.sub(r'\s*\(?Audio\s*book\s*\d+\)?', '', title, flags=re.I)
            clean = re.sub(r'Nguyễn Ngọc Ngạn|Thúy Nga|Truyện ma|Truyện ngắn', '', clean, flags=re.I)
            clean = re.sub(r'\s*[|–-]\s*', ' ', clean).strip(' |–-()')
            clean = re.sub(r'\s+', ' ', clean)
            if not clean:
                continue
            candidates.setdefault(slug(clean), {
                'id': f'nguyen-ngoc-ngan-{slug(clean)}', 'title': clean.title(),
                'authorId': 'nguyen-ngoc-ngan', 'genres': genres, 'format': 'audio',
                'sourceName': 'Nguyễn Ngọc Ngạn Official / Thúy Nga',
                'sourceUrl': f'https://www.youtube.com/watch?v={video_id}',
                'discoveredAt': url, 'sourceTitle': title, 'videoId': video_id,
                'imageSourceUrl': f'https://i.ytimg.com/vi/{video_id}/hqdefault.jpg',
            })
    # Verify channel ownership from each video's public oEmbed metadata.
    def verify(work):
        try:
            url = 'https://www.youtube.com/oembed?' + urllib.parse.urlencode({'url': work['sourceUrl'], 'format': 'json'})
            metadata = json.loads(fetch(url))
            owner = metadata.get('author_url', '').lower()
            if not any(name in owner for name in ['nguyenngocnganofficial', '/thuynga', 'ucbqff_lkqcgczw1lovicnzg']):
                print(json.dumps({'skipVideo': work['sourceUrl'], 'reason': 'channel verification'}, ensure_ascii=True), flush=True)
                return None
            return work
        except Exception as error:
            print(json.dumps({'skipVideo': work['sourceUrl'], 'error': str(error)}, ensure_ascii=True), flush=True)
            return None
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        return [work for work in pool.map(verify, candidates.values()) if work]


class Tags(HTMLParser):
    def __init__(self):
        super().__init__()
        self.anchors = []
        self.metas = {}

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'a':
            self.anchors.append(attrs)
        if tag == 'meta':
            self.metas[attrs.get('property', attrs.get('name', ''))] = attrs.get('content', '')


def publisher_candidates(text: str):
    # Every match is one visible catalog card, not a preview's page images.
    for match in re.finditer(r'<a\b([^>]*href=["\']/xem-them/(\d+)\.html["\'][^>]*)>(.*?)</a>', text, re.S | re.I):
        image = re.search(r'<img\b[^>]*>', match[3], re.I)
        if not image:
            continue
        attrs = dict(re.findall(r'([\w-]+)=["\']([^"\']*)["\']', image[0]))
        title = html.unescape(attrs.get('alt', '')).strip()
        if title:
            yield {'bookId': match[2], 'rawTitle': title, 'imageSourceUrl': urllib.parse.urljoin('https://www.nxbtre.com.vn', attrs.get('src', ''))}


def clean_book_title(title: str) -> str:
    title = re.sub(r'\([^)]*(?:bìa|đặc biệt|minh họa|tái bản|phiên bản|bình dân|in màu|khổ nhỏ|truyện dài|tập truyện ngắn|tản văn)[^)]*\)', '', title, flags=re.I)
    title = re.sub(r'\s*[:–-]?\s*(?:truyện dài|tập truyện ngắn|tản văn)\s*$', '', title, flags=re.I)
    title = re.sub(r'\s+', ' ', title).strip(' :–-')
    return title.title()


def publisher_catalog(author):
    pages = [author['sourceUrl']]
    # Older editions are found through the publisher's own visible pagination.
    if author['id'] == 'nguyen-nhat-anh':
        search_url = 'https://www.nxbtre.com.vn/tim-kiem?q=Nguyen+Nhat+Anh'
        text = fetch(search_url)
        links = Tags(); links.feed(text)
        pages.extend(urllib.parse.urljoin(search_url, anchor['href']) for anchor in links.anchors if re.search(r'/tim-kiem\?.*\bpage=\d+', anchor.get('href', '')))
        # The last-page link exposes the total; expand that bounded public list.
        last = max([int(re.search(r'page=(\d+)', url)[1]) for url in pages[1:]] or [1])
        pages.extend(search_url + f'&page={page}' for page in range(1, min(last, 18) + 1))
    candidates = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for url, text in zip(dict.fromkeys(pages), pool.map(fetch, dict.fromkeys(pages))):
            for candidate in publisher_candidates(text):
                candidate['discoveredAt'] = url
                title_key = slug(clean_book_title(candidate['rawTitle']))
                if re.search(r'combo|bộ hộp|hộp sách|sổ tay|two cats|the girl|ticket to|blue eyes|endless field|I am beto', candidate['rawTitle'], re.I):
                    continue
                candidates.setdefault(title_key, candidate)

    print(json.dumps({'author': author['name'], 'distinctCandidates': len(candidates)}, ensure_ascii=True), flush=True)

    def verify(candidate):
        raw_title = candidate['rawTitle']
        if re.search(r'combo|bộ hộp|hộp sách|sổ tay|two cats|the girl|ticket to|blue eyes|endless field|I am beto', raw_title, re.I):
            return None
        title = clean_book_title(raw_title)
        try:
            detail_url = f'https://www.nxbtre.com.vn/xem-them/{candidate["bookId"]}.html'
            text = fetch(detail_url)
            tags = Tags(); tags.feed(text)
            author_path = urllib.parse.urlparse(author['sourceUrl']).path
            if not any(anchor.get('href', '').split('?')[0] == author_path for anchor in tags.anchors):
                return None
            source_url = tags.metas.get('og:url')
            if not source_url or '/sach/' not in source_url:
                source_url = f'https://www.nxbtre.com.vn/sach/{slug(raw_title)}-{candidate["bookId"]}.html'
            source_url = source_url.replace('http://', 'https://')
            # A full publisher page is preferable to the quick-view fragment.
            full = fetch(source_url)
            if candidate['bookId'] not in full:
                source_url = detail_url
            genres = list(author['genres'])
            if 'lang biang' in slug(title).replace('-', ' '):
                genres = ['kỳ ảo', 'phiêu lưu']
            if re.search(r'tản văn|tạp văn|tùy bút', raw_title, re.I):
                genres = ['tản văn', 'đời sống']
            return {
                'id': author['id'] + '-' + slug(title), 'title': title,
                'authorId': author['id'], 'genres': genres, 'format': 'book',
                'sourceName': 'NXB Trẻ', 'sourceUrl': source_url,
                'discoveredAt': candidate['discoveredAt'], 'sourceTitle': raw_title,
                'imageSourceUrl': candidate['imageSourceUrl'],
            }
        except Exception as error:
            print(json.dumps({'skipBook': candidate['bookId'], 'error': str(error)}, ensure_ascii=True), flush=True)
            return None

    works = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for index, work in enumerate(pool.map(verify, candidates.values()), 1):
            if work:
                works.setdefault(work['id'], work)
            if index % 10 == 0:
                print(json.dumps({'author': author['name'], 'checked': index, 'kept': len(works)}, ensure_ascii=True), flush=True)
    return list(works.values())


def fonos_catalog():
    # Direct primary-source book pages, each with its own author metadata.
    urls = [
        ('vu-trong-phung', 'https://fonos.vn/tac-gia/422/'),
        ('thach-lam', AUTHORS[-1]['sourceUrl']),
    ]
    result = []
    for author_id, source in urls:
        text = fetch(source)
        tags = Tags(); tags.feed(text)
        pages = [source] if '/sach-noi/' in source else list(dict.fromkeys(
            urllib.parse.urljoin(source, anchor['href']) for anchor in tags.anchors if '/sach-noi/' in anchor.get('href', '')
        ))
        for url in pages:
            body = fetch(url); parsed = Tags(); parsed.feed(body)
            h1 = re.search(r'<h1\b[^>]*>(.*?)</h1>', body, re.S)
            if not h1:
                continue
            title = html.unescape(re.sub('<[^>]+>', '', h1[1])).strip()
            title = re.sub(r'^Việt Nam Danh Tác:\s*', '', title, flags=re.I)
            author = next(author for author in AUTHORS if author['id'] == author_id)
            if author['name'] not in html.unescape(re.sub('<[^>]+>', ' ', body[h1.end():h1.end() + 8000])):
                continue
            image = parsed.metas.get('og:image')
            book_id = re.search(r'/books/([^/]+)/', image or '')
            if book_id:
                for encoded in re.findall(r'/_next/image/\?url=([^&"<>\s]+)', body):
                    actual = urllib.parse.unquote(html.unescape(encoded))
                    if f'/books/{book_id[1]}/coverImage/' in actual:
                        image = actual
                        break
            if image:
                result.append({'id': author_id + '-' + slug(title), 'title': title, 'authorId': author_id,
                    'genres': author['genres'], 'format': 'audio', 'sourceName': 'Fonos',
                    'sourceUrl': url, 'discoveredAt': source, 'sourceTitle': title, 'imageSourceUrl': image})
    return result


def cover(work):
    try:
        data = fetch(work['imageSourceUrl'], binary=True)
        if not (data.startswith(b'\xff\xd8') or data.startswith(b'\x89PNG') or data.startswith(b'GIF8') or data[8:12] == b'WEBP'):
            raise ValueError('Not a supported thumbnail')
        extension = 'png' if data.startswith(b'\x89PNG') else 'gif' if data.startswith(b'GIF8') else 'webp' if data[8:12] == b'WEBP' else 'jpg'
        name = work['id'][:160] + '.' + extension
        (COVERS / name).write_bytes(data)
        work['coverUrl'] = '/author-covers/' + name
    except Exception as error:
        work['coverUrl'] = None
        print(json.dumps({'coverUnavailable': work['id'], 'error': str(error)}, ensure_ascii=True), flush=True)
    return work


def main():
    works = youtube_catalog()
    print(json.dumps({'author': AUTHORS[0]['name'], 'works': len(works)}, ensure_ascii=True), flush=True)
    for author in AUTHORS[1:4]:
        imported = publisher_catalog(author)
        works.extend(imported)
        print(json.dumps({'author': author['name'], 'works': len(imported)}, ensure_ascii=True), flush=True)
    try:
        works.extend(fonos_catalog())
    except Exception as error:
        print(json.dumps({'sourceUnavailable': 'Fonos', 'error': str(error)}, ensure_ascii=True), flush=True)
    works = list({work['id']: work for work in works}.values())
    if sum(work['authorId'] == 'nguyen-ngoc-ngan' for work in works) < 15:
        raise ValueError('Required Nguyễn Ngọc Ngạn shelf was not verified')
    COVERS.mkdir(exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        works = list(pool.map(cover, works))
    catalog = {'checkedAt': time.strftime('%Y-%m-%d'), 'authors': AUTHORS, 'works': works}
    temporary = OUT.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(OUT)
    print(json.dumps({'totalWorks': len(works), 'authors': len(AUTHORS), 'covers': sum(bool(work['coverUrl']) for work in works)}, ensure_ascii=True), flush=True)


if __name__ == '__main__':
    main()
