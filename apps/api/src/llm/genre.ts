import { Genre } from '@prisma/client';

/** Stories carry free-form tags; only these map onto the craft-note genres. */
export function firstKnownGenre(tags: string[]): Genre | null {
  // Every label the genre picker can produce, plus the English spellings, plus
  // the toneless ones people type. A tag the map does not know leaves the genre
  // null, which only means no genre notes - but a tag it *should* know and does not
  // fails silently, so this list is kept level with the picker on purpose.
  const map: Record<string, Genre> = {
    'kinh dị': Genre.HORROR,
    'kinh di': Genre.HORROR,
    'huyền bí': Genre.HORROR,
    'tâm linh': Genre.HORROR,
    horror: Genre.HORROR,

    'giật gân': Genre.THRILLER,
    'giat gan': Genre.THRILLER,
    'hồi hộp': Genre.THRILLER,
    'trinh thám': Genre.THRILLER,
    'tâm lý': Genre.THRILLER,
    thriller: Genre.THRILLER,

    'ngôn tình': Genre.ROMANCE,
    'ngon tinh': Genre.ROMANCE,
    'lãng mạn': Genre.ROMANCE,
    'lang man': Genre.ROMANCE,
    romance: Genre.ROMANCE,

    'hành động': Genre.ACTION,
    'hanh dong': Genre.ACTION,
    'mạt thế': Genre.ACTION,
    action: Genre.ACTION,

    'ngoại tình': Genre.INFIDELITY,
    'ngoai tinh': Genre.INFIDELITY,
  };
  for (const tag of tags) {
    const hit = map[tag.toLowerCase().trim()];
    if (hit) return hit;
  }
  return null;
}

