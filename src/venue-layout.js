// Traced against PDF page 11 (1350 x 1185 crop). Numeric database booking IDs
// are retained; UI numbers 01-29 are system IDs, not building identifiers.
export const VENUE_SEGMENTS = [
  { id: "green", label: "绿地边缘", first: 1, last: 6 },
  { id: "b-passage", label: "B 座通道", first: 7, last: 10 },
  { id: "a-passage", label: "A 座通道", first: 11, last: 14 },
  { id: "east", label: "东侧直线", first: 15, last: 21 },
  { id: "south", label: "南侧直线", first: 22, last: 29 },
];
export const segmentFor = (n) =>
  VENUE_SEGMENTS.find((s) => n >= s.first && n <= s.last);
export const inSegment = (n, segment) =>
  segment === "all" || segmentFor(n)?.id === segment;
// Physical centers, angles, then independent label centers in PDF pixels.
export const VENUE_POSITIONS = [
  [1, 443, 116, 90, 492, 122],
  [2, 443, 219, 90, 492, 225],
  [3, 397, 314, -41, 455, 306],
  [4, 322, 383, -41, 373, 415],
  [5, 218, 425, 0, 218, 465],
  [6, 115, 425, 0, 115, 465],
  [7, 630, 369, 16, 630, 337],
  [8, 735, 399, 16, 735, 367],
  [9, 829, 425, 16, 829, 393],
  [10, 953, 451, 16, 953, 497],
  [11, 386, 611, 73, 328, 610],
  [12, 414, 712, 73, 357, 714],
  [13, 439, 805, 73, 380, 806],
  [14, 471, 938, 73, 530, 949],
  [15, 1267, 504, 90, 1201, 510],
  [16, 1267, 600, 90, 1201, 606],
  [17, 1267, 697, 90, 1201, 703],
  [18, 1267, 792, 90, 1201, 798],
  [19, 1267, 888, 90, 1201, 894],
  [20, 1267, 985, 90, 1201, 991],
  [21, 1267, 1082, 90, 1201, 1088],
  [22, 368, 1142, 0, 368, 1116],
  [23, 464, 1142, 0, 464, 1116],
  [24, 561, 1142, 0, 561, 1116],
  [25, 657, 1142, 0, 657, 1116],
  [26, 753, 1142, 0, 753, 1116],
  [27, 849, 1142, 0, 849, 1116],
  [28, 946, 1142, 0, 946, 1116],
  [29, 1043, 1142, 0, 1043, 1116],
].map(([id, x, y, r, lx, ly]) => ({ id, x, y, r, lx, ly }));
