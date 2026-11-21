'use client';

import { useRef, type ReactNode } from 'react';
import { calm, gsap, useGSAP } from '@/lib/motion';
import Reveal from '../Reveal';
import Waveform from './Waveform';

/* ==========================================================================
   Four things the product does, each with a working miniature of itself
   beside it instead of a screenshot. A screenshot asks the reader to imagine
   it moving; these move.

   Every demo starts when it scrolls into view and pauses when it leaves, so
   four animations on one page cost what one does. Under reduced motion each
   shows its finished state.
   ========================================================================== */

function Feature({
  kicker,
  title,
  children,
  chips,
  demo,
  flip = false,
}: {
  kicker: string;
  title: ReactNode;
  children: ReactNode;
  chips: string[];
  demo: ReactNode;
  flip?: boolean;
}) {
  return (
    <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
      <Reveal className={`flex flex-col items-start gap-5 ${flip ? 'lg:order-2' : ''}`}>
        <span className="label label-accent">{kicker}</span>
        <h2 className="display text-[clamp(2rem,4.2vw,3.3rem)] leading-[1.04]">{title}</h2>
        <p className="max-w-[48ch] text-[15.5px] leading-[1.75] text-[var(--color-muted)]">{children}</p>
        <div className="flex flex-wrap gap-2">
          {chips.map((c) => (
            <span key={c} className="chip cursor-default">
              {c}
            </span>
          ))}
        </div>
      </Reveal>
      <Reveal className={flip ? 'lg:order-1' : ''} delay={0.12}>
        {demo}
      </Reveal>
    </div>
  );
}

/** A timeline that plays only while its card is on screen. */
function useDemo(build: (tl: gsap.core.Timeline, el: HTMLElement) => void, still: (el: HTMLElement) => void) {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const el = root.current;
      if (!el) return;
      if (calm()) return still(el);
      const tl = gsap.timeline({
        repeat: -1,
        repeatDelay: 1.6,
        paused: true,
        scrollTrigger: {
          trigger: el,
          start: 'top 80%',
          end: 'bottom 10%',
          toggleActions: 'play pause resume pause',
        },
      });
      build(tl, el);
    },
    { scope: root },
  );
  return root;
}

/** Types an element's `data-text` into it, one character at a time. */
function typeInto(tl: gsap.core.Timeline, el: HTMLElement, at: number | string, cps = 38) {
  const full = el.dataset.text ?? '';
  const state = { n: 0 };
  tl.to(
    state,
    {
      n: full.length,
      duration: full.length / cps,
      ease: 'none',
      onUpdate: () => {
        el.textContent = full.slice(0, Math.round(state.n));
      },
      onStart: () => {
        el.textContent = '';
      },
    },
    at,
  );
}

/* --------------------------------------------------------------- NGHE */

const LINES = [
  'Hằng phát hiện sợi tóc lúc mười một giờ đêm, khi đang thay vỏ gối.',
  'Sợi tóc nằm vắt ngang mặt gối trắng, hơi cong ở một đầu.',
  'Dài. Thẳng. Màu nâu sáng.',
  'Cô đã cắt tóc ngang vai vào tháng sáu năm ngoái, và tóc cô đen.',
];

