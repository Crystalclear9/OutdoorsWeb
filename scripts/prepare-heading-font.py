"""Build the local heading subset from LXGW WenKai Medium v1.530.
Usage: python prepare-heading-font.py /path/to/LXGWWenKai-Medium.ttf
Requires fonttools and brotli. Keep upstream OFL.txt with the output.
"""
from pathlib import Path
import sys
from fontTools import subset
from fontTools.ttLib import TTFont

root = Path(__file__).resolve().parent.parent
font = TTFont(sys.argv[1])
# Modified font uses a new family name, respecting the upstream reserved names.
names = {1: "Campus Heading", 2: "Medium", 3: "CampusHeading-Medium-1.530-subset",
         4: "Campus Heading Medium", 6: "CampusHeading-Medium", 16: "Campus Heading", 17: "Medium"}
for record in font["name"].names:
    if record.nameID in names:
        record.string = names[record.nameID].encode(record.getEncoding())
options = subset.Options()
options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14, 16, 17]
options.name_legacy = True
options.name_languages = ["*"]
subsetter = subset.Subsetter(options=options)
# Static UI headings plus Latin text; user-provided strings use the body font.
text = "".join(p.read_text(encoding="utf-8") for p in (root / "src").glob("*.jsx"))
subsetter.populate(text=text + "".join(chr(i) for i in range(32, 127)))
subsetter.subset(font)
font.flavor = "woff2"
font.save(root / "src/assets/fonts/CampusHeading-Medium.woff2")
