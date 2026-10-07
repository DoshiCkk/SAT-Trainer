#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Parse College Board Question Bank PDF exports (Themes/*.pdf) into public/questions.json.

One PDF per domain. Source of truth for domain/skill/difficulty is the metadata
table inside the PDF; the filename is only cross-checked and reported on mismatch.
Re-running merges into the existing questions.json (attempt history lives in
IndexedDB keyed by question id and is never touched here).
"""
import argparse
import html
import io
import json
import os
import re
import sys
import time
from collections import Counter, defaultdict

import fitz  # PyMuPDF

if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
THEMES_DIR = os.path.join(ROOT, "Themes")
OUT_JSON = os.path.join(ROOT, "public", "questions.json")
IMG_DIR = os.path.join(ROOT, "public", "img")

RW_DOMAINS = [
    "Information and Ideas",
    "Craft and Structure",
    "Expression of Ideas",
    "Standard English Conventions",
]
MATH_DOMAINS = [
    "Algebra",
    "Advanced Math",
    "Problem-Solving and Data Analysis",
    "Geometry and Trigonometry",
]

# filename stem -> domain, for cross-checking only
FILENAME_ALIASES = {
    "sec": "Standard English Conventions",
    "standard english conventions": "Standard English Conventions",
    "craft and structure": "Craft and Structure",
    "expression of ideas": "Expression of Ideas",
    "information and ideas": "Information and Ideas",
    "algebra": "Algebra",
    "advanced math": "Advanced Math",
    "problem-solving and data analysis": "Problem-Solving and Data Analysis",
    "psda": "Problem-Solving and Data Analysis",
    "geometry and trigonometry": "Geometry and Trigonometry",
}

LABELS = ("Question", "Answer", "Rationale")
CORRECT_RE = re.compile(r"^Correct Answer:\s*(.*)$")
QID_RE = re.compile(r"Question ID:\s*([0-9A-Za-z_-]+)")
CHOICE_RE = re.compile(r"^([A-D])\.\s*(.*)$", re.S)

PAGE_LEFT, PAGE_RIGHT = 14.0, 598.0
META_Y0, META_Y1 = 74.0, 122.0
CROP_ZOOM = 3.0
# Choice bodies start here; cropping from it drops the duplicated "A." label.
CHOICE_TEXT_LEFT = 27.5


# ---------------------------------------------------------------- text layer

def line_records(page):
    """Lines of a page as {bbox, chars}, sorted in reading order.

    Chars carry their own bbox, which is what lets us drop the spurious narrow
    spaces this exporter emits inside words, and map underline rules back onto
    character ranges.
    """
    rd = page.get_text("rawdict")
    raw = []
    for b in rd["blocks"]:
        if b.get("type") == 1:
            continue
        for ln in b["lines"]:
            chars = [c for s in ln["spans"] for c in s["chars"]]
            if not chars:
                continue
            raw.append({"bbox": tuple(ln["bbox"]), "chars": chars,
                        "size": max(s["size"] for s in ln["spans"])})
    if not raw:
        return []

    # A subscript ("NH3") is emitted as its own line on a shifted baseline, which
    # would otherwise sort away from the words it belongs to. Cluster lines whose
    # vertical centres nearly coincide back into one visual row.
    def yc(L):
        return (L["bbox"][1] + L["bbox"][3]) / 2.0

    raw.sort(key=lambda L: (yc(L), L["bbox"][0]))
    rows = []
    for L in raw:
        h = L["bbox"][3] - L["bbox"][1]
        if rows and abs(yc(L) - rows[-1]["yc"]) < max(rows[-1]["h"], h) * 0.5:
            rows[-1]["parts"].append(L)
            dom = max(rows[-1]["parts"], key=lambda p: (p["size"], p["bbox"][2] - p["bbox"][0]))
            rows[-1]["yc"], rows[-1]["h"] = yc(dom), dom["bbox"][3] - dom["bbox"][1]
        else:
            rows.append({"yc": yc(L), "h": h, "parts": [L]})

    out = []
    for r in rows:
        parts = sorted(r["parts"], key=lambda L: L["bbox"][0])
        dom = max(parts, key=lambda p: (p["size"], p["bbox"][2] - p["bbox"][0]))
        base_yc, base_size = yc(dom), dom["size"]
        chars, bbox, prev_x1 = [], None, None
        for L in parts:
            v = None
            if L["size"] < base_size * 0.92:
                if yc(L) > base_yc + 0.4:
                    v = "sub"
                elif yc(L) < base_yc - 0.4:
                    v = "sup"
            for c in L["chars"]:
                c["vert"] = v
            b0 = L["bbox"]
            # separate table cells that share a row; a subscript abuts its word
            # with no gap, so this never splits one
            if prev_x1 is not None and b0[0] - prev_x1 > 2.0:
                chars.append({"c": " ", "vert": None,
                              "bbox": (prev_x1, b0[1], b0[0], b0[3])})
            prev_x1 = b0[2]
            chars.extend(L["chars"])
            bbox = b0 if bbox is None else (min(bbox[0], b0[0]), min(bbox[1], b0[1]),
                                            max(bbox[2], b0[2]), max(bbox[3], b0[3]))
        out.append({"bbox": bbox, "chars": chars})
    out.sort(key=lambda L: (round(L["bbox"][1], 1), L["bbox"][0]))
    return out


def space_threshold(lines):
    """Half the typical real space width; narrower spaces are font artifacts."""
    widths = []
    for L in lines:
        for c in L["chars"]:
            if c["c"] == " ":
                widths.append(c["bbox"][2] - c["bbox"][0])
    if not widths:
        return 0.0
    widths.sort()
    return widths[len(widths) // 2] * 0.5


def keep_chars(line, thr):
    """Characters of a line with artifact spaces removed."""
    res = []
    for c in line["chars"]:
        if c["c"] == " " and (c["bbox"][2] - c["bbox"][0]) < thr:
            continue
        res.append(c)
    return res


def line_text(line, thr, underlines=None):
    """Line text, HTML-escaped, with <u> spans restored from underline rules."""
    chars = keep_chars(line, thr)
    if not chars:
        return ""
    lx0, lx1 = line["bbox"][0], line["bbox"][2]
    spans = []
    for u in (underlines or []):
        # must sit just under this line, and stay within it -- a rule running
        # wider than the text is a table border, not an underline
        if not (line["bbox"][3] - 6 <= u.y0 <= line["bbox"][3] + 4):
            continue
        if u.x0 >= lx0 - 3 and u.x1 <= lx1 + 3:
            spans.append((u.x0, u.x1))
    # the exporter draws one rule per text run, so bridge the gaps between them
    merged = []
    for x0, x1 in sorted(spans):
        if merged and x0 - merged[-1][1] < 4.0:
            merged[-1] = (merged[-1][0], max(merged[-1][1], x1))
        else:
            merged.append((x0, x1))

    marks = []
    for c in chars:
        x0, _, x1, _ = c["bbox"]
        w = max(x1 - x0, 0.01)
        marks.append(any((min(x1, ux1) - max(x0, ux0)) / w > 0.4 for ux0, ux1 in merged))

    parts, cur_u, cur_v = [], False, None
    for c, m in zip(chars, marks):
        v = c.get("vert")
        if v != cur_v and cur_v:
            parts.append("</%s>" % cur_v)
            cur_v = None
        if m != cur_u:
            parts.append("<u>" if m else "</u>")
            cur_u = m
        if v != cur_v and v:
            parts.append("<%s>" % v)
            cur_v = v
        parts.append(html.escape(c["c"], quote=False))
    if cur_v:
        parts.append("</%s>" % cur_v)
    if cur_u:
        parts.append("</u>")
    return "".join(parts).strip()


def paragraph_gap(lines):
    """Threshold separating a paragraph break from ordinary line spacing.

    Derived per page: leading here is ~5.5pt and paragraph spacing ~17.5pt, but
    both scale with font size, so measure rather than hardcode.
    """
    gaps, prev = [], None
    for L in lines:
        if prev is not None:
            g = L["bbox"][1] - prev
            if g > 0:
                gaps.append(g)
        prev = L["bbox"][3]
    if not gaps:
        return 10.0
    gaps.sort()
    # A median would land on a paragraph break when half the gaps are breaks, so
    # take a low quantile and cap it by line height -- leading cannot exceed that.
    heights = sorted(L["bbox"][3] - L["bbox"][1] for L in lines)
    base = min(gaps[int(len(gaps) * 0.25)], heights[len(heights) // 2] * 0.8)
    return max(base + 5.0, base * 1.9, 8.0)


def paragraphs(lines, thr, underlines=None, gap=None):
    """Group lines into paragraphs by vertical gap; returns [(text, y0, y1)]."""
    if gap is None:
        gap = paragraph_gap(lines)
    paras, cur, prev_bottom = [], [], None
    for L in lines:
        t = line_text(L, thr, underlines)
        if not t:
            continue
        top, bottom = L["bbox"][1], L["bbox"][3]
        if prev_bottom is not None and top - prev_bottom > gap and cur:
            paras.append(cur)
            cur = []
        cur.append((t, top, bottom))
        prev_bottom = bottom
    if cur:
        paras.append(cur)
    return [(clean_text(" ".join(t for t, _, _ in p)), p[0][1], p[-1][2]) for p in paras]


def merge_pages(chunks):
    """Flatten per-page paragraph lists, rejoining sentences split by a page break."""
    out = []
    for paras in chunks:
        for i, t in enumerate(paras):
            if i == 0 and out and not re.search(r"[.!?:;”’]$", out[-1]):
                out[-1] = clean_text(out[-1] + " " + t)
            else:
                out.append(t)
    return out


def clean_text(t):
    """Normalise spacing artifacts left by the exporter."""
    t = t.replace("\xa0", " ")
    t = re.sub(r"[ \t]{2,}", " ", t)
    # stray space before a closing curly quote: '... another. ”'
    t = re.sub(r"(?<=[.,!?;:]) (?=[”’])", "", t)
    # one underline spanning several wrapped lines arrives as one run per line
    t = re.sub(r"</(u|sub|sup)>(\s*)<\1>", r"\2", t)
    return t.strip()


# ------------------------------------------------------------- metadata cols

def metadata(page, thr):
    """Read Assessment/Test/Domain/Skill/Difficulty by column x-position.

    Values wrap onto a second line ("Text Structure and / Purpose"), so reading
    them in line order mis-assigns columns; column geometry is the reliable cut.
    """
    rd = page.get_text("rawdict")
    spans = []
    for b in rd["blocks"]:
        if b.get("type") == 1:
            continue
        for ln in b["lines"]:
            for s in ln["spans"]:
                if s["chars"]:
                    spans.append(s)

    heads = sorted(s["bbox"][0] for s in spans
                   if "".join(c["c"] for c in s["chars"]).strip()
                   in ("Assessment", "Test", "Domain", "Skill", "Difficulty"))
    if len(heads) != 5:
        return None
    # Values are left-aligned with their header, so the column's left edge is the
    # reliable divider -- a midpoint would cut long values ("Reading and Writing").
    bounds = [x - 6.0 for x in heads] + [PAGE_RIGHT]

    cols = [[] for _ in range(5)]
    for s in spans:
        x0, y0, _, y1 = s["bbox"]
        if not (META_Y0 < (y0 + y1) / 2.0 < META_Y1):
            continue
        txt = "".join(c["c"] for c in s["chars"]
                      if not (c["c"] == " " and (c["bbox"][2] - c["bbox"][0]) < thr)).strip()
        if not txt:
            continue
        for i in range(5):
            if bounds[i] <= x0 < bounds[i + 1]:
                cols[i].append((round(y0, 1), x0, txt))
                break
    return [" ".join(t for _, _, t in sorted(c)).strip() for c in cols]


# ----------------------------------------------------------------- drawings

def classify_drawings(page, y0, y1):
    """Split body vector art into underline rules, list bullets and figures."""
    rules, bullets, figures = [], [], []
    for d in page.get_drawings():
        r = fitz.Rect(d["rect"])
        if r.y1 < y0 or r.y0 > y1:
            continue
        h, w = r.height, r.width
        if d["type"] == "f" and h <= 1.6 and w >= 5.0:
            rules.append(r)
        elif d["type"] == "f" and w <= 6.0 and h <= 6.0:
            bullets.append(r)
        else:
            figures.append(r)
    # Part of this export renders formulas as placed images rather than vector
    # paths, so those count as figures too.
    for info in page.get_image_info():
        r = fitz.Rect(info["bbox"])
        if r.y1 < y0 or r.y0 > y1:
            continue
        if r.width >= 6.0 and r.height >= 6.0:
            figures.append(r)
    return rules, bullets, figures


# ------------------------------------------------------------------- render

def vstack(pixmaps):
    if len(pixmaps) == 1:
        return pixmaps[0]
    w = max(p.width for p in pixmaps)
    h = sum(p.height for p in pixmaps)
    out = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, w, h), False)
    out.clear_with(255)
    y = 0
    for p in pixmaps:
        p.set_origin(0, y)
        out.copy(p, p.irect)
        y += p.height
    return out


def trim_white(pix, pad=4):
    """Crop uniform white margins so a rendered region sits tight in the UI."""
    try:
        import numpy as np
    except Exception:
        return pix
    rows_px = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.stride)
    a = rows_px[:, : pix.width * pix.n].reshape(pix.height, pix.width, pix.n)
    ink = (a < 245).any(axis=2)
    rows = np.flatnonzero(ink.any(axis=1))
    cols = np.flatnonzero(ink.any(axis=0))
    if rows.size == 0 or cols.size == 0:
        return pix
    clip = fitz.IRect(
        max(int(cols[0]) - pad, 0),
        max(int(rows[0]) - pad, 0),
        min(int(cols[-1]) + pad + 1, pix.width),
        min(int(rows[-1]) + pad + 1, pix.height),
    )
    if clip.width < 4 or clip.height < 4:
        return pix
    cut = np.ascontiguousarray(a[clip.y0 : clip.y1, clip.x0 : clip.x1])
    return fitz.Pixmap(pix.colorspace, clip.width, clip.height, cut.tobytes(), False)


def render_crop(doc, regions, dest):
    """Render a body region (question, choices or rationale) to PNG."""
    mat = fitz.Matrix(CROP_ZOOM, CROP_ZOOM)
    pixmaps = []
    for pno, rect in regions:
        r = fitz.Rect(rect)
        if r.height < 4 or r.width < 4:
            continue
        pixmaps.append(trim_white(doc[pno].get_pixmap(matrix=mat, clip=r, alpha=False)))
    if not pixmaps:
        return False
    try:
        vstack(pixmaps).save(dest)
    except Exception:
        pixmaps[0].save(dest)
    return True


# -------------------------------------------------------------------- parse

def section_for(domain, test_field):
    t = (test_field or "").strip().lower()
    if t.startswith("reading"):
        return "Reading and Writing"
    if t.startswith("math"):
        return "Math"
    return "Reading and Writing" if domain in RW_DOMAINS else "Math"


def canonical(name, known):
    """Fold case-only variants (Cross-text vs Cross-Text) onto one spelling."""
    for k in known:
        if k.lower() == name.lower():
            return k
    known.append(name)
    return name


def parse_pdf(path, canon_skills, report, quiet=False):
    doc = fitz.open(path)
    fname = os.path.basename(path)
    stem = os.path.splitext(fname)[0]
    base = re.split(r"\s*[-–]\s*", stem)[0].strip().lower()
    expected_domain = FILENAME_ALIASES.get(base) or FILENAME_ALIASES.get(stem.strip().lower())

    npages = doc.page_count
    starts = []
    for i in range(npages):
        m = QID_RE.search(doc[i].get_text("text"))
        if m:
            starts.append((i, m.group(1)))
        if not quiet and (i + 1) % 25 == 0:
            print("  [%-28s] page %3d/%d  questions %d"
                  % (fname[:28], i + 1, npages, len(starts)), flush=True)
    if not quiet:
        print("  [%-28s] page %3d/%d  questions %d"
              % (fname[:28], npages, npages, len(starts)), flush=True)

    questions = []
    for qi, (p0, qid) in enumerate(starts):
        p1 = starts[qi + 1][0] - 1 if qi + 1 < len(starts) else npages - 1
        q = parse_question(doc, p0, p1, qid, fname, expected_domain, canon_skills, report)
        if q:
            questions.append(q)
    doc.close()
    return questions


def parse_question(doc, p0, p1, qid, fname, expected_domain, canon_skills, report):
    pages = list(range(p0, p1 + 1))
    per_page = {}
    thr = 0.0
    for pno in pages:
        lines = line_records(doc[pno])
        thr = max(thr, space_threshold(lines))
        per_page[pno] = lines

    # --- metadata
    meta = metadata(doc[p0], thr)
    if not meta:
        report["no_metadata"].append(qid)
        return None
    _assessment, test_f, domain, skill, difficulty = meta
    domain = domain.strip()
    skill = canonical(skill.strip(), canon_skills.setdefault(domain, []))
    difficulty = difficulty.strip() or "Unknown"
    if expected_domain and domain and expected_domain != domain:
        report["domain_mismatch"].append((qid, fname, expected_domain, domain))

    # --- locate the bold section labels, in order, across the question's pages
    anchors = {}
    for pno in pages:
        for L in per_page[pno]:
            if L["bbox"][0] > 26:
                continue
            t = line_text(L, thr)
            if t in LABELS and t not in anchors:
                anchors[t] = (pno, L["bbox"][1], L["bbox"][3])
            m = CORRECT_RE.match(t)
            if m and "Correct" not in anchors:
                anchors["Correct"] = (pno, L["bbox"][1], L["bbox"][3])
                anchors["_correct_val"] = m.group(1).strip()

    q_start = anchors.get("Question")
    a_start = anchors.get("Answer")
    c_start = anchors.get("Correct")
    r_start = anchors.get("Rationale")
    # A student-produced-response question has no "Answer" choice block at all,
    # so the question body runs until the key or the rationale instead.
    q_end = a_start or c_start or r_start
    if not q_start or not q_end:
        report["no_anchors"].append(qid)
        return None

    def slice_lines(start, end):
        """Lines strictly between two (page, y) anchors."""
        sp, sy = start[0], start[2]
        ep, ey = (end[0], end[1]) if end else (p1, 1e6)
        out = []
        for pno in pages:
            if pno < sp or pno > ep:
                continue
            for L in per_page[pno]:
                y = L["bbox"][1]
                if pno == sp and y < sy - 1:
                    continue
                if pno == ep and y >= ey - 1:
                    continue
                out.append((pno, L))
        return out

    q_lines = slice_lines(q_start, q_end)
    a_lines = slice_lines(a_start, c_start or r_start) if a_start else []
    r_lines = slice_lines(r_start, None) if r_start else []

    def regions_between(start, end, x0=PAGE_LEFT):
        """Page -> body rect between two (page, y0, y1) anchors."""
        out = {}
        last = end[0] if end else p1
        for pno in pages:
            if pno < start[0] or pno > last:
                continue
            ys = [L["bbox"][1] for L in per_page[pno]]
            ye = [L["bbox"][3] for L in per_page[pno]]
            top = start[2] + 1 if pno == start[0] else (min(ys) - 4 if ys else 20)
            if end and pno == last:
                bot = end[1] - 2
            else:
                bot = max(ye) + 4 if ye else 780
            if bot - top > 4:
                out[pno] = fitz.Rect(x0, top, PAGE_RIGHT, bot)
        return out

    def figures_in(regions):
        found = []
        for pno, rect in regions.items():
            _ru, _bu, fi = classify_drawings(doc[pno], rect.y0, rect.y1)
            found.extend((pno, r) for r in fi)
        return found

    def crop_region(regions, suffix, pages_wanted=None):
        """Render the given page regions to one PNG; return its relative path."""
        pick = [(p, regions[p]) for p in sorted(regions) if pages_wanted is None or p in pages_wanted]
        if not pick:
            return None
        name = "%s%s.png" % (qid, suffix)
        if render_crop(doc, pick, os.path.join(IMG_DIR, name)):
            return "img/%s" % name
        return None

    def crop_if_figures(regions, suffix):
        """Render a crop when the region holds vector art (figures or formulas)."""
        figs = figures_in(regions)
        if not figs:
            return None
        return crop_region(regions, suffix, {p for p, _ in figs})

    # --- underlines + figures over the question area only
    region_by_page = regions_between(q_start, q_end)

    rules, figures = [], []
    for pno, rect in region_by_page.items():
        ru, _bu, fi = classify_drawings(doc[pno], rect.y0, rect.y1)
        rules.extend((pno, r) for r in ru)
        figures.extend((pno, r) for r in fi)

    rules_by_page = defaultdict(list)
    for pno, r in rules:
        rules_by_page[pno].append(r)

    # --- figure crop
    #
    # The art always sits above the prose that refers to it, so the crop runs
    # from the top of the question area down to just past the last figure, and
    # whatever text follows stays real text. With art woven through the text —
    # inline formulas — that band covers everything and no text is kept, which
    # is what we want, since the text layer there has holes where glyphs are.
    image = None
    q_kept = q_lines
    if figures:
        last_fig_page = max(p_ for p_, _ in figures)
        dest = os.path.join(IMG_DIR, "%s.png" % qid)
        regions = [(p_, region_by_page[p_]) for p_ in sorted(region_by_page) if p_ < last_fig_page]
        cut = None
        if last_fig_page in region_by_page:
            reg = region_by_page[last_fig_page]
            cut = min(max(r.y1 for p_, r in figures if p_ == last_fig_page) + 3.0, reg.y1)
            regions.append((last_fig_page, fitz.Rect(PAGE_LEFT, reg.y0, PAGE_RIGHT, cut)))
        if render_crop(doc, regions, dest):
            image = "img/%s.png" % qid
            q_kept = [
                (p_, L)
                for p_, L in q_lines
                if p_ > last_fig_page or (p_ == last_fig_page and cut is not None and L["bbox"][1] >= cut - 1)
            ]

    # --- passage / stem
    q_chunks = []
    for pno in sorted({p for p, _ in q_kept}):
        pls = [L for p, L in q_kept if p == pno]
        q_chunks.append([t for t, _, _ in paragraphs(pls, thr, rules_by_page.get(pno)) if t])
    texts = merge_pages(q_chunks)
    passage, stem = "", ""
    if texts:
        if len(texts) == 1:
            stem = texts[0]
        else:
            stem = texts[-1]
            passage = "\n\n".join(texts[:-1])
            if not stem.rstrip().endswith("?"):
                # stem ran together with the passage; cut at the last question mark
                joined = "\n\n".join(texts)
                idx = joined.rfind("?")
                if idx != -1:
                    dot = max(joined.rfind(". ", 0, idx), joined.rfind(".\n", 0, idx))
                    cut = max(joined.rfind("\n\n", 0, idx), dot + 1 if dot != -1 else -1)
                    if cut > 0:
                        passage = joined[:cut].strip()
                        stem = joined[cut:].strip()

    # --- choices
    choices, cur = {}, None
    choice_tops = []
    for pno, L in a_lines:
        t = line_text(L, thr)
        if not t:
            continue
        m = CHOICE_RE.match(t)
        if m and L["bbox"][0] < 26:
            cur = m.group(1)
            choices[cur] = m.group(2).strip()
            choice_tops.append((cur, pno, L["bbox"][1]))
        elif cur:
            choices[cur] = (choices[cur] + " " + t).strip()
    choices = {k: clean_text(v) for k, v in choices.items()}
    qtype = "mcq" if len(choices) >= 2 else "spr"

    # --- key
    raw_key = anchors.get("_correct_val", "")
    if qtype == "mcq":
        correct = re.findall(r"\b([A-D])\b", raw_key.upper())[:1]
    else:
        correct = [p.strip() for p in re.split(r"[,;]| or ", raw_key) if p.strip()]

    # --- rationale
    r_chunks = []
    for pno in sorted({p for p, _ in r_lines}):
        pls = [L for p, L in r_lines if p == pno]
        r_chunks.append([t for t, _, _ in paragraphs(pls, thr) if t])
    rationale = "\n\n".join(merge_pages(r_chunks))
    if not rationale:
        report["no_rationale"].append(qid)

    # Some student-produced-response exports omit the "Correct Answer:" line and
    # only state the key inside the rationale.
    if not correct and rationale:
        m = re.search(r"correct answer is\s*([^.\r\n]{1,40}?)\s*\.", rationale, re.I)
        if m:
            val = clean_text(re.sub(r"<[^>]+>", "", m.group(1))).strip()
            if val:
                correct = [p.strip() for p in re.split(r"[,;]| or ", val) if p.strip()]
    if not correct:
        report["no_key"].append(qid)

    # Math choices and rationales are rendered as vector glyphs too, so their
    # text comes out with holes; crop them whenever the region holds any art.
    ans_end = c_start or r_start
    ans_regions = regions_between(a_start, ans_end) if a_start else {}
    ans_figs = figures_in(ans_regions)
    choices_image = crop_if_figures(ans_regions, "-a") if a_start else None

    def choice_bands(n):
        """Split the answer block into one vertical band per choice.

        A stacked formula reaches far above and below the text line that carries
        its "A.", so the slices are cut at the widest whitespace gaps between
        rendered content rather than at line tops.
        """
        pno = a_start[0]
        spans = []
        for p_, L in a_lines:
            if p_ != pno:
                return None
            spans.append([L["bbox"][1], L["bbox"][3]])
        for p_, r in ans_figs:
            if p_ != pno:
                return None
            spans.append([r.y0, r.y1])
        if len(spans) < n:
            return None
        spans.sort()
        merged = [spans[0]]
        for a, b in spans[1:]:
            if a - merged[-1][1] <= 0.5:
                merged[-1][1] = max(merged[-1][1], b)
            else:
                merged.append([a, b])
        if len(merged) < n:
            return None
        widest = sorted(
            ((merged[i + 1][0] - merged[i][1], i) for i in range(len(merged) - 1)),
            reverse=True,
        )[: n - 1]
        if any(gap < 1.0 for gap, _ in widest):
            return None
        bands, lo = [], 0
        for hi in sorted(i for _, i in widest) + [len(merged) - 1]:
            grp = merged[lo : hi + 1]
            bands.append((grp[0][0], grp[-1][1]))
            lo = hi + 1
        return pno, bands

    # When the choices carry formulas, slice one crop per choice so each stays
    # separately selectable instead of collapsing into one picture.
    choice_images = {}
    if choices_image and len(choice_tops) >= 2:
        got = choice_bands(len(choice_tops))
        if got:
            pno, bands = got
            for (letter, _p, _y), (y0, y1) in zip(choice_tops, bands):
                rect = fitz.Rect(CHOICE_TEXT_LEFT, y0 - 2, PAGE_RIGHT, y1 + 2)
                path = crop_region({pno: rect}, "-%s" % letter)
                if path:
                    choice_images[letter] = path
        if len(choice_images) == len(choice_tops):
            choices_image = None  # per-choice crops cover it
        else:
            choice_images = {}

    rationale_image = crop_if_figures(regions_between(r_start, None), "-r") if r_start else None

    has_underline = "<u>" in passage or "<u>" in stem
    if image:
        conf = "low"
    elif has_underline or not rationale or (qtype == "mcq" and len(choices) != 4):
        conf = "medium"
    else:
        conf = "high"

    return {
        "id": qid,
        "section": section_for(domain, test_f),
        "domain": domain,
        "skill": skill,
        "difficulty": difficulty,
        "passage": passage,
        "stem": stem,
        "choices": {k: choices[k] for k in sorted(choices)} if qtype == "mcq" else None,
        "type": qtype,
        "correct": correct,
        "rationale": rationale,
        "image": image,
        "choicesImage": choices_image,
        "choiceImages": choice_images or None,
        "rationaleImage": rationale_image,
        "hasUnderline": has_underline,
        "parseConfidence": conf,
        "sourceFile": fname,
    }


# -------------------------------------------------------------------- report

def print_report(questions, new_ids, report, elapsed):
    print()
    print("=" * 74)
    print("  PARSE REPORT")
    print("=" * 74)
    print("  Bceго вопросов : %d" % len(questions))
    print("  Новых          : %d" % len(new_ids))
    print("  Время          : %.1f s" % elapsed)

    diffs = sorted({q["difficulty"] for q in questions})
    known = RW_DOMAINS + MATH_DOMAINS
    doms = sorted({q["domain"] for q in questions},
                  key=lambda d: known.index(d) if d in known else 99)
    grid = Counter((q["domain"], q["difficulty"]) for q in questions)

    print("\n  Домен x сложность")
    w = max(len(d) for d in doms) + 2
    print("  " + "Домен".ljust(w) + "".join(d.rjust(9) for d in diffs) + "Всего".rjust(9))
    print("  " + "-" * (w + 9 * (len(diffs) + 1)))
    for d in doms:
        row = "  " + d.ljust(w)
        tot = 0
        for df in diffs:
            n = grid[(d, df)]
            tot += n
            row += (str(n) if n else "-").rjust(9)
        print(row + str(tot).rjust(9))
    row = "  " + "ВСЕГО".ljust(w)
    for df in diffs:
        row += str(sum(1 for q in questions if q["difficulty"] == df)).rjust(9)
    print(row + str(len(questions)).rjust(9))

    print("\n  Скиллы по доменам")
    for d in doms:
        sk = Counter(q["skill"] for q in questions if q["domain"] == d)
        print("    %s  (%d)" % (d, sum(sk.values())))
        for s, n in sk.most_common():
            print("      %-42s %4d" % (s, n))

    print("\n  Качество разбора")
    conf = Counter(q["parseConfidence"] for q in questions)
    print("    high / medium / low            : %d / %d / %d"
          % (conf["high"], conf["medium"], conf["low"]))
    print("    с картинкой (график/таблица)   : %d" % sum(1 for q in questions if q["image"]))
    print("    с подчёркиванием (<u> в тексте): %d"
          % sum(1 for q in questions if q.get("hasUnderline")))
    print("    student-produced response      : %d"
          % sum(1 for q in questions if q["type"] == "spr"))

    print("\n  Проблемы")
    any_p = False
    for name, items in (("Без ключа", report["no_key"]),
                        ("Без rationale", report["no_rationale"]),
                        ("Без метаданных (пропущены)", report["no_metadata"]),
                        ("Без якорей Question/Answer (пропущены)", report["no_anchors"]),
                        ("Дубликаты id", report["duplicates"])):
        if items:
            any_p = True
            print("    %-38s %4d  %s" % (name, len(items), list(items)[:6]))
    low = [q["id"] for q in questions if q["parseConfidence"] == "low"]
    if low:
        any_p = True
        print("    %-38s %4d  %s" % ("low confidence (смотреть картинку)", len(low), low[:6]))
    if report["domain_mismatch"]:
        any_p = True
        print("    Расхождение имени файла и поля Domain: %d" % len(report["domain_mismatch"]))
        for qid, fn, exp, got in report["domain_mismatch"][:8]:
            print("      %s  %s: файл->%r, PDF->%r" % (qid, fn, exp, got))
    if not any_p:
        print("    нет")
    print("=" * 74)


# ---------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--themes", default=THEMES_DIR)
    ap.add_argument("--out", default=OUT_JSON)
    ap.add_argument("--only", help="parse a single file by name substring")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    os.makedirs(IMG_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(args.out), exist_ok=True)

    old = {}
    if os.path.exists(args.out):
        try:
            with open(args.out, encoding="utf-8") as f:
                old = {q["id"]: q for q in json.load(f).get("questions", [])}
        except Exception as e:
            print("  (не смог прочитать прошлый questions.json: %s)" % e)

    files = sorted(f for f in os.listdir(args.themes) if f.lower().endswith(".pdf"))
    if args.only:
        files = [f for f in files if args.only.lower() in f.lower()]
    if not files:
        print("Нет PDF в %s" % args.themes)
        return 1

    report = defaultdict(list)
    canon_skills = {}
    seen, questions = {}, []
    t0 = time.time()
    print("Парсинг %d файлов из %s\n" % (len(files), args.themes))
    for fn in files:
        path = os.path.join(args.themes, fn)
        print("-> %s (%.1f MB)" % (fn, os.path.getsize(path) / 1e6), flush=True)
        qs = parse_pdf(path, canon_skills, report, quiet=args.quiet)
        kept = 0
        for q in qs:
            if q["id"] in seen:
                report["duplicates"].append((q["id"], seen[q["id"]], fn))
                continue
            seen[q["id"]] = fn
            questions.append(q)
            kept += 1
        print("  -> %d вопросов (%d дублей отброшено)\n" % (kept, len(qs) - kept), flush=True)

    # keep prior ordering stable, append new ones at the end
    new_ids = [q["id"] for q in questions if q["id"] not in old]
    order = {qid: i for i, qid in enumerate(old)}
    questions.sort(key=lambda q: (order.get(q["id"], 10 ** 6), q["sourceFile"], q["id"]))

    payload = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "files": files,
        "counts": {"total": len(questions), "new": len(new_ids)},
        "questions": questions,
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)

    print_report(questions, new_ids, report, time.time() - t0)
    print("\n  -> %s (%.1f MB)" % (os.path.relpath(args.out, ROOT),
                                   os.path.getsize(args.out) / 1e6))
    return 0


if __name__ == "__main__":
    sys.exit(main())