function DemoListen() {
  const root = useDemo(
    (tl, el) => {
      const lines = gsap.utils.toArray<HTMLElement>('[data-line]', el);
      gsap.set(lines, { color: 'var(--color-faint)', borderColor: 'transparent' });
      lines.forEach((l, i) => {
        tl.to(l, { color: 'var(--color-ink)', borderColor: 'var(--color-accent)', duration: 0.35 }, i * 2.2)
          .to(l, { color: 'var(--color-muted)', borderColor: 'transparent', duration: 0.5 }, i * 2.2 + 2);
      });
    },
    (el) => {
      const first = el.querySelector<HTMLElement>('[data-line]');
      if (first) first.style.borderColor = 'var(--color-accent)';
    },
  );

  return (
    <div ref={root} className="card relative flex flex-col gap-5 overflow-hidden p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 flex-none place-items-center rounded-full bg-[var(--color-accent)] text-[var(--color-on-accent)]">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <rect x="6.5" y="5" width="4" height="14" rx="1" />
            <rect x="13.5" y="5" width="4" height="14" rx="1" />
          </svg>
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="label">Căn Hộ 704 · chương 1</span>
          <span className="display text-[18px]">Sợi tóc</span>
        </div>
        <span className="ml-auto flex items-center gap-1.5 text-[11.5px] text-[var(--color-muted)]">
          <span className="dot dot-live" aria-hidden /> đang đọc
        </span>
      </div>

      <Waveform height={52} bars={60} />

      <div className="flex flex-col gap-2.5 font-serif text-[16px] leading-relaxed">
        {LINES.map((l) => (
          <p key={l} data-line className="border-l-2 border-transparent pl-3 text-[var(--color-muted)]">
            {l}
          </p>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-line)] pt-4">
        <span className="chip chip-on cursor-default">Kore · nữ, trầm ấm</span>
        {['1×', '1.25×', '1.5×', '2×'].map((r) => (
          <span key={r} className={`chip cursor-default ${r === '1.5×' ? 'chip-on' : ''}`}>
            {r}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- RẼ NHÁNH */

/**
 * The story as a tree, drawing itself as the reader scrolls past it.
 * `pathLength="1"` normalises every path so one dashoffset tween works for
 * curves of any length.
 */
function DemoBranch() {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const el = root.current;
      if (!el || calm()) return;
      const tl = gsap.timeline({
        scrollTrigger: { trigger: el, start: 'top 75%', end: 'bottom 45%', scrub: 0.6 },
      });
      tl.fromTo('[data-trunk]', { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 1, ease: 'none' })
        .from('[data-node]', { scale: 0, transformOrigin: 'center', stagger: 0.08, duration: 0.3 }, 0)
        .fromTo('[data-fork="a"]', { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.6, ease: 'none' }, 0.45)
        .from('[data-leaf="a"]', { opacity: 0, x: -10, duration: 0.3 }, 0.9)
        .fromTo('[data-fork="b"]', { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.6, ease: 'none' }, 0.7)
        .from('[data-leaf="b"]', { opacity: 0, x: -10, duration: 0.3 }, 1.15);
    },
    { scope: root },
  );

  const ys = [28, 62, 96, 130, 164, 198, 232, 266];
  return (
    <div ref={root} className="card relative overflow-hidden p-5 sm:p-6">
      <div className="mb-3 flex items-center justify-between">
        <span className="label">Căn Hộ 704 · cây truyện</span>
        <span className="text-[11.5px] text-[var(--color-accent)]">⑂ 2 nhánh</span>
      </div>
      <svg viewBox="0 0 420 300" className="h-auto w-full" role="img" aria-label="Truyện chính và hai nhánh rẽ, mỗi nhánh mang tên người viết">
        <path data-trunk d="M60 20 V280" pathLength={1} strokeDasharray="1" fill="none" stroke="var(--color-line-strong)" strokeWidth="2" />
        <path data-fork="a" d="M60 164 C 60 200, 150 186, 170 222 L 170 280" pathLength={1} strokeDasharray="1" fill="none" stroke="var(--color-accent)" strokeWidth="2" />
        <path data-fork="b" d="M60 232 C 60 256, 250 236, 270 262 L 270 286" pathLength={1} strokeDasharray="1" fill="none" stroke="var(--color-mist)" strokeWidth="2" />
        {ys.map((y, i) => (
          <g key={y} data-node>
            <circle cx="60" cy={y} r="9" fill="var(--color-surface)" stroke="var(--color-line-strong)" strokeWidth="1.5" />
            <text x="60" y={y + 3.5} textAnchor="middle" fontSize="9" fill="var(--color-muted)" fontFamily="var(--font-sans)">
              {i + 1}
            </text>
          </g>
        ))}
        <text x="84" y="32" fontSize="12" fill="var(--color-muted)" fontFamily="var(--font-sans)">bản chính · @tac_gia</text>

        <g data-leaf="a">
          <circle cx="170" cy="246" r="9" fill="var(--color-accent)" />
          <text x="170" y="249.5" textAnchor="middle" fontSize="9" fill="var(--color-on-accent)" fontFamily="var(--font-sans)">6</text>
          <rect x="188" y="232" rx="11" width="74" height="22" fill="var(--color-accent-soft)" stroke="var(--color-accent-line)" />
          <text x="225" y="247" textAnchor="middle" fontSize="11.5" fill="var(--color-accent)" fontFamily="var(--font-sans)">@bạn</text>
          <text x="270" y="247" fontSize="11" fill="var(--color-muted)" fontFamily="var(--font-sans)">★ kết mới</text>
        </g>
        <g data-leaf="b">
          <circle cx="270" cy="276" r="9" fill="var(--color-mist)" />
          <text x="270" y="279.5" textAnchor="middle" fontSize="9" fill="var(--color-ground)" fontFamily="var(--font-sans)">8</text>
          <text x="288" y="280" fontSize="11.5" fill="var(--color-mist)" fontFamily="var(--font-sans)">@bạn_viết_cùng</text>
        </g>
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------ AI GỢI Ý */

const HINTS = [
  { tag: 'plot twist', text: 'Tin nhắn cuối trong máy Tuấn gửi lúc 3:07 sáng, từ chính số của Hằng.' },
  { tag: 'kinh dị', text: 'Bà Tám tầng dưới hỏi nhỏ: "Dạo này căn 704 có ai mới chuyển tới hả con?"' },
  { tag: 'ngoại tình', text: 'Hộp cơm Tuấn bảo đã ăn ở công ty vẫn còn nguyên trong tủ lạnh, lạnh ngắt.' },
];

function DemoHints() {
  const root = useDemo(
    (tl, el) => {
      const items = gsap.utils.toArray<HTMLElement>('[data-hint]', el);
      gsap.set(items, { opacity: 0, y: 14 });
      tl.to('[data-thinking]', { opacity: 1, duration: 0.2 }, 0).to('[data-thinking]', { opacity: 0, duration: 0.2 }, 1.1);
      items.forEach((it, i) => {
        const at = 1.2 + i * 2.1;
        tl.to(it, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' }, at);
        const body = it.querySelector<HTMLElement>('[data-text]');
        if (body) typeInto(tl, body, at + 0.15);
      });
      tl.to(items, { opacity: 0, y: -8, duration: 0.4, stagger: 0.05 }, '+=2.4');
    },
    () => {},
  );

  return (
    <div ref={root} className="card relative flex flex-col gap-3 p-5 sm:p-6">
      <div className="flex items-center gap-2">
        <span className="text-[var(--color-accent)]" aria-hidden>✍</span>
        <span className="label">AI gợi ý hướng đi tiếp</span>
        <span data-thinking className="ml-auto text-[11.5px] text-[var(--color-muted)] opacity-0">
          đang đọc 7 chương trước…
        </span>
      </div>
      {HINTS.map((h) => (
        <div
          key={h.tag}
          data-hint
          className="group flex flex-col gap-1.5 rounded-[5px] border border-[var(--color-line)] bg-[var(--color-raised)] p-3.5 transition-colors hover:border-[var(--color-accent-line)]"
        >
          <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-accent)]">{h.tag}</span>
          <span data-text={h.text} className="min-h-[2.8em] font-serif text-[15px] leading-relaxed">
            {h.text}
          </span>
        </div>
      ))}
      <p className="text-[12px] text-[var(--color-faint)]">Chọn một gợi ý để AI viết tiếp.</p>
    </div>
  );
}

/* ----------------------------------------------------------- VIẾT CHUNG */

const WRITERS = [
  { who: 'bạn', color: 'var(--color-accent)', text: 'Hằng đứng trước cửa căn 704, chìa khoá trong tay lạnh ngắt. ' },
  { who: 'bạn viết cùng', color: 'var(--color-mist)', text: 'Bên trong có tiếng nước chảy, dù cô nhớ rõ đã khoá vòi trước khi đi. ' },
  { who: 'AI', color: 'var(--color-son)', text: 'Rồi tiếng nước tắt. Ai đó vừa bước ra khỏi phòng tắm.' },
];

function DemoCollab() {
  const root = useDemo(
    (tl, el) => {
      const parts = gsap.utils.toArray<HTMLElement>('[data-part]', el);
      const carets = gsap.utils.toArray<HTMLElement>('[data-caret]', el);
      parts.forEach((p) => (p.textContent = ''));
      gsap.set(carets, { opacity: 0 });
      parts.forEach((p, i) => {
        const at = i * 2.6;
        tl.to(carets[i], { opacity: 1, duration: 0.15 }, at);
        typeInto(tl, p, at + 0.1, 30);
      });
      tl.to(carets, { opacity: 0, duration: 0.3 }, '+=2').call(() => parts.forEach((p) => (p.textContent = '')));
    },
    () => {},
  );

  return (
    <div ref={root} className="card relative flex flex-col gap-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-[var(--color-line)] pb-3">
        <span className="dot dot-on" aria-hidden />
        <span className="text-[12.5px] text-[var(--color-muted)]">Phòng mở · 3 người đang viết</span>
        <span className="ml-auto flex -space-x-1.5">
          {WRITERS.map((w) => (
            <span
              key={w.who}
              title={w.who}
              className="grid h-6 w-6 place-items-center rounded-full border-2 border-[var(--color-surface)] text-[9px] font-semibold text-[var(--color-ground)]"
              style={{ background: w.color }}
            >
              {w.who === 'AI' ? 'AI' : w.who.slice(0, 1).toUpperCase()}
            </span>
          ))}
        </span>
      </div>

      <p className="min-h-[9.5em] font-serif text-[17px] leading-[1.8]">
        {WRITERS.map((w) => (
          <span key={w.who}>
            <span data-part data-text={w.text}>
              {w.text}
            </span>
            {/* A caret like the real editor's: a thin bar and a name flag. */}
            <span data-caret className="relative inline-block h-[1.1em] w-0 align-[-0.15em]" style={{ borderLeft: `2px solid ${w.color}` }}>
              <span
                className="absolute -top-[1.45em] left-[-2px] whitespace-nowrap rounded-[3px] rounded-bl-none px-1.5 py-px font-sans text-[10px] font-semibold text-[var(--color-ground)]"
                style={{ background: w.color }}
              >
                {w.who}
              </span>
            </span>
          </span>
        ))}
      </p>

      <div className="flex items-center gap-2 border-t border-[var(--color-line)] pt-3 text-[12px] text-[var(--color-faint)]">
        <span>Nội dung cập nhật đồng thời cho mọi người</span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- export */

export default function Features() {
  return (
    <section className="mx-auto flex max-w-[1180px] flex-col gap-28 px-5 py-24 sm:px-8 sm:py-32">
      <Feature
        kicker="Nghe"
        title={
          <>
            Chọn giọng đọc.{' '}
            <span className="italic text-[var(--color-accent)]">Điều chỉnh tốc độ.</span>
          </>
        }
        chips={['Giọng đọc AI', 'Tốc độ 1× – 2×', 'Nghe liên tục']}
        demo={<DemoListen />}
      >
        Bạn có thể chọn giọng đọc, chỉnh tốc độ từ 1× đến 2× và nghe liên tục qua các chương.
      </Feature>

      <Feature
        flip
        kicker="Rẽ nhánh"
        title={
          <>
            Viết tiếp{' '}
            <span className="italic text-[var(--color-accent)]">theo hướng của bạn.</span>
          </>
        }
        chips={['Bản gốc giữ nguyên', 'Ghi tên bạn', 'Chọn chương bắt đầu']}
        demo={<DemoBranch />}
      >
        Tạo nhánh mới từ chương bạn chọn và viết tiếp theo ý bạn. Nhánh được ghi tên bạn, bản gốc được giữ nguyên.
      </Feature>

      <Feature
        kicker="AI gợi ý"
        title={
          <>
            Gợi ý từ AI.{' '}
            <span className="italic text-[var(--color-accent)]">Bạn chọn hướng viết.</span>
          </>
        }
        chips={['Theo mạch truyện', 'Gợi ý theo thể loại', 'Bạn quyết định nội dung']}
        demo={<DemoHints />}
      >
        AI dựa trên các chương trước và thể loại để gợi ý hướng viết. Bạn chọn ý tưởng và chỉnh sửa trước khi đăng.
      </Feature>

      <Feature
        flip
        kicker="Viết chung"
        title={
          <>
            Viết cùng bạn bè.{' '}
            <span className="italic text-[var(--color-accent)]">Cập nhật ngay khi gõ.</span>
          </>
        }
        chips={['Sửa cùng lúc', 'Thấy con trỏ của nhau', 'AI hỗ trợ']}
        demo={<DemoCollab />}
      >
        Mời bạn bè cùng sửa bản thảo trên một trang. Bạn có thể theo dõi thay đổi và nhờ AI viết tiếp.
      </Feature>
    </section>
  );
}
