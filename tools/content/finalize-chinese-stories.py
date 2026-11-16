"""Build the lightweight Chinese fiction shelf from 500 complete downloads."""
import importlib.util
import json
from pathlib import Path
from hashlib import sha256
from html import escape
import textwrap
from collections import Counter

spec = importlib.util.spec_from_file_location('chinese_import', Path(__file__).with_name('import-chinese-stories.py'))
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)


def fallback_cover(work):
    colors = ['#3a222c', '#202d39', '#322b3b', '#3a2921', '#203330']
    color = colors[int(sha256(work['key'].encode()).hexdigest()[:4], 16) % len(colors)]
    lines = textwrap.wrap(work['title'], width=22, break_long_words=False)
    size = min(42, 290 / max(1, len(lines)) / 1.24)
    title = ''.join(f'<tspan x="55" dy="{size * 1.24:.1f}">{escape(line)}</tspan>' for line in lines)
    author = work['authorName'] if work['authorName'] != 'Khuyết danh' else work['sourceName']
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">
<rect width="600" height="800" fill="{color}"/><rect x="23" y="23" width="554" height="754" rx="4" fill="none" stroke="#be9d7b" stroke-opacity=".6"/>
<circle cx="450" cy="195" r="135" fill="none" stroke="#cdaa84" stroke-opacity=".13" stroke-width="44"/>
<path d="M55 112h78" stroke="#d2ae84" stroke-width="2"/><text x="55" y="160" fill="#d2ae84" font-family="Arial,sans-serif" font-size="17" letter-spacing="3">TRUYỆN TRUNG</text>
<text x="55" y="255" fill="#f2e9dd" font-family="Georgia,serif" font-size="{size:.1f}">{title}</text>
<path d="M55 650h70" stroke="#d2ae84" stroke-width="2"/><text x="55" y="700" fill="#d2ae84" font-family="Georgia,serif" font-size="23">{escape(author[:40])}</text></svg>'''
    filename = sha256(work['key'].encode()).hexdigest()[:24] + '.svg'
    path = c.ROOT / 'apps/web/public/chinese-covers' / filename
    path.write_text(svg, encoding='utf-8')
    return '/chinese-covers/' + filename


def main():
    manifest = json.loads((c.OUTPUT / 'manifest.json').read_text(encoding='utf-8'))
    if manifest['target'] != 500 or len(manifest['keys']) != 500:
        raise ValueError('The shelf must contain 500 reviewed complete works before publication')
    works = []
    for rank, key in enumerate(manifest['keys'], 1):
        work = json.loads((c.OUTPUT / (key + '.json')).read_text(encoding='utf-8'))
        work = c.validate_cached_work(work)
        # Metadata normalization is repeatable without changing published text.
        work['genres'] = c.genres_for(work['sourceGenres'])
        if 'tra xanh' in c.fold(work['title'] + ' ' + work['synopsis']):
            work['genres'].append('Trà xanh')
        if any(c.fold(g) == 'zhihu' for g in work['sourceGenres']):
            work['genres'].append('Zhihu')
        if work['rights']['basis'] != 'OWNER_AUTHORIZATION' or work['sourceId'] not in {'monkeyd', 'metruyen'}:
            raise ValueError('Unexpected import authorization scope')
        if work.get('cleanupVersion') != 1:
            raise ValueError('Run the reviewed source formatting cleanup before publication')
        if work['storyId'] != c.stable_id(key) or work['branchId'] != c.stable_id(key + ':main'):
            raise ValueError('Unstable native story identity')
        if not work.get('coverUrl'):
            work['coverUrl'] = fallback_cover(work)
        c.write_json(c.OUTPUT / (key + '.json'), work)
        if work['wordCount'] != sum(len(x['text'].split()) for x in work['chapters']):
            raise ValueError('Word count does not match source text')
        for chapter in work['chapters']:
            if sha256(chapter['text'].encode()).hexdigest() != chapter['sha256'] or len(chapter['text']) > 12000:
                raise ValueError('Chapter text needs review')
        works.append({
            'id': 'chinese-' + key, 'nativeStoryId': work['storyId'], 'branchId': work['branchId'],
            'title': work['title'], 'authorId': work['authorId'], 'authorName': work['authorName'],
            'genres': work['genres'], 'sourceId': work['sourceId'], 'sourceName': work['sourceName'],
            'sourceUrl': work['sourceUrl'], 'coverUrl': work['coverUrl'],
            'chapterCount': len(work['chapters']), 'wordCount': work['wordCount'],
            'textSource': work['textSource'], 'collectionId': 'chinese-drama',
            'selectionRank': rank, 'popularity': work['popularity'],
            'containedTitles': list(dict.fromkeys(x.get('sourceChapterTitle', x['title']) for x in work['chapters'])),
        })
    c.write_json(c.ROOT / 'apps/web/lib/chinese-catalog.json', {
        'checkedAt': max(w['textSource']['importedAt'][:10] for w in works),
        'name': 'Truyện Trung · Drama & Trùng sinh', 'works': works,
    })
    c.log(stage='reviewed-chinese', works=len(works), sources=dict(Counter(w['sourceId'] for w in works)),
          chapters=sum(w['chapterCount'] for w in works), words=sum(w['wordCount'] for w in works))


if __name__ == '__main__':
    main()
