"""Review/deduplicate completed downloads and build the native web catalog.

Does not publish data. seed-native-texts.ts performs that separate, idempotent
step. Failed/partial downloads never enter either manifest.
"""
import importlib.util
import json
from pathlib import Path
import re
import textwrap
from html import escape
from collections import Counter

spec = importlib.util.spec_from_file_location("import_native", Path(__file__).with_name("import-native-texts.py"))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
ROOT = mod.ROOT
directory = mod.OUTPUT


def source_chapters(work):
    """Reassemble previously split source pages before reviewing/deduping."""
    result = []
    for chapter in work['chapters']:
        if chapter.get('sourcePart', 1) > 1:
            result[-1]['text'] += '\n\n' + chapter['text']
        else:
            item = dict(chapter)
            item['title'] = item.get('sourceChapterTitle', item['title'])
            for field in ('sourcePart', 'sourcePartCount', 'sourceChapterTitle'):
                item.pop(field, None)
            result.append(item)
    for chapter in result:
        chapter['sha256'] = mod.sha256(chapter['text'].encode()).hexdigest()
    return result


def reading_parts(chapters):
    """Keep source headings; divide long pages at paragraph/sentence breaks.

    Edge's configured timeout is five minutes. A source page containing an
    entire novella must not turn into one enormous synthesis that always
    times out. Every source word is retained, in order, and verified below.
    """
    parts = []
    for chapter in chapters:
        remaining = chapter['text']
        chunks = []
        while len(remaining) > 12_000:
            cut = remaining.rfind('\n\n', 6_000, 12_000)
            if cut < 0:
                matches = list(re.finditer(r'[.!?…][”\"\'»)]*\s+', remaining[6_000:12_000]))
                cut = 6_000 + matches[-1].end() if matches else remaining.rfind(' ', 6_000, 12_000)
            if cut < 0:
                raise ValueError('Unbroken source paragraph needs manual review')
            chunks.append(remaining[:cut].strip())
            remaining = remaining[cut:].strip()
        chunks.append(remaining)
        if re.sub(r'\s+', ' ', ' '.join(chunks)).strip() != re.sub(r'\s+', ' ', chapter['text']).strip():
            raise ValueError('Source text changed while splitting a long reading section')
        for i, text in enumerate(chunks):
            item = {**chapter, 'text': text, 'sha256': mod.sha256(text.encode()).hexdigest()}
            if len(chunks) > 1:
                item.update({'title': f"{chapter['title']} · phần {i + 1}/{len(chunks)}", 'sourceChapterTitle': chapter['title'],
                    'sourcePart': i + 1, 'sourcePartCount': len(chunks),
                    'sourceTextSha256': chapter.get('sourceTextSha256', chapter['sha256'])})
            parts.append(item)
    return parts


