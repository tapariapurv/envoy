"""Build a typeset PDF from USER_GUIDE.md.

    backend/.venv/bin/python docs/build_guide_pdf.py [input.md] [output.pdf]

Supports the Markdown subset the guide uses: #/##/### headings, paragraphs, bullet and numbered
lists, tables, > callouts, fenced code, **bold**, *italic*, `code`, and [links](url).
Output: cover page, clickable table of contents, running header, page numbers.
"""
import re
import sys
from datetime import date
from html import escape
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.utils import ImageReader
from reportlab.platypus import (BaseDocTemplate, CondPageBreak, Frame, Image, KeepTogether, ListFlowable, ListItem,
                                NextPageTemplate, PageBreak, PageTemplate, Paragraph, Spacer, Table, TableStyle,
                                XPreformatted)
from reportlab.platypus.tableofcontents import TableOfContents
from reportlab.lib.fonts import addMapping

HERE = Path(__file__).resolve().parent
BRAND = HERE / "brand"
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "USER_GUIDE.md"
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else HERE / "Envoy_User_Guide.pdf"

INK, MUTED, LINE, TINT = colors.HexColor("#1d1c1a"), colors.HexColor("#75716a"), colors.HexColor("#e4e1da"), colors.HexColor("#f4f3ff")
ACCENT, PAPER, CODE_BG = colors.HexColor("#4f46e5"), colors.HexColor("#f7f6f3"), colors.HexColor("#f1efea")
PAGE_W, PAGE_H = A4
MARGIN = 22 * mm

# ---------- fonts: use macOS TrueType fonts when present (full Unicode), else PDF built-ins ----------
SUPP = Path("/System/Library/Fonts/Supplemental")
CANDIDATES = {
    "Body": SUPP / "Arial.ttf", "Body-Bold": SUPP / "Arial Bold.ttf",
    "Body-Italic": SUPP / "Arial Italic.ttf", "Body-BoldItalic": SUPP / "Arial Bold Italic.ttf",
    "Display": SUPP / "Georgia.ttf", "Display-Bold": SUPP / "Georgia Bold.ttf",
    "Mono": SUPP / "Courier New.ttf",
}
if all(p.exists() for p in CANDIDATES.values()):
    for name, path in CANDIDATES.items():
        pdfmetrics.registerFont(TTFont(name, str(path)))
    for fam, (r, b, i, bi) in {"Body": ("Body", "Body-Bold", "Body-Italic", "Body-BoldItalic"),
                                "Display": ("Display", "Display-Bold", "Display", "Display-Bold")}.items():
        for bold, italic, face in ((0, 0, r), (1, 0, b), (0, 1, i), (1, 1, bi)):
            addMapping(fam, bold, italic, face)
    F = {"body": "Body", "bold": "Body-Bold", "display": "Display", "mono": "Mono"}
    covered = set(pdfmetrics.getFont("Body").face.charToGlyph)
else:
    F = {"body": "Helvetica", "bold": "Helvetica-Bold", "display": "Times-Roman", "mono": "Courier"}
    covered = set(range(256))

# Glyphs the fonts may lack -> readable fallbacks.
FALLBACK = {"⌘": "Cmd", "✕": "x", "→": "->", "←": "<-", "↑": "Up", "↓": "Down", "≈": "~", "…": "...", "•": "·",
            "“": '"', "”": '"', "‘": "'", "’": "'", "—": "-", "–": "-", "≥": ">=", "≤": "<=", "›": ">"}


def clean(s: str) -> str:
    return "".join(ch if ord(ch) in covered else FALLBACK.get(ch, "") for ch in s)


def inline(s: str) -> str:
    """Markdown inline -> ReportLab mini-HTML."""
    s = escape(clean(s), quote=False)
    codes: list[str] = []  # stash code spans so bold/italic rules can't touch their contents

    def stash(m):
        codes.append(f'<font name="{F["mono"]}" size="8.6" backColor="#f1efea"> {m[1]} </font>')
        return f"\x00{len(codes) - 1}\x00"

    s = re.sub(r"`([^`]+)`", stash, s)
    s = re.sub(r"\[([^\]]+)\]\((https?://[^)]+)\)", r'<link href="\2" color="#4f46e5"><u>\1</u></link>', s)
    s = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1", s)  # relative links: keep text
    s = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", s)
    s = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"<i>\1</i>", s)
    return re.sub(r"\x00(\d+)\x00", lambda m: codes[int(m[1])], s)


