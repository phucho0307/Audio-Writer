/**
 * The reference shelf and the craft corpus.
 *
 * Two different things, kept apart on purpose:
 *
 * `ReferenceSource` is a link and a line about it - where Vietnamese audio
 * fiction actually lives, for a writer who wants to hear how the genre sounds
 * before writing in it. We send people there; we do not copy from there.
 *
 * `CraftNote` is ours. Written from reading and listening widely, the way any
 * writer learns a genre, and phrased as advice rather than as anyone's prose.
 * This is what the retrieval index is built from, which is why it can be
 * shipped in a product that sells what it generates.
 */
import { PrismaClient, CraftKind, Genre, SourceKind } from '@prisma/client';

const prisma = new PrismaClient();

const SOURCES = [
  {
    slug: 'nghetruyenma',
    name: 'Nghe Truyện Ma',
    url: 'https://nghetruyenma.net/',
    kind: SourceKind.AUDIO_SITE,
    genres: [Genre.HORROR, Genre.THRILLER],
    note: 'Kho truyện ma lớn, chia theo MC. Nghe để thấy một chương được cắt ở đâu thì người ta bấm tập sau.',
    scale: 'hàng nghìn tập, cập nhật hằng ngày',
  },
  {
    slug: 'audioma',
    name: 'Audio Ma',
    url: 'https://audioma.vn/',
    kind: SourceKind.AUDIO_SITE,
    genres: [Genre.HORROR, Genre.ROMANCE, Genre.INFIDELITY],
    note: 'Có cả truyện ma lẫn ngôn tình, và các tuyến ngoại tình nằm trong mảng ngôn tình đó. Tốt để so cách dẫn chuyện giữa hai thể loại trên cùng một giọng đọc.',
    scale: null,
  },
  {
    slug: 'kenhtruyenma',
    name: 'Kênh Truyện Ma',
    url: 'https://kenhtruyenma.com/',
    kind: SourceKind.AUDIO_SITE,
    genres: [Genre.HORROR],
    note: 'Hiển thị lượt nghe từng truyện - xem cái gì thật sự được nghe nhiều, không phải cái gì được quảng cáo.',
    scale: null,
  },
  {
    slug: 'truyenaudios',
    name: 'Truyện Audio',
    url: 'https://truyenaudios.com/',
    kind: SourceKind.AUDIO_SITE,
    genres: [Genre.HORROR, Genre.ACTION],
    note: 'Phân loại khá kỹ: truyện ma ngắn, bùa ngải, làng quê. Dùng để tìm đúng nhánh nhỏ mình đang viết.',
    scale: null,
  },
  {
    slug: 'quang-a-tun',
    name: 'Quàng A Tũn',
    url: 'https://nghetruyenma.net/truyen-ma-quang-a-tun',
    kind: SourceKind.CHANNEL,
    genres: [Genre.HORROR],
    note: 'Một trong những giọng đọc đông người theo nhất. Nghe để hiểu nhịp đọc ảnh hưởng thế nào đến cách viết câu.',
    scale: null,
  },
  {
    slug: 'radiotoday',
    name: 'RadioToday',
    url: 'https://radiotoday.net/truyen-audio/audio-truyen-tinh-yeu-ngon-tinh',
    kind: SourceKind.AUDIO_SITE,
    genres: [Genre.ROMANCE, Genre.INFIDELITY],
    note: 'Mảng tình cảm, đô thị, tâm lý - nơi phần lớn tuyến ngoại tình của truyện Việt nằm. Nghe để thấy người ta dựng nghi ngờ bằng chi tiết đời thường thế nào.',
    scale: null,
  },
  {
    slug: 'fonos',
    name: 'Fonos',
    url: 'https://fonos.vn/',
    kind: SourceKind.APP,
    genres: [Genre.ROMANCE, Genre.THRILLER],
    note: 'Sách nói bản quyền, thu phòng chuyên nghiệp, hợp tác với NXB Trẻ, Nhã Nam, Alphabooks. Chuẩn chất lượng âm thanh để so.',
    scale: null,
  },
  {
    slug: 'voiz-fm',
    name: 'Voiz FM',
    url: 'https://voiz.vn/',
    kind: SourceKind.APP,
    genres: [Genre.ROMANCE, Genre.THRILLER, Genre.ACTION],
    note: 'Khoảng 2.000 tựa độc quyền, mạnh mảng ngôn tình và tâm lý. Xem cách họ đặt tên và mô tả truyện để hút người nghe.',
    scale: '~2.000 tựa',
  },
  {
    slug: 'waka',
    name: 'Waka',
    url: 'https://waka.vn/',
    kind: SourceKind.APP,
    genres: [Genre.ROMANCE, Genre.ACTION],
    note: 'Nặng về ebook, kho tiểu thuyết và truyện dịch bản quyền. Tốt để tra cấu trúc truyện dài nhiều tập.',
    scale: null,
  },
];

