/**
 * In-page evaluate() source for brand site scraping.
 *
 * Ported verbatim from `apps/services/api/src/playground/website-extractor/
 * prompts/extraction-methodology.ts` (step 3 combined script, lines 101-225)
 * with two adjustments:
 *   - Wrapped to take an args object (so we can compose multiple sub-scrapes
 *     in one evaluate call without re-stringifying).
 *   - JSON.stringify is dropped because Playwright's `page.evaluate<T>()` types
 *     the return as JS objects across the bridge.
 *
 * This file is JS-as-string by design so it runs inside the Playwright
 * browser context. Do not refactor into TS functions - they cannot
 * cross the page <-> Node boundary.
 */

export interface PageScrapeFontUrl {
  family: string
  format: string
  url: string
  weight: string
}

export interface PageScrapeFontUsage {
  family: string
  sizes: string[]
  weights: string[]
}

export interface PageScrapeImage {
  alt: string
  height: number
  isHero: boolean
  section: string
  src: string
  width: number
}

export interface PageScrapeLogo {
  alt?: string
  height?: number
  html?: string
  /**
   * Img wrapped in `<a href="/">`. Strongest single positive signal that this
   * is THE canonical brand mark - every CMS template wraps the logo in a
   * home-link.
   */
  inHomeLink?: boolean
  /**
   * Which DOM scope the logo was scanned from. Header logos rank above footer.
   * Sponsor / customer / press logos in the body are deliberately not in this
   * array - they flow to synthesis as text via `images[].alt` for social_proof
   * claims: logo extraction is scoped to the header and footer only.
   */
  location?: 'favicon' | 'footer' | 'header'
  src?: string
  type: 'favicon' | 'img' | 'inline-svg' | 'og-image'
  viewBox?: null | string
  width?: number
}

export interface PageScrapeMeta {
  description: string
  ogDescription: string
  ogImage: string
  ogTitle: string
  title: string
}

export interface PageScrapeResult {
  fontUrls: PageScrapeFontUrl[]
  images: PageScrapeImage[]
  logos: PageScrapeLogo[]
  meta: PageScrapeMeta
  sections: PageScrapeSection[]
  socials: { platform: string; url: string }[]
  tokens: PageScrapeTokens
  videos: PageScrapeVideo[]
}

export interface PageScrapeSection {
  background: string
  body: string
  cta: null | { href: string; label: string }
  heading: string
  id: string
  images: string[]
  layout: string
  subheading: string
  tag: string
}

export interface PageScrapeTokens {
  colors: string[]
  cssVars: string[]
  fontUsage: PageScrapeFontUsage[]
  spacing: string[]
}

export interface PageScrapeVideo {
  autoplay: boolean
  loop: boolean
  muted: boolean
  poster: string
  src: string
}

/**
 * Returns a JS source string suitable for `page.evaluate<PageScrapeResult>(...)`.
 * Self-contained IIFE; no external deps inside the browser context.
 */