# ---------- styles ----------
S = {
    "body": ParagraphStyle("body", fontName=F["body"], fontSize=10, leading=15.2, textColor=INK, spaceAfter=7),
    "h2": ParagraphStyle("h2", fontName=F["display"], fontSize=24, leading=29, textColor=INK, spaceBefore=4, spaceAfter=10),
    "h3": ParagraphStyle("h3", fontName=F["bold"], fontSize=12.5, leading=17, textColor=INK, spaceBefore=12, spaceAfter=5),
    "cell": ParagraphStyle("cell", fontName=F["body"], fontSize=9, leading=12.6, textColor=INK),
    "th": ParagraphStyle("th", fontName=F["bold"], fontSize=8.6, leading=12, textColor=colors.white),
    "note": ParagraphStyle("note", fontName=F["body"], fontSize=9.6, leading=14.4, textColor=INK),
    "code": ParagraphStyle("code", fontName=F["mono"], fontSize=8.8, leading=12.4, textColor=INK),
    "caption": ParagraphStyle("caption", fontName=F["body"], fontSize=8.5, leading=11, textColor=MUTED, alignment=1, spaceAfter=12),
    "toc0": ParagraphStyle("toc0", fontName=F["bold"], fontSize=11, leading=16, spaceBefore=7, textColor=INK),
    "toc1": ParagraphStyle("toc1", fontName=F["body"], fontSize=9.6, leading=14, leftIndent=14, textColor=MUTED),
}


class H(Paragraph):
    """Heading that registers itself in the TOC and running header."""
    def __init__(self, text, level):
        self.level, self.plain = level, clean(text)
        super().__init__(inline(text), S["h2" if level == 0 else "h3"])


class Doc(BaseDocTemplate):
    section = ""

    def beforeDocument(self):  # multiBuild runs several passes; don't leak the last section into page 2
        self.section = "Contents"

    def afterFlowable(self, f):
        if isinstance(f, H):
            key = f"h{id(f)}"
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(f.plain, key, level=f.level, closed=f.level > 0)
            self.notify("TOCEntry", (f.level, f.plain, self.page, key))
            if f.level == 0:
                self.section = f.plain


# ---------- page decoration ----------
def cover(c, doc):
    c.saveState()
    c.setFillColor(PAPER); c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    c.setFillColor(ACCENT); c.rect(0, PAGE_H * 0.42, PAGE_W, PAGE_H * 0.58, fill=1, stroke=0)
    # logo (white mark on the indigo band); PNG alpha is honoured via mask="auto"
    c.drawImage(str(BRAND / "envoy-logo-white.png"), MARGIN - 2 * mm, PAGE_H - MARGIN - 30 * mm, 30 * mm, 30 * mm, mask="auto")
    c.setFillColor(colors.white)
    c.setFont(F["display"], 64); c.drawString(MARGIN, PAGE_H * 0.42 + 44 * mm, "Envoy")
    c.setFont(F["display"], 28); c.drawString(MARGIN, PAGE_H * 0.42 + 30 * mm, "User Guide")
    c.setFont(F["body"], 12); c.setFillColor(colors.HexColor("#e0e7ff"))
    c.drawString(MARGIN, PAGE_H * 0.42 + 14 * mm, "A private, local AI workspace for Model UN delegates")
    c.setFillColor(INK); c.setFont(F["bold"], 11)
    y = PAGE_H * 0.42 - 22 * mm
    for title, sub in [("War Room", "Kanban board, procedure timers, speakers list"),
                       ("Research Hub", "Private document vault with cited answers"),
                       ("Drafting Studio", "Split-screen editor with diplomatic AI tools"),
                       ("Opponent Simulator", "Counter-arguments and evidence-based rebuttals"),
                       ("Procedural Prep", "Clause bank and Rules of Procedure flashcards"),
                       ("Logistics", "Paced teleprompter and offline binder"),
                       ("Workspaces", "One per conference, shareable with a code")]:
        c.setFillColor(ACCENT); c.circle(MARGIN + 1.5 * mm, y + 1.3 * mm, 1.2 * mm, fill=1, stroke=0)
        c.setFillColor(INK); c.setFont(F["bold"], 11); c.drawString(MARGIN + 6 * mm, y, title)
        c.setFillColor(MUTED); c.setFont(F["body"], 10); c.drawString(MARGIN + 52 * mm, y, sub)
        y -= 9 * mm
    c.setFont(F["body"], 9); c.setFillColor(MUTED)
    c.drawString(MARGIN, MARGIN, f"Edition of {date.today():%B %Y}")
    c.drawRightString(PAGE_W - MARGIN, MARGIN, "Runs on your Mac · Your documents never leave it")
    c.restoreState()