type Note = {
  kind: CraftKind;
  genre: Genre;
  title: string;
  body: string;
  source?: string;
};

const NOTES: Note[] = [
  // ---------------------------------------------------------------- HORROR
  {
    kind: CraftKind.TROPE,
    genre: Genre.HORROR,
    title: 'Cái quen thuộc sai một chi tiết',
    source: 'nghetruyenma',
    body: 'Truyện ma Việt hiệu quả nhất khi bắt đầu từ chỗ không có gì đáng sợ: bữa cơm, cái gối, tiếng dép ngoài hành lang. Đặt một chi tiết sai duy nhất vào đó - sợi tóc không phải của ai trong nhà, đôi dép quay ngược hướng - rồi để nhân vật tự giải thích hợp lý. Nỗi sợ đến từ việc người đọc tin lời giải thích đó trước, rồi nhận ra mình đã tin nhầm. Đừng đưa hai chi tiết sai trong cùng một chương: cái thứ hai làm người đọc chuyển từ "có gì đó lạ" sang "đây là truyện ma", và mất luôn phần đáng sợ nhất.',
  },
  {
    kind: CraftKind.BEAT,
    genre: Genre.HORROR,
    title: 'Nhịp một chương nghe được',
    source: 'quang-a-tun',
    body: 'Một chương nghe khoảng mười lăm đến hai mươi phút, tức tầm 1.200-1.800 từ. Chia làm ba: năm phút đời thường để người nghe quen giọng và tin bối cảnh, bảy phút dồn chi tiết lạ, ba phút cuối đẩy tới một câu hỏi chưa trả lời. Kết chương ở ngay trước lời giải thích, không phải sau. Người nghe bấm tập sau vì cần biết, không phải vì tò mò chung chung.',
  },
  {
    kind: CraftKind.OPENING,
    genre: Genre.HORROR,
    title: 'Mở bằng hành động thường ngày có mốc thời gian',
    body: 'Câu đầu nên có một việc cụ thể và một cái đồng hồ: "Hằng phát hiện sợi tóc lúc mười một giờ đêm, khi đang thay vỏ gối." Mốc thời gian làm người nghe định vị được mình đang ở đâu trong đêm, và cho phép tác giả đếm ngược về sau. Tránh mở bằng thời tiết, bằng triết lý, hoặc bằng lời hứa sẽ sợ - người nghe truyện ma đã biết họ đang nghe truyện ma.',
  },
  {
    kind: CraftKind.SETTING,
    genre: Genre.HORROR,
    title: 'Không gian Việt có sẵn luật lệ',
    body: 'Chung cư cũ, xóm trọ công nhân, làng ven sông, bệnh viện tỉnh ban đêm: mỗi nơi có luật bất thành văn mà người Việt đều biết - không gọi tên người khác lúc nửa đêm, không soi gương lúc ba giờ, không trả lời khi nghe gọi từ ngoài cổng. Truyện mạnh nhất khi nhân vật biết luật và vẫn phạm vì một lý do rất người: thương con, cần tiền, sĩ diện. Phạm luật vì ngu dốt thì người nghe bỏ đi.',
  },
  {
    kind: CraftKind.TWIST,
    genre: Genre.HORROR,
    title: 'Người kể chuyện là phần bị giấu',
    body: 'Cú lật bền nhất không phải "con ma là ai" mà "người kể đã giấu gì". Gài sớm một chi tiết người kể lướt qua quá nhanh - một cái tên không nhắc lại, một ngày tháng lệch - rồi để nó quay lại ở chương cuối. Điều kiện: đọc lại chương một phải thấy chi tiết đó nằm sẵn ở đấy. Nếu phải thêm thông tin mới ở cuối thì đó là gian lận, không phải cú lật.',
  },

  // -------------------------------------------------------------- THRILLER
  {
    kind: CraftKind.BEAT,
    genre: Genre.THRILLER,
    title: 'Đồng hồ đếm ngược phải nhìn thấy được',
    body: 'Giật gân khác kinh dị ở chỗ người đọc biết trước nguy hiểm, chỉ không biết khi nào. Muốn vậy phải có một cái đếm được: bảy ngày, bốn mươi giây, ba lá thư. Nhắc lại con số đó mỗi chương, và để nó giảm thật. Nếu con số không giảm sau một chương thì chương đó không cần tồn tại.',
  },
  {
    kind: CraftKind.TROPE,
    genre: Genre.THRILLER,
    title: 'Người biết quá ít, không phải quá nhiều',
    source: 'voiz-fm',
    body: 'Nhân vật chính nên biết ít hơn người đọc một chút ở vài đoạn, và nhiều hơn một chút ở vài đoạn khác. Luân phiên như vậy giữ được cả hồi hộp (ta thấy cái họ chưa thấy) lẫn bất ngờ (họ thấy cái ta chưa thấy). Nếu người đọc luôn biết nhiều hơn, truyện thành sốt ruột; luôn biết ít hơn, truyện thành mò mẫm.',
  },
  {
    kind: CraftKind.OPENING,
    genre: Genre.THRILLER,
    title: 'Mở bằng một việc đã rồi',
    body: 'Bắt đầu sau khi chuyện đã xảy ra, không phải trước: "Bảy ngày sau khi mưa đen rơi xuống thành phố..." Người đọc bước vào giữa hậu quả và phải tự ghép lại nguyên nhân, nên họ đọc tiếp để lấp chỗ trống chứ không phải chờ cái gì đó bắt đầu.',
  },
  {
    kind: CraftKind.TWIST,
    genre: Genre.THRILLER,
    title: 'Nghi phạm sai phải có lý do thật',
    body: 'Người bị nghi oan chỉ đáng tin nếu họ thật sự có động cơ và thật sự nói dối một điều gì đó - chỉ không phải điều đang bị nghi. Cho họ một bí mật nhỏ có thật (ngoại tình, nợ, giấy tờ giả) để lời chối của họ nghe gượng. Khi sự thật lộ ra, người đọc không thấy bị lừa, họ thấy mình đã suy luận đúng từ dữ kiện sai.',
  },

  // --------------------------------------------------------------- ROMANCE
  {
    kind: CraftKind.TROPE,
    genre: Genre.ROMANCE,
    title: 'Trở ngại phải nằm trong tính cách',
    source: 'fonos',
    body: 'Ngôn tình Việt được nghe nhiều nhất khi cái ngăn hai người không phải hoàn cảnh (giàu nghèo, gia đình phản đối) mà là một nét tính cách có thật: người không biết nhận lỗi, người quen chịu đựng rồi im, người lấy công việc làm chỗ trốn. Hoàn cảnh giải quyết được bằng một cuộc nói chuyện; tính cách thì phải trả giá mới đổi. Trả giá là chỗ người nghe khóc.',
  },
  {
    kind: CraftKind.BEAT,
    genre: Genre.ROMANCE,
    title: 'Một cử chỉ thay cho một lời',
    body: 'Mỗi chương nên có đúng một cử chỉ cụ thể thay cho lời tỏ tình: để phần cơm nguội lại, sửa cái xe không nói, đứng chờ ở chỗ khuất. Nghe audio, cử chỉ dễ nhớ hơn đối thoại dài. Khi đến lúc nói thật, câu nói ngắn mới có sức, vì nó đến sau mười chương im lặng.',
  },
  {
    kind: CraftKind.OPENING,
    genre: Genre.ROMANCE,
    title: 'Gặp lại, không phải gặp lần đầu',
    body: 'Mở ở lần gặp lại cho phép đặt cả quá khứ lẫn hiện tại vào một cảnh: hai người biết rõ nhau, người đọc thì chưa. Mỗi câu thoại vì thế mang hai tầng, và tác giả nhỏ giọt quá khứ theo nhịp mình muốn thay vì kể một lượt.',
  },
  {
    kind: CraftKind.TWIST,
    genre: Genre.ROMANCE,
    title: 'Hiểu lầm chỉ được dùng một lần',
    body: 'Hiểu lầm là công cụ rẻ: dùng một lần thì thương, dùng hai lần thì người nghe bắt đầu trách nhân vật ngu. Nếu cần kéo dài, đổi sang xung đột mà cả hai đều đúng - mẹ ốm ở quê và cơ hội ở thành phố - vì loại đó không giải được bằng một câu giải thích.',
  },

  // ---------------------------------------------------------------- ACTION
  {
    kind: CraftKind.BEAT,
    genre: Genre.ACTION,
    title: 'Mỗi cảnh hành động phải mất một thứ',
    body: 'Đánh nhau mà không mất gì thì chỉ là tiếng động. Mỗi cảnh nên lấy đi một thứ cụ thể: một ngón tay, một người bạn, chiếc xe duy nhất, hoặc đơn giản là thời gian trong cái đồng hồ đếm ngược. Người nghe đo độ căng bằng thứ đã mất, không bằng số cú đấm.',
  },
  {
    kind: CraftKind.SETTING,
    genre: Genre.ACTION,
    title: 'Địa hình quyết định cách đánh',
    body: 'Hẻm Sài Gòn lúc ba giờ sáng, đèo sương mù, chợ đầu mối đang dọn hàng, ghe trên sông nước lớn: mỗi nơi cho phép và cấm những việc khác nhau. Viết địa hình trước, trận đánh sau, thì cảnh sẽ tự có chiến thuật. Viết trận đánh trước rồi nhét vào bối cảnh thì cảnh nào cũng giống cảnh nào.',
  },
  {
    kind: CraftKind.OPENING,
    genre: Genre.ACTION,
    title: 'Vào giữa việc, giải thích sau',
    body: 'Bắt đầu khi tay đã trên vô lăng và hàng đã trên xe. Người nghe chịu được việc chưa hiểu bối cảnh trong hai phút, miễn là hiểu ngay ai đang muốn gì và cái gì đang cản. Giải thích nhỏ giọt trong lúc chạy, đừng dừng lại để kể lý lịch.',
  },

  // ------------------------------------------------------------ INFIDELITY
  {
    kind: CraftKind.TROPE,
    genre: Genre.INFIDELITY,
    title: 'Bằng chứng nhỏ hơn người ta tưởng',
    source: 'audioma',
    body: 'Chuyện ngoại tình sống bằng vật chứng đời thường: một sợi tóc, hoá đơn hai ly cà phê, cái điện thoại úp xuống bàn, mùi lạ trên áo. Càng nhỏ càng mạnh, vì người đọc tự dựng phần còn lại. Tránh ảnh chụp tận mặt ở chương đầu - hết chuyện quá sớm, và cảm giác nghi ngờ mới là thứ người nghe ở lại vì nó.',
  },
  {
    kind: CraftKind.BEAT,
    genre: Genre.INFIDELITY,
    title: 'Ba giai đoạn: nghi, chắc, chọn',
    body: 'Nghi ngờ (người trong cuộc tự bào chữa hộ đối phương), xác nhận (không chối được nữa), và lựa chọn (ở lại, đi, hay trả đũa). Phần lớn truyện dở vì dành chín phần cho giai đoạn một rồi kết vội ở giai đoạn ba. Giai đoạn ba mới là chỗ nhân vật lộ ra họ là ai; nên dành cho nó ít nhất một phần ba độ dài.',
  },
  {
    kind: CraftKind.TWIST,
    genre: Genre.INFIDELITY,
    title: 'Người thứ ba cũng bị lừa',
    body: 'Một hướng ít mòn: người thứ ba không biết mình là người thứ ba. Khi hai người phụ nữ - hoặc hai người đàn ông - gặp nhau và nhận ra cùng bị lừa, trọng tâm chuyển từ ghen sang đồng cảnh. Câu chuyện thôi là chuyện trả thù và thành chuyện về người đã nói dối cả hai.',
  },
  {
    kind: CraftKind.SETTING,
    genre: Genre.INFIDELITY,
    title: 'Nhà, nhưng nhìn từ phía người ở lại',
    body: 'Bối cảnh mạnh nhất không phải khách sạn mà là nhà: căn bếp lúc bốn giờ sáng, cái ghế bên kia bàn ăn, tủ quần áo chia đôi. Mỗi vật trong nhà đều từng có nghĩa khác, và truyện chỉ cần nhắc lại nghĩa cũ để người nghe thấy xót. Đây cũng là chỗ thể loại này gần với kinh dị nhất: cùng một không gian quen, cùng một chi tiết sai.',
  },
];

async function main() {
  for (const s of SOURCES) {
    await prisma.referenceSource.upsert({
      where: { slug: s.slug },
      create: s,
      update: s,
    });
  }

  const sources = await prisma.referenceSource.findMany({
    select: { id: true, slug: true },
  });
  const bySlug = new Map(sources.map((s) => [s.slug, s.id]));

  // Rewritten whole each run: these are edited as the genre notes improve, and
  // keeping stale copies would quietly poison retrieval.
  await prisma.craftNote.deleteMany({});
  for (const n of NOTES) {
    await prisma.craftNote.create({
      data: {
        kind: n.kind,
        genre: n.genre,
        title: n.title,
        body: n.body,
        sourceId: n.source ? (bySlug.get(n.source) ?? null) : null,
      },
    });
  }

  const counts = await prisma.craftNote.groupBy({
    by: ['genre'],
    _count: true,
  });
  console.log(`sources: ${SOURCES.length}`);
  for (const c of counts) console.log(`  ${c.genre.padEnd(12)} ${c._count} notes`);
  console.log(`craft notes: ${NOTES.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
