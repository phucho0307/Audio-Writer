/**
 * Cover art, one composition per story, drawn from that story's own imagery.
 *
 * Everything here is built for thumbnail legibility first: a single focal point,
 * strong value contrast, and silhouettes rather than fine detail. A cover that
 * only works at full size is useless in a browse grid.
 *
 * Each entry returns the body of a 600x1080 SVG. The seeder wraps it with the
 * shared gradient, grain and vignette.
 */

export interface Palette {
  bg: string;
  mid: string;
  accent: string;
}

export interface CoverArt {
  palette: Palette;
  /** SVG body, drawn inside viewBox="0 0 600 1080". */
  body: (p: Palette) => string;
}

export const COVER_ART: Record<string, CoverArt> = {
  /**
   * Căn Hộ 704 - the door, seen from the corridor. Light underneath is broken
   * by two feet standing on the other side, not moving.
   */
  'can-ho-704': {
    palette: { bg: '#0b1016', mid: '#17242e', accent: '#5ec4d6' },
    body: (p) => `
      <rect x="0" y="0" width="600" height="1080" fill="${p.bg}"/>
      <path d="M0 0 H600 V1080 H0 Z" fill="${p.mid}" opacity=".25"/>

      <!-- corridor walls -->
      <path d="M0 120 L130 250 L130 900 L0 1010 Z" fill="${p.bg}" opacity=".85"/>
      <path d="M600 120 L470 250 L470 900 L600 1010 Z" fill="${p.bg}" opacity=".85"/>

      <!-- the door -->
      <rect x="150" y="238" width="300" height="632" fill="${p.mid}"/>
      <rect x="168" y="256" width="264" height="596" fill="${p.bg}" opacity=".55"/>
      <rect x="186" y="286" width="228" height="250" fill="${p.mid}" opacity=".5"/>
      <rect x="186" y="566" width="228" height="250" fill="${p.mid}" opacity=".5"/>
      <circle cx="408" cy="596" r="9" fill="${p.accent}" opacity=".65"/>

      <!-- 704 plate -->
      <rect x="258" y="176" width="84" height="40" rx="3" fill="${p.mid}"/>
      <text x="300" y="205" font-family="Georgia,serif" font-size="26"
            fill="${p.accent}" text-anchor="middle" opacity=".95">704</text>

      <!-- light under the door, interrupted by two feet -->
      <rect x="150" y="862" width="300" height="14" fill="${p.accent}" opacity=".9"/>
      <rect x="242" y="862" width="34" height="14" fill="${p.bg}"/>
      <rect x="318" y="862" width="34" height="14" fill="${p.bg}"/>
      <rect x="150" y="876" width="300" height="70" fill="${p.accent}" opacity=".13"/>
      <ellipse cx="300" cy="890" rx="190" ry="26" fill="${p.accent}" opacity=".10"/>
    `,
  },

  /**
   * Trọng Sinh - a mirror whose reflection is already a colder person. The
   * frame is intact; the woman inside it is not the same one.
   */
  'trong-sinh-ngay-bi-hai': {
    palette: { bg: '#150a10', mid: '#3d1c2a', accent: '#e0ab55' },
    body: (p) => `
      <rect x="0" y="0" width="600" height="1080" fill="${p.bg}"/>

      <!-- frame -->
      <rect x="132" y="212" width="336" height="656" rx="168" fill="${p.accent}" opacity=".22"/>
      <rect x="146" y="226" width="308" height="628" rx="154" fill="${p.mid}"/>
      <rect x="164" y="244" width="272" height="592" rx="136" fill="${p.bg}"/>

      <!-- figure, silhouette only -->
      <ellipse cx="300" cy="450" rx="62" ry="76" fill="${p.mid}"/>
      <path d="M300 528 C232 528 196 596 190 700 L190 836 L410 836 L410 700 C404 596 368 528 300 528 Z" fill="${p.mid}"/>
      <path d="M238 402 C238 356 262 336 300 336 C338 336 362 356 362 402 L362 430 C340 404 260 404 238 430 Z" fill="${p.bg}" opacity=".8"/>

      <!-- the split: right half is colder, and holds a glint -->
      <path d="M300 244 L300 836" stroke="${p.accent}" stroke-width="1.5" opacity=".5"/>
      <path d="M300 244 L322 380 L288 470 L316 590 L296 700 L300 836"
            stroke="${p.accent}" stroke-width="3" fill="none" opacity=".95"/>
      <circle cx="332" cy="446" r="5" fill="${p.accent}"/>
      <circle cx="332" cy="446" r="16" fill="${p.accent}" opacity=".25"/>

      <!-- petals -->
      <g fill="${p.accent}" opacity=".55">
        <ellipse cx="104" cy="316" rx="10" ry="5" transform="rotate(-28 104 316)"/>
        <ellipse cx="502" cy="392" rx="9" ry="4.5" transform="rotate(18 502 392)"/>
        <ellipse cx="88" cy="620" rx="8" ry="4" transform="rotate(-52 88 620)"/>
        <ellipse cx="518" cy="712" rx="11" ry="5" transform="rotate(34 518 712)"/>
        <ellipse cx="128" cy="880" rx="9" ry="4.5" transform="rotate(-14 128 880)"/>
      </g>
    `,
  },

  /**
   * Hệ Thống Săn Quỷ - the phone is the only light source, held up in an alley
   * that narrows to nothing. The countdown is the subject.
   */
  'he-thong-san-quy': {
    palette: { bg: '#080b14', mid: '#1e1740', accent: '#a970f7' },
    body: (p) => `
      <rect x="0" y="0" width="600" height="1080" fill="${p.bg}"/>

      <!-- alley walls converging -->
      <path d="M0 60 L196 372 L196 1080 L0 1080 Z" fill="${p.mid}" opacity=".85"/>
      <path d="M600 60 L404 372 L404 1080 L600 1080 Z" fill="${p.mid}" opacity=".85"/>
      <rect x="196" y="372" width="208" height="708" fill="${p.bg}"/>

      <!-- distant doorway -->
      <rect x="264" y="392" width="72" height="118" fill="${p.mid}" opacity=".9"/>

      <!-- wet ground reflection -->
      <rect x="196" y="900" width="208" height="180" fill="${p.accent}" opacity=".07"/>

      <!-- the phone -->
      <rect x="222" y="560" width="156" height="272" rx="18" fill="${p.accent}" opacity=".2"/>
      <rect x="234" y="572" width="132" height="248" rx="12" fill="${p.bg}"/>
      <rect x="234" y="572" width="132" height="248" rx="12" fill="${p.accent}" opacity=".16"/>

      <text x="300" y="646" font-family="ui-monospace,monospace" font-size="15"
            fill="${p.accent}" text-anchor="middle" opacity=".8">NHIỆM VỤ</text>
      <rect x="252" y="662" width="96" height="1.5" fill="${p.accent}" opacity=".45"/>
      <text x="300" y="722" font-family="ui-monospace,monospace" font-size="40"
            fill="${p.accent}" text-anchor="middle">03:07</text>
      <rect x="252" y="752" width="96" height="6" rx="3" fill="${p.accent}" opacity=".3"/>
      <rect x="252" y="752" width="34" height="6" rx="3" fill="${p.accent}"/>

      <!-- glow cast by the screen -->
      <ellipse cx="300" cy="700" rx="230" ry="300" fill="${p.accent}" opacity=".10"/>
      <ellipse cx="300" cy="700" rx="130" ry="180" fill="${p.accent}" opacity=".10"/>

      <!-- rain -->
      <g stroke="${p.accent}" stroke-width="1.1" opacity=".3">
        <line x1="86" y1="120" x2="66" y2="188"/><line x1="524" y1="88" x2="504" y2="156"/>
        <line x1="168" y1="252" x2="150" y2="312"/><line x1="452" y1="286" x2="434" y2="346"/>
        <line x1="248" y1="128" x2="230" y2="188"/><line x1="366" y1="196" x2="348" y2="256"/>
        <line x1="120" y1="440" x2="104" y2="494"/><line x1="492" y1="470" x2="476" y2="524"/>
      </g>
    `,
  },

  /**
   * Xuyên Việt - the one warm cover in the set. Terraces stepping up to a low
   * sun, one small figure kneeling at the near edge.
   */
  'xuyen-viet-trong-rau': {
    palette: { bg: '#0d1710', mid: '#25412a', accent: '#e8b45c' },
    body: (p) => `
      <rect x="0" y="0" width="600" height="1080" fill="${p.bg}"/>

      <!-- sky and sun -->
      <rect x="0" y="0" width="600" height="430" fill="${p.mid}" opacity=".5"/>
      <circle cx="392" cy="268" r="74" fill="${p.accent}" opacity=".85"/>
      <circle cx="392" cy="268" r="128" fill="${p.accent}" opacity=".16"/>

      <!-- far ridges -->
      <path d="M0 400 L150 300 L280 386 L410 296 L600 404 L600 448 L0 448 Z" fill="${p.bg}" opacity=".8"/>

      <!-- terraces stepping toward the viewer -->
      <path d="M-20 470 Q300 420 620 470 L620 536 Q300 486 -20 536 Z" fill="${p.mid}" opacity=".55"/>
      <path d="M-20 548 Q300 492 620 548 L620 626 Q300 570 -20 626 Z" fill="${p.accent}" opacity=".26"/>
      <path d="M-20 640 Q300 578 620 640 L620 728 Q300 666 -20 728 Z" fill="${p.mid}" opacity=".75"/>
      <path d="M-20 742 Q300 674 620 742 L620 842 Q300 774 -20 842 Z" fill="${p.accent}" opacity=".22"/>
      <path d="M-20 856 Q300 782 620 856 L620 1080 L-20 1080 Z" fill="${p.mid}"/>

      <!-- water catching the light on two terraces -->
      <path d="M-20 548 Q300 492 620 548 L620 566 Q300 510 -20 566 Z" fill="${p.accent}" opacity=".5"/>
      <path d="M-20 742 Q300 674 620 742 L620 762 Q300 694 -20 762 Z" fill="${p.accent}" opacity=".4"/>

      <!-- the figure, kneeling, hand to the soil -->
      <g fill="${p.bg}">
        <circle cx="300" cy="838" r="19"/>
        <path d="M300 858 C276 858 264 884 262 916 L262 946 L338 946 L338 916 C336 884 324 858 300 858 Z"/>
        <path d="M330 890 L360 922 L352 930 L322 900 Z"/>
      </g>
      <ellipse cx="362" cy="936" rx="26" ry="7" fill="${p.accent}" opacity=".3"/>
    `,
  },

  /**
   * Mạt Thế - the tally wall from chapter one. Seven marks, one struck out,
   * and the black water already at the bottom of the frame.
   */
  'mat-the-ngay-thu-bay': {
    palette: { bg: '#080c0e', mid: '#16242b', accent: '#e0483c' },
    body: (p) => `
      <rect x="0" y="0" width="600" height="1080" fill="${p.bg}"/>
      <rect x="0" y="0" width="600" height="1080" fill="${p.mid}" opacity=".45"/>

      <!-- concrete texture -->
      <g fill="${p.bg}" opacity=".35">
        <rect x="0" y="180" width="600" height="3"/>
        <rect x="0" y="512" width="600" height="3"/>
        <rect x="292" y="0" width="3" height="720"/>
      </g>

      <!-- tally marks, charcoal on wall -->
      <g stroke="${p.mid}" stroke-width="9" stroke-linecap="round" opacity=".95">
        <line x1="120" y1="300" x2="132" y2="392"/>
        <line x1="160" y1="300" x2="172" y2="392"/>
        <line x1="200" y1="300" x2="212" y2="392"/>
        <line x1="240" y1="300" x2="252" y2="392"/>
        <line x1="112" y1="380" x2="264" y2="312"/>

        <line x1="330" y1="300" x2="342" y2="392"/>
        <line x1="370" y1="300" x2="382" y2="392"/>
      </g>
      <!-- the one struck out -->
      <g stroke="${p.accent}" stroke-width="7" stroke-linecap="round">
        <line x1="316" y1="286" x2="400" y2="406"/>
        <line x1="400" y1="286" x2="316" y2="406"/>
      </g>

      <!-- three rules scrawled below -->
      <g fill="${p.mid}" opacity=".8">
        <rect x="120" y="470" width="300" height="7" rx="3"/>
        <rect x="120" y="500" width="248" height="7" rx="3"/>
        <rect x="120" y="530" width="332" height="7" rx="3"/>
      </g>
      <rect x="120" y="530" width="332" height="7" rx="3" fill="${p.accent}" opacity=".75"/>

      <!-- black water, already inside -->
      <rect x="0" y="700" width="600" height="380" fill="${p.bg}" opacity=".96"/>
      <g stroke="${p.mid}" stroke-width="1.4" opacity=".5">
        <line x1="0" y1="722" x2="600" y2="722"/><line x1="0" y1="768" x2="600" y2="768"/>
        <line x1="0" y1="826" x2="600" y2="826"/><line x1="0" y1="896" x2="600" y2="896"/>
      </g>

      <!-- one light left on, and its reflection -->
      <circle cx="470" cy="628" r="7" fill="${p.accent}"/>
      <circle cx="470" cy="628" r="26" fill="${p.accent}" opacity=".2"/>
      <rect x="466" y="700" width="8" height="200" fill="${p.accent}" opacity=".18"/>
    `,
  },

  /**
   * Cổ Đại Y Nữ - the bowl of "tonic" and the silver needle that will test it,
   * lit by one lamp through a lattice screen.
   */
  'co-dai-y-nu': {
    palette: { bg: '#0b1210', mid: '#1b2f2b', accent: '#8fd0b4' },
    body: (p) => `
      <rect x="0" y="0" width="600" height="1080" fill="${p.bg}"/>

      <!-- lattice screen behind, lamplight through it -->
      <ellipse cx="300" cy="330" rx="230" ry="230" fill="${p.accent}" opacity=".14"/>
      <g stroke="${p.mid}" stroke-width="7" opacity=".9">
        <line x1="70" y1="0" x2="70" y2="600"/><line x1="164" y1="0" x2="164" y2="600"/>
        <line x1="258" y1="0" x2="258" y2="600"/><line x1="352" y1="0" x2="352" y2="600"/>
        <line x1="446" y1="0" x2="446" y2="600"/><line x1="540" y1="0" x2="540" y2="600"/>
        <line x1="0" y1="96" x2="600" y2="96"/><line x1="0" y1="212" x2="600" y2="212"/>
        <line x1="0" y1="328" x2="600" y2="328"/><line x1="0" y1="444" x2="600" y2="444"/>
      </g>
      <g stroke="${p.accent}" stroke-width="2" opacity=".35">
        <line x1="117" y1="154" x2="211" y2="154"/><line x1="305" y1="270" x2="399" y2="270"/>
        <line x1="211" y1="386" x2="305" y2="386"/>
      </g>

      <!-- table -->
      <rect x="0" y="620" width="600" height="460" fill="${p.mid}" opacity=".85"/>
      <rect x="0" y="620" width="600" height="6" fill="${p.accent}" opacity=".35"/>

      <!-- the bowl -->
      <ellipse cx="272" cy="742" rx="112" ry="30" fill="${p.mid}"/>
      <path d="M160 742 C160 812 200 852 272 852 C344 852 384 812 384 742 Z" fill="${p.bg}"/>
      <ellipse cx="272" cy="742" rx="96" ry="24" fill="${p.accent}" opacity=".85"/>
      <ellipse cx="248" cy="736" rx="30" ry="8" fill="#fff" opacity=".22"/>

      <!-- the silver needle, laid across the table, already darkening at the tip -->
      <rect x="386" y="884" width="176" height="4" rx="2" fill="${p.accent}" opacity=".95"
            transform="rotate(-8 386 884)"/>
      <circle cx="392" cy="886" r="7" fill="${p.bg}"/>
      <circle cx="392" cy="886" r="7" fill="${p.accent}" opacity=".35"/>

      <!-- scattered herbs -->
      <g fill="${p.accent}" opacity=".45">
        <ellipse cx="122" cy="906" rx="16" ry="7" transform="rotate(-22 122 906)"/>
        <ellipse cx="158" cy="936" rx="13" ry="6" transform="rotate(14 158 936)"/>
        <ellipse cx="96" cy="948" rx="11" ry="5" transform="rotate(-40 96 948)"/>
      </g>
    `,
  },
};