def chrome(c, doc):
    c.saveState()
    c.setStrokeColor(LINE); c.setLineWidth(0.6)
    c.line(MARGIN, PAGE_H - 14 * mm, PAGE_W - MARGIN, PAGE_H - 14 * mm)
    c.drawImage(str(BRAND / "envoy-logo.png"), MARGIN, PAGE_H - 12.4 * mm, 4.4 * mm, 4.4 * mm, mask="auto")
    c.setFont(F["bold"], 8); c.setFillColor(ACCENT); c.drawString(MARGIN + 6.2 * mm, PAGE_H - 11.5 * mm, "ENVOY USER GUIDE")
    c.setFont(F["body"], 8); c.setFillColor(MUTED); c.drawRightString(PAGE_W - MARGIN, PAGE_H - 11.5 * mm, doc.section)
    c.line(MARGIN, 14 * mm, PAGE_W - MARGIN, 14 * mm)
    c.drawRightString(PAGE_W - MARGIN, 9.5 * mm, str(doc.page))
    c.restoreState()


# ---------- block parser ----------
def table(rows):
    ncols = max(map(len, rows))
    rows = [r + [""] * (ncols - len(r)) for r in rows]
    width = PAGE_W - 2 * MARGIN
    # proportional widths from content length, with a floor so short columns stay readable
    lens = [max(min(len(r[i]), 60) for r in rows) + 6 for i in range(ncols)]
    widths = [width * n / sum(lens) for n in lens]
    data = [[Paragraph(inline(x), S["th"] if ri == 0 else S["cell"]) for x in r] for ri, r in enumerate(rows)]
    t = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), INK),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PAPER]),
        ("LINEBELOW", (0, 1), (-1, -1), 0.5, LINE),
        ("BOX", (0, 0), (-1, -1), 0.5, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 7), ("RIGHTPADDING", (0, 0), (-1, -1), 7),
    ]))
    return [t, Spacer(1, 9)]


def callout(text):
    t = Table([[Paragraph(inline(text), S["note"])]], colWidths=[PAGE_W - 2 * MARGIN])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), TINT), ("LINEBEFORE", (0, 0), (0, -1), 3, ACCENT),
                           ("LEFTPADDING", (0, 0), (-1, -1), 12), ("RIGHTPADDING", (0, 0), (-1, -1), 12),
                           ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8)]))
    return [Spacer(1, 2), t, Spacer(1, 10)]


def code(lines):
    t = Table([[XPreformatted(escape(clean("\n".join(lines))), S["code"])]], colWidths=[PAGE_W - 2 * MARGIN])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), CODE_BG), ("BOX", (0, 0), (-1, -1), 0.5, LINE),
                           ("LEFTPADDING", (0, 0), (-1, -1), 10), ("TOPPADDING", (0, 0), (-1, -1), 8),
                           ("BOTTOMPADDING", (0, 0), (-1, -1), 8)]))
    return [t, Spacer(1, 10)]


def figure(alt: str, path: str):
    """Screenshot scaled to the text width, in a hairline frame, with its alt text as caption."""
    f = (SRC.parent / path).resolve()
    if not f.exists():
        return []
    iw, ih = ImageReader(str(f)).getSize()
    w = PAGE_W - 2 * MARGIN
    h = min(w * ih / iw, 150 * mm)
    img = Image(str(f), width=h * iw / ih, height=h)
    t = Table([[img]], colWidths=[w])
    t.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.5, LINE), ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                           ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                           ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    return [KeepTogether([Spacer(1, 4), t, Spacer(1, 5), Paragraph(inline(alt), S["caption"])])]


