"""Import complete, publicly readable texts for the three authorized authors.

The site owner confirmed republication rights for these authors on 2026-11-15.
This is an allowlist, not a general-purpose copyright/license inference.
Downloads are cached, rate-limited and resumable; no login or paywall bypass.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from hashlib import sha256
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

spec = importlib.util.spec_from_file_location("text_source", Path(__file__).with_name("text-source.py"))
html = importlib.util.module_from_spec(spec)
spec.loader.exec_module(html)
ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "apps/api/prisma/native-texts"
CACHE = Path(tempfile.gettempdir()) / "audio-writer-native-texts"
BASE = "https://vnthuquan.net"
SOURCE_HOSTS = {"vnthuquan.net", "thuvien.vnthuquan.net", "vietnamthuquan.eu", "thuvien.vietnamthuquan.eu"}
AUTHORS = [
    {"id": "nguyen-nhat-anh", "name": "Nguyễn Nhật Ánh", "slug": "nguyen-nhat-anh-434"},
    {"id": "nguyen-ngoc-tu", "name": "Nguyễn Ngọc Tư", "slug": "nguyen-ngoc-tu-432"},
    {"id": "nguyen-huy-thiep", "name": "Nguyễn Huy Thiệp", "slug": "nguyen-huy-thiep-416"},
]
lock = threading.Lock()
last_request = 0.0
# Reviewed source mistakes: a complete short story is entered twice, or the
# final Bêtô section (81–102, including its dated ending) appears twice.
# Differently titled chapters with identical bodies remain excluded.
REVIEWED_DUPLICATE_CHAPTERS = {1030, 1461, 3420, 9605, 13003}


def log(**value):
    print(json.dumps(value, ensure_ascii=True), flush=True)


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def fetch(url, binary=False):
    global last_request
    url = urllib.parse.quote(url, safe=":/?&=%+#@;,")
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or parsed.hostname not in SOURCE_HOSTS:
        raise ValueError("Only the explicitly selected public source is allowed: " + url)
    path = CACHE / (sha256(url.encode()).hexdigest() + (".bin" if binary else ".html"))
    if path.exists():
        data = path.read_bytes()
        return data if binary else data.decode("utf-8")
    for attempt in range(3):
        with lock:
            delay = max(0, 0.65 - (time.monotonic() - last_request))
            if delay:
                time.sleep(delay)
            last_request = time.monotonic()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "AudioWriterLibrary/1.0 (authorized text archive; two concurrent requests)"})
            with urllib.request.urlopen(req, timeout=50) as response:
                if urllib.parse.urlparse(response.url).hostname not in SOURCE_HOSTS:
                    raise ValueError("Unexpected source redirect")
                data = response.read(8_000_001)
            if len(data) > 8_000_000:
                raise ValueError("Source response is too large")
            path.write_bytes(data)
            return data if binary else data.decode("utf-8-sig")
        except urllib.error.HTTPError as error:
            if error.code in {400, 401, 403, 404, 410}:
                raise
            if attempt == 2:
                raise
        except (OSError, TimeoutError):
            if attempt == 2:
                raise
        time.sleep(2 ** (attempt + 1))


def document(url):
    raw = fetch(url)
    return html.Document(raw).root, raw


def folded(value):
    value = html.clean_text(value).lower().replace("đ", "d")
    value = "".join(c for c in unicodedata.normalize("NFD", value) if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", value).strip()


def stable_id(key):
    data = bytearray(sha256(("audio-writer:native-texts:v1:" + key).encode()).digest()[:16])
    data[6] = (data[6] & 15) | 80
    data[8] = (data[8] & 63) | 128
    h = data.hex()
    return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}"


def discover(author):
    url = f"{BASE}/Truyen/TacGia/{author['slug']}"
    root, _ = document(url)
    pages = [int(n) for a in root.all(tag="a") for n in re.findall(r"/Trang-(\d+)$", a.attrs.get("href", "")) if author["slug"] in a.attrs.get("href", "")]
    works = {}
    for page in range(1, max(pages, default=1) + 1):
        if page > 1:
            # The same public partial the author's page uses for pagination.
            root, _ = document(f"{url}/DanhSachAjax?trang=Trang-{page}")
        for card in root.all(cls="vntq-tg-card"):
            title_node = card.one(cls="vntq-tg-title")
            link = title_node.one(tag="a") if title_node else None
            if not link or not link.attrs.get("href", "").startswith("/TacPham/"):
                continue  # Audio/PDF/EPUB-only catalog records are not full text.
            href = link.attrs["href"]
            source_id = re.search(r"-(\d+)/?$", href).group(1)
            image = card.one(cls="vntq-tg-cover").one(tag="img")
            meta = html.plain(card.one(cls="vntq-tg-meta"))
            count = re.search(r"(\d+)\s+chương", meta, re.I)
            genre = html.plain(card.one(cls="vntq-tg-genre"))
            title = html.plain(link)
            if title.isupper():
                title = title.capitalize()
            works[source_id] = {
                "key": f"vntq-{source_id}", "sourceId": int(source_id),
                "authorId": author["id"], "authorName": author["name"],
                "authorSourceUrl": url, "title": title,
                "genres": [genre or "Văn học Việt Nam"],
                "sourceUrl": BASE + href, "sourceName": "Việt Nam Thư Quán",
                "expectedChapters": int(count.group(1)) if count else None,
                "imageSourceUrl": urllib.parse.urljoin(BASE, image.attrs["src"]) if image else None,
            }
        log(stage="discover", author=author["id"], page=page, works=len(works))
    return list(works.values())


def cover(work, root):
    node = root.one(cls="vntq-large-cover-box")
    image = node.one(tag="img") if node else None
    source = urllib.parse.urljoin(BASE, image.attrs.get("src", "")) if image else work.get("imageSourceUrl")
    if not source or "/userfiles/" not in source.lower() or "defaultcover" in source.lower():
        return None, None
    try:
        data = fetch(source, binary=True)
        ext = ".jpg" if data.startswith(b"\xff\xd8\xff") else ".png" if data.startswith(b"\x89PNG\r\n\x1a\n") else ".webp" if data.startswith(b"RIFF") and data[8:12] == b"WEBP" else ".gif" if data.startswith(b"GIF8") else None
        if not ext or len(data) < 1000:
            return None, None
        target = ROOT / "apps/web/public/author-covers" / (work["key"] + ext)
        target.write_bytes(data)
        return "/author-covers/" + target.name, source
    except Exception as error:
        log(stage="cover-warning", key=work["key"], error=str(error))
        return None, None


def get_text(root):
    node = root.one(id="vntqTextContent")
    if not node:
        raise ValueError("No public full-text body")
    text = html.clean_text(node.text(blocks=True))
    if not text or "\ufffd" in text:
        raise ValueError("Empty or damaged Unicode text")
    return text


def import_work(work):
    path = OUTPUT / (work["key"] + ".json")
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    root, raw = document(work["sourceUrl"])
    author = root.one(cls="vntq-author-top")
    if not author or folded(html.plain(author)) != folded(work["authorName"]):
        raise ValueError("Source author does not match the rights allowlist")
    toc = {int(re.search(r"/chuong-(\d+)$", a.attrs["href"]).group(1)): {"title": html.plain(a), "url": BASE + a.attrs["href"]}
           for a in root.all(cls="vntq-toc-item")}
    select = root.one(id="vntqTocSelect")
    options = list(select.all(tag="option")) if select else []
    for option in options:
        page = int(option.attrs["value"])
        if page == 1:
            continue
        data = json.loads(fetch(f"{BASE}/api/tacpham/get-mucluc?tuaId={work['sourceId']}&page={page}&pageSize=100"))
        if not data.get("success"):
            raise ValueError("Unable to read complete source contents")
        for chapter in data["chapters"]:
            number = chapter["chuongId"]
            toc[number] = {"title": html.clean_text(chapter.get("title") or ""), "url": work["sourceUrl"].rstrip("/") + f"/chuong-{number}"}
    expected = work["expectedChapters"]
    if not toc or (expected and len(toc) != expected):
        raise ValueError(f"Incomplete source contents: expected {expected}, found {len(toc)}")
    current_match = re.search(r"const currentChuongId\s*=\s*(\d+)", raw)
    current = int(current_match.group(1)) if current_match else min(toc)
    chapters = []
    for number, entry in sorted(toc.items()):
        chapter_root = root if number == current else document(entry["url"])[0]
        text = get_text(chapter_root)
        if len(text.split()) < 4:
            raise ValueError(f"Source chapter {number} has almost no text")
        chapter_title = entry["title"]
        if not re.search(r"\w", chapter_title, re.UNICODE):
            chapter_title = work["title"] if len(toc) == 1 else f"Chương {len(chapters) + 1}"
        chapters.append({"title": chapter_title, "text": text, "sourceUrl": entry["url"], "sourceChapter": number,
                         "sha256": sha256(text.encode()).hexdigest()})
    if sum(len(c["text"].split()) for c in chapters) < 80:
        raise ValueError("Source is too short to be a complete work")
    hashes = [c["sha256"] for c in chapters]
    duplicate_pages = []
    if len(hashes) != len(set(hashes)):
        if work['sourceId'] not in REVIEWED_DUPLICATE_CHAPTERS:
            raise ValueError("Source repeats a chapter verbatim; manual review required")
        unique = {}
        for chapter in chapters:
            if chapter['sha256'] in unique:
                duplicate_pages.append(chapter['sourceUrl'])
            else:
                unique[chapter['sha256']] = chapter
        chapters = list(unique.values())
        if len(chapters) == 1:
            chapters[0]['title'] = work['title']
    cover_url, image_source = cover(work, root)
    result = {**work, "storyId": stable_id(work["key"]), "branchId": stable_id(work["key"] + ":main"),
              "coverUrl": cover_url, "imageSourceUrl": image_source,
              "rights": {"basis": "OWNER_AUTHORIZATION", "confirmedAt": "2026-11-15", "scope": "Full-text republication and Edge TTS narration"},
              "importedAt": datetime.now(timezone.utc).isoformat(),
              "textChanges": "HTML navigation removed; paragraph spacing and Unicode Đ/đ normalized; no rewriting.",
              "sourceHtmlSha256": sha256(raw.encode()).hexdigest(),
              "reviewedDuplicateSourcePages": duplicate_pages,
              "chapters": chapters, "wordCount": sum(len(c["text"].split()) for c in chapters)}
    write_json(path, result)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--discover-only", action="store_true")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--author", choices=[a["id"] for a in AUTHORS])
    parser.add_argument("--keys", help="Comma-separated source keys for a targeted retry")
    args = parser.parse_args()
    CACHE.mkdir(exist_ok=True)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    discovery_path = OUTPUT / "discovered.json"
    if discovery_path.exists():
        works = json.loads(discovery_path.read_text(encoding="utf-8"))
    else:
        works = []
        for author in AUTHORS:
            works += discover(author)
        write_json(discovery_path, works)
    if args.author:
        works = [w for w in works if w["authorId"] == args.author]
    if args.keys:
        keys = set(args.keys.split(','))
        works = [w for w in works if w['key'] in keys]
    works = [w for w in works if not any(g in {"Thơ, Trường Ca", "Review Sách Hay"} for g in w["genres"])]
    # Short works first: complete stories are available for validation while
    # multi-chapter books continue downloading in the same resumable run.
    works.sort(key=lambda w: (w["expectedChapters"] or 1, w["sourceId"]))
    log(stage="discovered", works=len(works), chapters=sum(w["expectedChapters"] or 0 for w in works))
    if args.discover_only:
        return
    if args.limit:
        works = works[:args.limit]
    results, failures = [], []
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = {pool.submit(import_work, work): work for work in works}
        for future in as_completed(futures):
            work = futures[future]
            try:
                result = future.result()
                results.append(result)
                log(stage="imported", key=work["key"], chapters=len(result["chapters"]), words=result["wordCount"], done=len(results))
            except Exception as error:
                failures.append({"key": work["key"], "title": work["title"], "sourceUrl": work["sourceUrl"], "error": str(error)})
                log(stage="excluded", **failures[-1])
    write_json(OUTPUT / ("retry-failures.json" if args.keys else "failures.json"), failures)
    log(stage="complete", works=len(results), chapters=sum(len(w["chapters"]) for w in results), words=sum(w["wordCount"] for w in results), excluded=len(failures))


if __name__ == "__main__":
    main()