export const PAGE_SCRAPE_SOURCE = `
(() => {
  const base = document.baseURI;
  const abs = (url) => { try { return new URL(url, base).href } catch { return '' } };

  // Logos -- two-pass extraction.
  //
  // Sponsor/customer/press logos in the body are intentionally NOT extracted
  // here; their alt text already flows to synthesis through the regular
  // images array, where the LLM can use it for social_proof claims. We
  // never want to render someone else brand mark as ours - that is a legal
  // risk and a UX mistake.
  const logos = [];
  const LOGO_HINT_RE = /logo|wordmark|brand|mark/i;
  const DECORATIVE_SVG_RE = /(divider|separator|decor|stroke|wave|gradient|underline|swirl)/i;
  // Logos are constrained in height. A typical navbar wordmark is ~28px tall; the
  // Visa/GitHub partner-strip logos are ~80px. A 600px-tall image inside the
  // header is a hero/carousel asset, not a logo.
  const LOGO_MAX_HEIGHT_PX = 120;
  const isHomeLinkHref = (href) => {
    if (!href) return false;
    try {
      const u = new URL(href, location.href);
      if (u.origin !== location.origin) return false;
      const p = u.pathname.replace(/\\/+$/, '');
      return p === '' || p === '/';
    } catch (_) { return false; }
  };
  // Tag a candidate's DOM scope. Footer wins over header so a home-link in
  // the footer doesn't get mislabeled when the page also has a header.
  const locateScope = (el) => {
    if (!el) return undefined;
    if (el.closest('footer, [role=contentinfo], [class*=footer], [id*=footer]')) return 'footer';
    if (el.closest('header, [role=banner], nav, [role=navigation], [class*=navbar], [class*=topbar], [class*=header], [id*=header]')) return 'header';
    return undefined;
  };
  const isDecorativeSvg = (svg) => {
    // Sprite atlas: SVGs nested inside other SVGs are <use>-target glyphs.
    if (svg.parentElement && svg.parentElement.closest('svg')) return true;
    const hint = (svg.getAttribute('class') || '') + ' ' + (svg.getAttribute('id') || '');
    if (DECORATIVE_SVG_RE.test(hint)) return true;
    // Tiny viewBox stretchers (Squarespace section-dividers etc.).
    const vb = (svg.getAttribute('viewBox') || '').split(/\\s+/).map(Number);
    if (vb.length === 4) {
      const vw = vb[2]; const vh = vb[3];
      if (Number.isFinite(vw) && Number.isFinite(vh) && vw * vh < 100) return true;
    }
    // Empty wrappers (svg used purely as a positioned box).
    return !svg.querySelector('path, g, rect, polygon, polyline, text, circle, ellipse');
  };
  // Bake rendered colors into inline-SVG logo markup before serializing.
  // Modern site logos carry no inline fill -- color comes from page CSS
  // (fill: currentColor, var(--brand), or a class). Serialized standalone and
  // rasterized by sharp with no stylesheet, every paint resolves to black, so
  // the real mark is lost. getComputedStyle (available in-page)
  // resolves currentColor / var() / classes to concrete rgb(); copy those onto
  // a detached clone so the staged PNG keeps the brand's actual colors.
  const SVG_COLOR_PROPS = ['fill', 'stroke', 'stop-color', 'color'];
  const inlineSvgColors = (svg) => {
    try {
      const clone = svg.cloneNode(true);
      const origNodes = [svg].concat(Array.from(svg.querySelectorAll('*')));
      const cloneNodes = [clone].concat(Array.from(clone.querySelectorAll('*')));
      const count = Math.min(origNodes.length, cloneNodes.length);
      for (let i = 0; i < count; i++) {
        const target = cloneNodes[i];
        if (!target.setAttribute) continue;
        const cs = getComputedStyle(origNodes[i]);
        for (const prop of SVG_COLOR_PROPS) {
          const raw = cs.getPropertyValue(prop);
          const value = raw ? raw.trim() : '';
          // Skip absent / no-paint / unresolved values. A concrete rgb() is
          // what we want to bake; 'none' means no paint, var() means the
          // browser could not resolve it (leave it for sharp's default).
          if (!value || value === 'none' || value === 'currentcolor') continue;
          if (value.indexOf('var(') !== -1) continue;
          target.setAttribute(prop, value);
        }
      }
      return clone.outerHTML;
    } catch (e) {
      return svg.outerHTML;
    }
  };
  const seenLogo = new WeakSet();
  const acceptImg = (img, loc, inHomeLink) => {
    if (seenLogo.has(img)) return;
    seenLogo.add(img);
    const src = img.currentSrc || img.src || '';
    if (!src || src.startsWith('data:')) return;
    const r = img.getBoundingClientRect();
    const w = Math.round(r.width) || img.naturalWidth || 0;
    const h = Math.round(r.height) || img.naturalHeight || 0;
    // Hero-sized images masquerading as logos.
    if (h > 0 && h > LOGO_MAX_HEIGHT_PX) return;
    // Both dimensions known and tiny -> utility icon.
    if (w > 0 && h > 0 && w < 24 && h < 24) return;
    // Both dimensions known and favicon-sized utility (the explicit favicon
    // path below covers true favicons).
    if (w > 0 && h > 0 && w <= 32 && h <= 32) return;
    logos.push({
      type: 'img',
      src: abs(src),
      alt: img.alt || '',
      location: loc,
      width: w,
      height: h,
      inHomeLink: !!inHomeLink,
    });
  };
  const acceptSvg = (svg, loc, inHomeLink) => {
    if (seenLogo.has(svg)) return;
    seenLogo.add(svg);
    if (isDecorativeSvg(svg)) return;
    const r = svg.getBoundingClientRect();
    const w = Math.round(r.width) || 0;
    const h = Math.round(r.height) || 0;
    // Hero-sized inline SVG illustrations.
    if (h > 0 && h > LOGO_MAX_HEIGHT_PX) return;
    // Size floor only when bbox is real. Lazy-loaded / sticky-positioned /
    // hidden-mobile-menu SVGs report 0x0 - trust upstream signals there.
    if (w > 0 && h > 0 && (w < 60 || h < 16)) return;
    logos.push({
      type: 'inline-svg',
      html: inlineSvgColors(svg),
      viewBox: svg.getAttribute('viewBox'),
      location: loc,
      width: w,
      height: h,
      inHomeLink: !!inHomeLink,
    });
  };

  // Pass 1 - home-link wrap. The most robust cross-CMS signal. Webflow's
  // <a class="a_navbar_logo" href="/"> on a Webflow site is invisible to a
  // header-scope scan because Webflow's <header> tag wraps the hero (H1 +
  // form), not the navbar. Walking <a href="/"> finds it directly.
  for (const a of document.querySelectorAll('a[href]')) {
    if (!isHomeLinkHref(a.getAttribute('href'))) continue;
    const scope = locateScope(a);
    const innerImg = a.querySelector('img');
    if (innerImg) acceptImg(innerImg, scope, true);
    const innerSvg = a.querySelector('svg');
    if (innerSvg) acceptSvg(innerSvg, scope, true);
  }

  // Pass 2 - chrome-scope hint scan. Fallback for sites that don't wrap the
  // brand mark in <a href="/">. Inside the picked region, only accept
  // elements with an explicit logo/wordmark/brand hint - bare "image inside
  // header" lets mega-menu carousels through. querySelector singular keeps
  // [class*=header] from matching section-header / card-header deep in body.
  const headerScope =
    document.querySelector('header')
    || document.querySelector('[role=banner]')
    || document.querySelector('nav')
    || document.querySelector('[role=navigation]')
    || document.querySelector('[class*=navbar]')
    || document.querySelector('[class*=topbar]')
    || document.querySelector('[class*=header]')
    || document.querySelector('[id*=header]');
  const footerScope =
    document.querySelector('footer')
    || document.querySelector('[role=contentinfo]')
    || document.querySelector('[class*=footer]')
    || document.querySelector('[id*=footer]');
  const scanChrome = (root, loc) => {
    if (!root) return;
    for (const img of root.querySelectorAll('img')) {
      const altSrc = (img.alt || '') + ' ' + (img.currentSrc || img.src || '');
      if (!LOGO_HINT_RE.test(altSrc)) continue;
      acceptImg(img, loc, false);
    }
    for (const svg of root.querySelectorAll('svg')) {
      const hint = (svg.getAttribute('class') || '') + ' ' + (svg.getAttribute('id') || '');
      if (!LOGO_HINT_RE.test(hint)) continue;
      acceptSvg(svg, loc, false);
    }
  };
  scanChrome(headerScope, 'header');
  scanChrome(footerScope, 'footer');

  // Favicon: explicit, structural, always valid even if 16x16.
  const favicon = document.querySelector('link[rel*="icon"]');
  if (favicon) logos.push({ type: 'favicon', src: abs(favicon.href), location: 'favicon' });

  // OG image: meta property=og:image is the brand-curated share card.
  // Always stage it - users frequently pick the OG card when the inline
  // navbar mark is small or missing.
  const ogImageEl = document.querySelector('meta[property="og:image"]');
  if (ogImageEl && ogImageEl.content) {
    const ogSrc = abs(ogImageEl.content);
    if (ogSrc) logos.push({ type: 'og-image', src: ogSrc });
  }

  // Images
  const imgSet = new Set();
  const images = [];
  document.querySelectorAll('img').forEach(img => {
    const src = abs(img.currentSrc || img.src);
    if (!src || imgSet.has(src) || src.startsWith('data:') || /pixel|tracking|spacer/.test(src)) return;
    imgSet.add(src);
    const r = img.getBoundingClientRect();
    images.push({
      src,
      alt: img.alt || '',
      width: Math.round(r.width),
      height: Math.round(r.height),
      isHero: r.top < window.innerHeight,
      section: img.closest('section')?.id || img.closest('[class]')?.className?.split(' ')[0] || '',
    });
  });
  document.querySelectorAll('*').forEach(el => {
    const bg = getComputedStyle(el).backgroundImage;
    if (bg && bg !== 'none') {
      [...bg.matchAll(/url\\(["']?([^"')]+)["']?\\)/g)].forEach(m => {
        const src = abs(m[1]);
        if (src && !imgSet.has(src) && !src.startsWith('data:') && !src.includes('gradient')) {
          imgSet.add(src);
          const r = el.getBoundingClientRect();
          images.push({
            src,
            alt: 'bg',
            width: Math.round(r.width),
            height: Math.round(r.height),
            isHero: r.top < window.innerHeight,
            section: 'background',
          });
        }
      });
    }
  });
  document.querySelectorAll('picture source').forEach(s => {
    const url = abs(s.srcset?.split(',')[0]?.trim()?.split(' ')[0] || '');
    if (url && !imgSet.has(url)) {
      imgSet.add(url);
      images.push({ src: url, alt: 'picture', width: 0, height: 0, isHero: false, section: 'picture' });
    }
  });

  // Fonts
  const fontUrls = [];
  [...document.styleSheets].forEach(sheet => {
    try {
      [...sheet.cssRules].forEach(rule => {
        if (rule instanceof CSSFontFaceRule) {
          const family = rule.style.getPropertyValue('font-family').replace(/['"]/g, '').trim();
          const weight = rule.style.getPropertyValue('font-weight') || '400';
          const src = rule.style.getPropertyValue('src');
          [...(src.matchAll(/url\\(["']?([^"')]+)["']?\\)/g))].forEach(m => {
            fontUrls.push({ family, weight, url: abs(m[1]), format: m[1].match(/\\.(woff2?|ttf|otf|eot)/)?.[1] || 'unknown' });
          });
        }
      });
    } catch (e) { /* cross-origin stylesheet -- skip */ }
  });
  document.querySelectorAll('link[href*="fonts.googleapis.com"]').forEach(link => fontUrls.push({ family: 'google-fonts-css', weight: 'all', url: link.href, format: 'css' }));
  document.querySelectorAll('link[rel="preload"][as="font"]').forEach(link => fontUrls.push({ family: 'preloaded', weight: 'unknown', url: abs(link.href), format: link.href.match(/\\.(woff2?|ttf|otf)/)?.[1] || 'woff2' }));

  // Videos
  const videos = [];
  document.querySelectorAll('video, video source').forEach(el => {
    const src = abs(el.src || el.querySelector?.('source')?.src || '');
    if (src) videos.push({ src, autoplay: !!el.autoplay, loop: !!el.loop, muted: !!el.muted, poster: el.poster || '' });
  });

  // Design tokens
  const cssVars = [];
  [...document.styleSheets].forEach(s => {
    try {
      [...s.cssRules].forEach(r => {
        if (r.type === 1) {
          const m = r.cssText.match(/--[\\w-]+:\\s*[^;]+/g);
          if (m) cssVars.push(...m);
        }
      });
    } catch (e) { /* cross-origin -- skip */ }
  });
  const colorSet = new Set();
  document.querySelectorAll('h1,h2,h3,p,a,button,section,header,footer,[class*="hero"],[class*="cta"]').forEach(el => {
    const s = getComputedStyle(el);
    if (s.color !== 'rgb(0, 0, 0)') colorSet.add(s.color);
    if (s.backgroundColor !== 'rgba(0, 0, 0, 0)') colorSet.add(s.backgroundColor);
  });
  const fontUsage = new Map();
  document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,a,button,span,li').forEach(el => {
    const s = getComputedStyle(el);
    const k = s.fontFamily;
    if (!fontUsage.has(k)) fontUsage.set(k, { family: k, weights: new Set(), sizes: new Set() });
    fontUsage.get(k).weights.add(s.fontWeight);
    fontUsage.get(k).sizes.add(s.fontSize);
  });
  const spacings = new Set();
  document.querySelectorAll('section,[class*="container"],main,[class*="wrapper"]').forEach(el => {
    const s = getComputedStyle(el);
    spacings.add(s.padding);
    spacings.add(s.margin);
    spacings.add(s.gap);
  });

  // Sections
  const sections = [];
  document.querySelectorAll('section, header, footer, main > div, [class*="hero"], [class*="cta"]').forEach((el, i) => {
    const r = el.getBoundingClientRect();
    if (r.height < 50) return;
    const h = el.querySelector('h1, h2, h3');
    const sub = el.querySelector('h2, h3, h4, p');
    const body = [...el.querySelectorAll('p')].map(p => p.textContent.trim()).filter(t => t.length > 20).join(' ');
    const ctaEl = el.querySelector('a[class*="btn"], a[class*="cta"], button[class*="btn"], button[class*="cta"]');
    const sectionImgs = [...el.querySelectorAll('img')].map(img => abs(img.currentSrc || img.src)).filter(Boolean);
    sections.push({
      id: el.id || el.className?.split(' ')[0] || ('section-' + i),
      tag: el.tagName.toLowerCase(),
      heading: h?.textContent?.trim() || '',
      subheading: sub && sub !== h ? (sub.textContent?.trim() || '') : '',
      body: body.slice(0, 500),
      cta: ctaEl ? { label: ctaEl.textContent.trim(), href: abs(ctaEl.href || '') } : null,
      images: sectionImgs,
      layout: getComputedStyle(el).display + ' ' + getComputedStyle(el).flexDirection,
      background: getComputedStyle(el).background.slice(0, 200),
    });
  });

  // Socials (footer + header anchors to known platforms)
  const socialPlatforms = [
    ['instagram.com', 'instagram'],
    ['twitter.com', 'twitter'],
    ['x.com', 'twitter'],
    ['facebook.com', 'facebook'],
    ['linkedin.com', 'linkedin'],
    ['youtube.com', 'youtube'],
    ['youtu.be', 'youtube'],
    ['tiktok.com', 'tiktok'],
    ['pinterest.com', 'pinterest'],
    ['threads.net', 'threads'],
    ['github.com', 'github'],
  ];
  const socialMap = new Map();
  document.querySelectorAll('a[href]').forEach(a => {
    const href = a.href || '';
    for (const [domain, platform] of socialPlatforms) {
      if (href.includes(domain) && !socialMap.has(platform)) {
        socialMap.set(platform, href);
      }
    }
  });
  const socials = [...socialMap.entries()].map(([platform, url]) => ({ platform, url }));

  // Meta
  const meta = {
    title: document.title || '',
    description: document.querySelector('meta[name="description"]')?.content || '',
    ogTitle: document.querySelector('meta[property="og:title"]')?.content || '',
    ogDescription: document.querySelector('meta[property="og:description"]')?.content || '',
    ogImage: abs(document.querySelector('meta[property="og:image"]')?.content || ''),
  };

  return {
    logos,
    images,
    fontUrls,
    videos,
    tokens: {
      cssVars,
      colors: [...colorSet],
      fontUsage: [...fontUsage.values()].map(f => ({ ...f, weights: [...f.weights], sizes: [...f.sizes] })),
      spacing: [...spacings].filter(v => v && v !== '0px' && v !== 'normal'),
    },
    sections,
    socials,
    meta,
  };
})()
`

/**
 * Slow-scroll script that triggers lazy-loaded images / sections before the
 * scrape runs.
 */
export const SCROLL_SCRIPT = `
(async () => {
  const total = document.body.scrollHeight;
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    window.scrollTo(0, (total / steps) * i);
    await new Promise(r => setTimeout(r, 250));
  }
  window.scrollTo(0, 0);
  await new Promise(r => setTimeout(r, 300));
})()
`