def lst(items, ordered):
    return [ListFlowable([ListItem(Paragraph(inline(i), S["body"]), leftIndent=16) for i in items],
                         bulletType="1" if ordered else "bullet", start="1" if ordered else "•",
                         bulletFontName=F["bold"] if ordered else F["body"], bulletFontSize=9.5 if ordered else 12,
                         bulletColor=ACCENT, leftIndent=16, bulletDedent=12, spaceAfter=4), Spacer(1, 3)]


def parse(md: str):
    out, lines, i, first_h2 = [], md.splitlines(), 0, True
    para: list[str] = []

    def flush():
        if para:
            out.append(Paragraph(inline(" ".join(para)), S["body"]))
            para.clear()

    while i < len(lines):
        ln = lines[i].rstrip()
        s = ln.strip()
        if s.startswith("```"):
            flush(); j = i + 1
            while j < len(lines) and not lines[j].strip().startswith("```"):
                j += 1
            out += code(lines[i + 1:j]); i = j + 1; continue
        if m := re.match(r"^!\[(.*?)\]\((.+?)\)$", s):
            flush(); out += figure(m[1], m[2]); i += 1; continue
        if s.startswith("# "):  # document title lives on the cover
            flush(); i += 1; continue
        if s.startswith("## "):
            flush()
            if not first_h2:
                out.append(PageBreak())
            first_h2 = False
            out += [H(s[3:], 0), Table([[""]], colWidths=[28 * mm], rowHeights=[2.2],
                                       style=[("BACKGROUND", (0, 0), (-1, -1), ACCENT)], hAlign="LEFT"), Spacer(1, 12)]
            i += 1; continue
        if s.startswith("### "):
            flush(); out += [CondPageBreak(40 * mm), H(s[4:], 1)]; i += 1; continue
        if s.startswith("|"):
            flush(); rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                cells = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                if not all(re.fullmatch(r":?-{2,}:?", c) for c in cells):
                    rows.append(cells)
                i += 1
            out += table(rows); continue
        if s.startswith(">"):
            flush(); quote = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                quote.append(lines[i].strip().lstrip(">").strip()); i += 1
            out += callout(" ".join(quote)); continue
        m = re.match(r"^(\s*)([-*]|\d+\.)\s+(.*)", ln)
        if m:
            flush(); ordered = m[2][0].isdigit(); items = []
            while i < len(lines) and (mm_ := re.match(r"^\s*([-*]|\d+\.)\s+(.*)", lines[i])):
                items.append(mm_[2]); i += 1
                while i < len(lines) and lines[i].startswith("   ") and lines[i].strip():  # continuation line
                    items[-1] += " " + lines[i].strip(); i += 1
            out += lst(items, ordered); continue
        if s in ("---", "***"):
            flush(); out.append(Spacer(1, 8)); i += 1; continue
        if not s:
            flush()
        else:
            para.append(s)
        i += 1
    flush()
    return out


def build():
    doc = Doc(str(OUT), pagesize=A4, leftMargin=MARGIN, rightMargin=MARGIN, topMargin=22 * mm, bottomMargin=22 * mm,
              title="Envoy User Guide", author="Envoy", subject="Model UN workspace - user guide")
    frame = Frame(MARGIN, 20 * mm, PAGE_W - 2 * MARGIN, PAGE_H - 42 * mm, id="f", leftPadding=0, rightPadding=0)
    doc.addPageTemplates([PageTemplate("cover", [Frame(0, 0, PAGE_W, PAGE_H, id="c")], onPage=cover),
                          PageTemplate("body", [frame], onPageEnd=chrome)])
    toc = TableOfContents(levelStyles=[S["toc0"], S["toc1"]], dotsMinLevel=0)
    story = [NextPageTemplate("body"), PageBreak(),
             Paragraph("Contents", S["h2"]), Spacer(1, 6), toc, PageBreak(), *parse(SRC.read_text(encoding="utf-8"))]
    doc.multiBuild(story)
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    build()