def typographic_cover(work):
    """A local SVG jacket when the source has no usable book cover."""
    colors = ['#172b2a', '#362521', '#292337', '#202d3b', '#352a18']
    color = colors[int(mod.sha256(work['key'].encode()).hexdigest()[:4], 16) % len(colors)]
    lines = textwrap.wrap(work['title'], width=22, break_long_words=False)
    size = 44 if len(lines) <= 5 else 36
    title = ''.join(f'<tspan x="62" dy="{size * 1.24:.0f}">{escape(line)}</tspan>' for line in lines)
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">
<rect width="600" height="800" fill="{color}"/><rect x="24" y="24" width="552" height="752" rx="3" fill="none" stroke="#c0a271" stroke-opacity=".5"/>
<path d="M420 75a200 200 0 1 0 120 350" fill="none" stroke="#c0a271" stroke-opacity=".16" stroke-width="38"/>
<path d="M62 113h80" stroke="#d9bc89" stroke-width="2"/><text x="62" y="165" fill="#d9bc89" font-family="Georgia,serif" font-size="25">{escape(work['authorName'])}</text>
<text x="62" y="270" fill="#f5eddf" font-family="Georgia,serif" font-size="{size}">{title}</text>
<path d="M62 685h60" stroke="#d9bc89" stroke-width="2"/><text x="62" y="732" fill="#d9bc89" font-family="Arial,sans-serif" font-size="16" letter-spacing="3">VĂN HỌC VIỆT NAM</text></svg>'''
    target = ROOT / 'apps/web/public/author-covers' / (work['key'] + '.svg')
    target.write_text(svg, encoding='utf-8')
    return '/author-covers/' + target.name


def normalized_genres(genres):
    mapping = {
        'Teen, Tuổi Hoa, Thiếu Nhi': ['Tuổi học trò', 'Thiếu nhi'],
        'truyện dài': ['Truyện dài'], 'Tiểu Thuyết': ['Tiểu thuyết'],
        'Biên khảo, Tuỳ Bút, Tản Văn': ['Tản văn'],
        'Tuyển Tập, Tập Truyện': ['Tập truyện'], 'Hồi Ký, Tự Truyện': ['Tự truyện'],
        'Siêu Nhiên, Huyền bí': ['Huyền bí'], 'Kinh Dị, Ma quái': ['Kinh dị'],
        'Kịch, Kịch bản': ['Kịch'],
    }
    return list(dict.fromkeys(g for source in genres for g in mapping.get(source, [source])))


def main():
    works = [json.loads(p.read_text(encoding='utf-8')) for p in directory.glob('*.json') if p.stem.startswith(('vntq-', 'wikisource-'))]
    # Once published, a reading part's text/position is immutable. Re-review
    # the reassembled source for deduplication, but retain existing splits.
    prepared = {w['key']: w['chapters'] for w in works if any(c.get('sourcePart') for c in w['chapters'])}
    for work in works:
        work['chapters'] = source_chapters(work)
    works.sort(key=lambda w: (-len(w['chapters']), -w['wordCount'], w['key']))
    used_texts = {}
    kept, excluded = [], []
    for work in works:
        if work['key'] == 'vntq-9070':
            excluded.append({'key': work['key'], 'reason': 'Ambiguous partial series omnibus; complete individual Kính vạn hoa volumes are imported separately'})
            continue
        if re.search(r'\btrích\b|\bđọc thử\b', work['title'], re.I):
            excluded.append({'key': work['key'], 'reason': 'Source explicitly labels an excerpt'})
            continue
        if any(re.search(r'^\s*\(?còn (tiếp|nữa)\)?[.!…\s]*$', c['text'].splitlines()[-1], re.I) for c in work['chapters']):
            excluded.append({'key': work['key'], 'reason': 'Source ends with a continuation notice'})
            continue
        chapter_keys = [(work['authorId'], mod.sha256(re.sub(r'\s+', ' ', c['text']).strip().encode()).hexdigest()) for c in work['chapters']]
        if all(key in used_texts for key in chapter_keys):
            excluded.append({'key': work['key'], 'reason': 'Identical text already present in a complete collection', 'includedIn': sorted(set(used_texts[k] for k in chapter_keys))})
            continue
        for key in chapter_keys:
            used_texts[key] = work['key']
        work['genres'] = normalized_genres(work['genres'])
        source = {
            'authorId': work['authorId'], 'authorName': work['authorName'],
            'name': work['sourceName'], 'url': work.get('permanentUrl') or work['sourceUrl'],
            'importedAt': work['importedAt'],
        }
        if work.get('license'):
            source['license'] = work['license']
            source['changes'] = 'Chuẩn hóa khoảng cách đoạn và chữ Đ/đ; giữ nguyên nội dung.'
        work['sourceChapterCount'] = len(work['chapters'])
        work['chapters'] = prepared.get(work['key']) or reading_parts(work['chapters'])
        if len(work['chapters']) > work['sourceChapterCount']:
            source['changes'] = (source.get('changes', '') + ' Chia mục dài thành các phần đọc; giữ nguyên nội dung và thứ tự.').strip()
        work['textSource'] = source
        work['synopsis'] = f"{work['title']} — {work['authorName']}. " + ('Truyện ngắn' if len(work['chapters']) == 1 else f"{len(work['chapters'])} phần đọc") + ', đọc và nghe trọn vẹn ngay trên web.'
        mod.write_json(directory / (work['key'] + '.json'), work)
        kept.append(work)

    old = json.loads((ROOT / 'apps/web/lib/famous-catalog.json').read_text(encoding='utf-8'))
    by_title = {(w['authorId'], mod.folded(w['title'])): w for w in kept}
    # The old catalog may include edition subtitles and a collection name.
    # Alias only exact normalized titles; approximate matches risk wrong books.
    aliases = {}
    for old_work in old['works']:
        match = by_title.get((old_work['authorId'], mod.folded(old_work['title'])))
        if match:
            aliases.setdefault(match['key'], []).append(old_work['id'])
            if old_work.get('coverUrl'):
                match['coverUrl'] = old_work['coverUrl']
                match['imageSourceUrl'] = old_work['imageSourceUrl']
                mod.write_json(directory / (match['key'] + '.json'), match)
    catalog_works = []
    titles_by_key = {w['key']: w['title'] for w in works}
    for work in sorted(kept, key=lambda w: (w['authorId'], mod.folded(w['title']))):
        if not work.get('coverUrl'):
            work['coverUrl'] = typographic_cover(work)
            work['coverStyle'] = 'LOCAL_TYPOGRAPHIC_SVG'
            mod.write_json(directory / (work['key'] + '.json'), work)
        contained = [c.get('sourceChapterTitle', c['title']) for c in work['chapters']]
        contained += [titles_by_key[x['key']] for x in excluded if work['key'] in x.get('includedIn', [])]
        catalog_works.append({
            'id': 'native-' + work['key'], 'nativeStoryId': work['storyId'], 'branchId': work['branchId'],
            'title': work['title'], 'authorId': work['authorId'], 'genres': work['genres'],
            'format': 'book', 'sourceName': work['sourceName'], 'sourceUrl': work['sourceUrl'],
            'sourceTitle': work['title'], 'discoveredAt': work['importedAt'][:10],
            'coverUrl': work.get('coverUrl'), 'imageSourceUrl': work.get('imageSourceUrl') or '',
            'chapterCount': len(work['chapters']), 'wordCount': work['wordCount'], 'textSource': work['textSource'],
            'catalogAliases': aliases.get(work['key'], []),
            'containedTitles': list(dict.fromkeys(t for t in contained if t != work['title'])),
        })
    authors = []
    for id in sorted(set(w['authorId'] for w in kept)):
        sample = next(w for w in kept if w['authorId'] == id)
        authors.append({'id': id, 'name': sample['authorName'], 'sourceUrl': sample['authorSourceUrl'],
            'note': 'Đọc và nghe các tác phẩm ngay trong thư viện.',
            'genres': sorted(set(g for w in kept if w['authorId'] == id for g in w['genres']))})
    mod.write_json(ROOT / 'apps/web/lib/native-catalog.json', {'checkedAt': max(w['importedAt'][:10] for w in kept), 'authors': authors, 'works': catalog_works})
    mod.write_json(directory / 'manifest.json', {'keys': [w['key'] for w in kept], 'excluded': excluded,
        'counts': {'works': len(kept), 'chapters': sum(len(w['chapters']) for w in kept), 'words': sum(w['wordCount'] for w in kept)}})
    discovered = json.loads((directory / 'discovered.json').read_text(encoding='utf-8'))
    failures = {w['key']: w for w in json.loads((directory / 'failures.json').read_text(encoding='utf-8'))}
    unresolved = [failures.get(w['key'], {'key': w['key'], 'title': w['title']}) for w in discovered
        if not (directory / (w['key'] + '.json')).exists() and not any(g in {'Thơ, Trường Ca', 'Review Sách Hay'} for g in w['genres'])]
    mod.write_json(directory / 'import-report.json', {'downloadedSources': len(works), 'publishedWorks': len(kept),
        'excludedDuplicatesOrOmnibus': excluded, 'unresolvedSourceErrors': unresolved})
    mod.log(stage='reviewed', works=len(kept), authors=dict(Counter(w['authorName'] for w in kept)), excluded=len(excluded), aliases=sum(len(x) for x in aliases.values()))


if __name__ == '__main__':
    main()
