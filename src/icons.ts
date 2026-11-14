// Icons from the line-md set (Material Line Icons by Vjacheslav Trushkin,
// https://github.com/cyberalien/line-md, MIT license). Many carry SMIL
// animations that play inline every time the SVG is inserted into the DOM,
// so dropdown items re-animate on each menu open.
//
// Rendered with currentColor, sized through CSS (.menu-item-icon,
// .dialog-icon, .link-icon, .loading-icon).

import folderArrowRight from "./icons/line-md/folder-arrow-right.svg?raw";
import logout from "./icons/line-md/logout.svg?raw";
import compass from "./icons/line-md/compass.svg?raw";
import grid3 from "./icons/line-md/grid-3.svg?raw";
import hash from "./icons/line-md/hash.svg?raw";
import arrowsDiagonal from "./icons/line-md/arrows-diagonal.svg?raw";
import monitorScreenshot from "./icons/line-md/monitor-screenshot.svg?raw";
import cogLoop from "./icons/line-md/cog-loop.svg?raw";
import documentCode from "./icons/line-md/document-code.svg?raw";
import questionCircle from "./icons/line-md/question-circle.svg?raw";
import downloadingLoop from "./icons/line-md/downloading-loop.svg?raw";
import externalLink from "./icons/line-md/external-link.svg?raw";
import file from "./icons/line-md/file.svg?raw";
import image from "./icons/line-md/image.svg?raw";
import construction from "./icons/line-md/construction.svg?raw";
import square from "./icons/line-md/square.svg?raw";

const ICONS: Record<string, string> = {
  "folder-arrow-right": folderArrowRight,
  logout,
  compass,
  "grid-3": grid3,
  hash,
  "arrows-diagonal": arrowsDiagonal,
  "monitor-screenshot": monitorScreenshot,
  "cog-loop": cogLoop,
  "document-code": documentCode,
  "question-circle": questionCircle,
  "downloading-loop": downloadingLoop,
  "external-link": externalLink,
  file,
  image,
  construction,
  square,
};

/** Raw SVG markup for a named icon, or an empty string for an unknown
 * name (fail-soft: a missing icon must not break the UI). */
export function iconSvg(name: string): string {
  return ICONS[name] ?? "";
}
